import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";

import { IconChevron, IconCopy, IconImage, IconSave, IconTrash } from "./icons";
import { FrameEdits } from "./lib/edits";
import {
  availableSources,
  buildSteps,
  canvasToPngBytes,
  captionOrDefault,
  composeGuideCanvas,
  Guide,
  GuideStep,
  guideHtml,
  guideMarkdown,
  renderStepImage,
  RenderedStep,
  slugify,
  StepSource,
} from "./lib/steps";
import { FrameThumb, InputEvent } from "./lib/tauri";

interface Props {
  /** The clip as it will be exported: trimmed, in display order. */
  thumbs: FrameThumb[];
  edits: FrameEdits;
  inputEvents: InputEvent[];
  /** The guide being edited, or null before one has been built. */
  guide: Guide | null;
  onGuideChange: (guide: Guide) => void;
  /** Title to start a new guide with. */
  defaultTitle: string;
  /** Folder (with trailing separator) save dialogs should start in, or "". */
  saveFolder: string;
  onSaved: (path: string) => void;
  onCopied: () => void;
  onError: (message: string) => void;
  onOpenEditor: (frameIndex: number) => void;
  onOpenSettings: () => void;
  compactNavButton?: React.ReactNode;
}

const SOURCE_LABELS: Record<StepSource, string> = {
  clicks: "Recorded clicks",
  markers: "Step numbers",
};

export default function Steps({
  thumbs,
  edits,
  inputEvents,
  guide,
  onGuideChange,
  defaultTitle,
  saveFolder,
  onSaved,
  onCopied,
  onError,
  onOpenEditor,
  onOpenSettings,
  compactNavButton,
}: Props) {
  const sources = useMemo(
    () => availableSources(thumbs, inputEvents, edits),
    [thumbs, inputEvents, edits],
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // Build the guide the first time this clip's Steps are opened.
  useEffect(() => {
    if (guide !== null || sources.length === 0) return;
    const source = sources[0];
    onGuideChange({
      title: defaultTitle,
      source,
      steps: buildSteps(source, thumbs, inputEvents, edits),
    });
  }, [guide, sources, thumbs, inputEvents, edits, defaultTitle, onGuideChange]);

  const thumbByIndex = useMemo(() => {
    const map = new Map<number, FrameThumb>();
    for (const t of thumbs) map.set(t.index, t);
    return map;
  }, [thumbs]);

  // Steps whose frame has since been deleted or trimmed off are left
  // out; they come back if the frame does.
  const steps = useMemo(
    () => (guide ? guide.steps.filter((s) => thumbByIndex.has(s.frameIndex)) : []),
    [guide, thumbByIndex],
  );

  const update = useCallback(
    (change: Partial<Guide>) => {
      if (guide) onGuideChange({ ...guide, ...change });
    },
    [guide, onGuideChange],
  );

  const setCaption = (id: string, caption: string) =>
    update({ steps: guide!.steps.map((s) => (s.id === id ? { ...s, caption } : s)) });

  const removeStep = (id: string) => update({ steps: guide!.steps.filter((s) => s.id !== id) });

  const moveStep = (id: string, by: -1 | 1) => {
    const list = [...guide!.steps];
    const from = list.findIndex((s) => s.id === id);
    // Move past the neighbour that is actually shown, skipping any
    // hidden steps in between.
    let to = from + by;
    while (to >= 0 && to < list.length && !thumbByIndex.has(list[to].frameIndex)) to += by;
    if (from < 0 || to < 0 || to >= list.length) return;
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
    update({ steps: list });
  };

  const rebuild = (source: StepSource) => {
    const edited = guide?.steps.some((s) => s.caption.trim() !== "" && !/^(Click|Right-click|Middle-click) here$/.test(s.caption));
    if (
      edited &&
      !window.confirm("Rebuild the steps from the recording? Captions you've typed and steps you've removed or reordered will be reset.")
    ) {
      return;
    }
    onGuideChange({
      title: guide?.title ?? defaultTitle,
      source,
      steps: buildSteps(source, thumbs, inputEvents, edits),
    });
  };

  const details = useMemo(() => {
    const date = new Date().toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    return `${steps.length} step${steps.length === 1 ? "" : "s"} · ${date}`;
  }, [steps.length]);

  const renderAll = useCallback(async (): Promise<RenderedStep[]> => {
    const out: RenderedStep[] = [];
    for (const s of steps) {
      const thumb = thumbByIndex.get(s.frameIndex)!;
      out.push({ caption: s.caption, image: await renderStepImage(thumb, edits, s) });
    }
    return out;
  }, [steps, thumbByIndex, edits]);

  const title = guide?.title ?? defaultTitle;
  const stem = slugify(title);

  const run = async (label: string, job: () => Promise<void>) => {
    setMenuOpen(false);
    setBusy(label);
    try {
      await job();
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const exportPng = () =>
    run("Saving image", async () => {
      const target = await saveDialog({
        defaultPath: `${saveFolder}${stem}.png`,
        filters: [{ name: "PNG image", extensions: ["png"] }],
      });
      if (!target) return;
      const canvas = composeGuideCanvas(title, details, await renderAll());
      await writeFile(target, await canvasToPngBytes(canvas));
      onSaved(target);
    });

  const exportHtml = () =>
    run("Saving web page", async () => {
      const target = await saveDialog({
        defaultPath: `${saveFolder}${stem}.html`,
        filters: [{ name: "Web page", extensions: ["html"] }],
      });
      if (!target) return;
      const html = guideHtml(title, details, await renderAll());
      await writeFile(target, new TextEncoder().encode(html));
      onSaved(target);
    });

  const exportMarkdown = () =>
    run("Saving Markdown", async () => {
      // Markdown needs the pictures as separate files, so this asks for a
      // folder and writes the .md and the pictures into it.
      const folder = await openDialog({
        directory: true,
        recursive: true,
        title: "Choose a folder for the Markdown file and its pictures",
        defaultPath: saveFolder || undefined,
      });
      if (typeof folder !== "string") return;
      const base = folder.replace(/[/\\]+$/, "");
      const rendered = await renderAll();
      const names = rendered.map((_, i) => `${stem}-step-${i + 1}.png`);
      for (let i = 0; i < rendered.length; i++) {
        await writeFile(`${base}\\${names[i]}`, await canvasToPngBytes(rendered[i].image));
      }
      const md = guideMarkdown(title, details, rendered.map((r) => r.caption), names);
      const mdPath = `${base}\\${stem}.md`;
      await writeFile(mdPath, new TextEncoder().encode(md));
      onSaved(mdPath);
    });

  const copyImage = () =>
    run("Copying", async () => {
      const canvas = composeGuideCanvas(title, details, await renderAll());
      const bytes = await canvasToPngBytes(canvas);
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": new Blob([bytes], { type: "image/png" }) }),
      ]);
      onCopied();
    });

  // Esc closes the export menu.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const hasSteps = steps.length > 0;

  return (
    <div className="steps-view">
      <div className="steps-view__chrome">
        <div className="steps-view__title">
          Steps{" "}
          <span className="muted">· {steps.length}</span>
        </div>
        <div className="steps-view__tools">
          {busy && <span className="muted steps-view__busy">{busy}…</span>}
          <div className="player__save">
            <button
              type="button"
              className="icon-btn steps-view__export-btn"
              onClick={() => setMenuOpen((o) => !o)}
              disabled={!hasSteps || busy !== null}
              title={hasSteps ? "Export or copy the guide" : "Nothing to export yet"}
              aria-label="Export guide"
              aria-haspopup="true"
              aria-expanded={menuOpen}
            >
              <IconSave size={18} />
            </button>
            {menuOpen && (
              <>
                <div className="player__speed-scrim" onClick={() => setMenuOpen(false)} />
                <div className="player__save-menu" role="menu">
                  <button type="button" className="player__save-item" onClick={exportPng}>
                    Image (PNG)
                  </button>
                  <button type="button" className="player__save-item" onClick={exportHtml}>
                    Web page (HTML)
                  </button>
                  <button type="button" className="player__save-item" onClick={exportMarkdown}>
                    Markdown + pictures…
                  </button>
                  <button type="button" className="player__save-item" onClick={copyImage}>
                    Copy as image
                  </button>
                </div>
              </>
            )}
          </div>
          {compactNavButton}
        </div>
      </div>

      {guide === null && sources.length > 0 ? (
        // The guide is being built this instant (see the effect above);
        // show nothing rather than flash the "no steps" message.
        <div className="steps-view__body" />
      ) : guide === null || (!hasSteps && sources.length === 0) ? (
        <div className="steps-view__empty">
          <h3>No steps in this recording yet</h3>
          <p className="muted">
            A guide is built from the places you clicked, or from numbers you place yourself.
          </p>
          <div className="steps-view__ways">
            <div className="steps-view__way">
              <strong>From your clicks</strong>
              <span className="muted">
                Turn on <em>Show clicks</em> in Settings, then record. Every click becomes a step.
              </span>
              <button type="button" className="btn btn--sm" onClick={onOpenSettings}>
                Open Settings
              </button>
            </div>
            <div className="steps-view__way">
              <strong>By hand</strong>
              <span className="muted">
                In the Editor, pick the Step number tool and click each thing you want to point out.
              </span>
              {thumbs.length > 0 && (
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => onOpenEditor(thumbs[0].index)}
                >
                  Open Editor
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="steps-view__body">
          <div className="steps-view__head">
            <input
              className="steps-view__title-input"
              value={title}
              onChange={(e) => update({ title: e.target.value })}
              placeholder="Guide title"
              aria-label="Guide title"
            />
            <div className="steps-view__meta muted">
              <span>{details}</span>
              <span className="steps-view__source">
                From:
                {sources.length > 1 ? (
                  sources.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`chip ${guide.source === s ? "chip--active" : ""}`}
                      onClick={() => guide.source !== s && rebuild(s)}
                    >
                      {SOURCE_LABELS[s]}
                    </button>
                  ))
                ) : (
                  <span> {SOURCE_LABELS[guide.source]}</span>
                )}
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => rebuild(guide.source)}
                  title="Throw away changes made here and build the steps again from the recording"
                >
                  Rebuild
                </button>
              </span>
            </div>
          </div>

          {!hasSteps && (
            <p className="muted steps-view__none">
              Every step has been removed. Use Rebuild to bring them back.
            </p>
          )}

          <ol className="steps-view__list">
            {steps.map((s, i) => (
              <li key={s.id} className="step-card">
                <div className="step-card__row">
                  <span className="step-card__badge">{i + 1}</span>
                  <input
                    className="step-card__caption"
                    value={s.caption}
                    onChange={(e) => setCaption(s.id, e.target.value)}
                    placeholder={captionOrDefault("", i + 1) + " — say what to do"}
                    aria-label={`Caption for step ${i + 1}`}
                  />
                  <div className="step-card__actions">
                    <button
                      type="button"
                      className="icon-btn icon-btn--xs"
                      onClick={() => moveStep(s.id, -1)}
                      disabled={i === 0}
                      title="Move up"
                    >
                      <span className="step-card__flip">
                        <IconChevron size={14} />
                      </span>
                    </button>
                    <button
                      type="button"
                      className="icon-btn icon-btn--xs"
                      onClick={() => moveStep(s.id, 1)}
                      disabled={i === steps.length - 1}
                      title="Move down"
                    >
                      <IconChevron size={14} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn icon-btn--xs"
                      onClick={() => onOpenEditor(s.frameIndex)}
                      title="Open this step's frame in the Editor (to blur or annotate it)"
                    >
                      <IconImage size={14} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn icon-btn--xs"
                      onClick={() => removeStep(s.id)}
                      title="Remove this step from the guide"
                    >
                      <IconTrash size={14} />
                    </button>
                  </div>
                </div>
                <StepPreview thumb={thumbByIndex.get(s.frameIndex)!} edits={edits} step={s} />
              </li>
            ))}
          </ol>

          {hasSteps && (
            <div className="steps-view__foot muted">
              <IconCopy size={13} /> Export from the button at the top right, or copy the whole
              guide as one image.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** One step's picture, drawn when its frame, point or edits change. */
function StepPreview({
  thumb,
  edits,
  step,
}: {
  thumb: FrameThumb;
  edits: FrameEdits;
  step: GuideStep;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const frameEdits = edits[thumb.index];

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    renderStepImage(thumb, edits, step)
      .then((image) => {
        const canvas = ref.current;
        if (cancelled || !canvas) return;
        canvas.width = image.width;
        canvas.height = image.height;
        canvas.getContext("2d")?.drawImage(image, 0, 0);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // Redraw only when this step's own inputs change, not on every edit
    // to some other frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thumb.path, thumb.index, frameEdits, step.x, step.y]);

  if (failed) return <div className="step-card__image step-card__image--failed muted">Couldn't draw this step</div>;
  return <canvas ref={ref} className="step-card__image" />;
}
