import { useCallback, useEffect, useRef, useState } from "react";
import { useCtrlWheelZoom } from "./lib/useCtrlWheelZoom";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { copyFile } from "@tauri-apps/plugin-fs";
import { listen } from "@tauri-apps/api/event";
import { api, convertFileSrc, SheetConfig, SheetInfo } from "./lib/tauri";
import { FrameEdits } from "./lib/edits";
import { AnnotationPos, SheetDraft, SpotlightDraft } from "./lib/prefs";
// SheetView is superseded by SheetPreviewModal + Grid sheet toolbar.
// Kept for reference; no longer rendered.
import { buildSheetConfig, SheetFormat } from "./lib/sheetConfig";
import { IconSave } from "./icons";

interface Props {
  sheet: SheetDraft;
  onChange: (update: Partial<SheetDraft>) => void;
  excluded: Set<number>;
  frameOrder: number[];
  edits: FrameEdits;
  /** Player in/out trim (inclusive original frame indices). Frames
   *  outside the range are excluded from the sheet. */
  trim: { inIdx: number; outIdx: number } | null;
  spotlight: SpotlightDraft;
  defaultDir: string | null;
  /** Lifts the latest composed preview up to App so the window sizer
   *  can resize the sheet view to the actual sheet dimensions. */
  onPreview?: (info: SheetInfo | null) => void;
  compactNavButton?: React.ReactNode;
}

/** Run the backend's compose pipeline once and resolve when it emits
 *  `sheet-ready`. Encapsulated here so both preview and save share
 *  the same listen-then-invoke choreography. */
async function composeOnce(config: SheetConfig): Promise<SheetInfo> {
  const ready = new Promise<SheetInfo>((resolve, reject) => {
    let r: (() => void) | null = null;
    let e: (() => void) | null = null;
    const clean = () => {
      r?.();
      e?.();
    };
    listen<SheetInfo>("sheet-ready", (event) => {
      clean();
      resolve(event.payload);
    }).then((fn) => {
      r = fn;
    });
    listen<{ message: string }>("sheet-error", (event) => {
      clean();
      reject(new Error(event.payload.message));
    }).then((fn) => {
      e = fn;
    });
  });
  await api.generateSpriteSheet(config);
  return ready;
}

export default function SheetView({
  sheet,
  onChange,
  excluded,
  frameOrder,
  edits,
  trim,
  spotlight,
  defaultDir,
  onPreview,
  compactNavButton,
}: Props) {
  const [preview, setPreview] = useState<SheetInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const zoomRef = useRef(1);
  const [zoomDisplay, setZoomDisplay] = useState(1);
  const baseSizeRef = useRef<{ w: number; h: number } | null>(null);

  // Reset base size when a new preview loads so zoom=1 re-fits.
  useEffect(() => {
    baseSizeRef.current = null;
    zoomRef.current = 1;
    setZoomDisplay(1);
    const img = imgRef.current;
    if (img) {
      img.style.width = "";
      img.style.height = "";
      img.style.maxWidth = "";
      img.style.maxHeight = "";
    }
  }, [preview?.path]);

  const applyZoom = useCallback((z: number) => {
    const img = imgRef.current;
    if (!img) return;
    if (z === 1) {
      img.style.width = "";
      img.style.height = "";
      img.style.maxWidth = "";
      img.style.maxHeight = "";
      baseSizeRef.current = null;
    } else {
      if (!baseSizeRef.current) {
        const r = img.getBoundingClientRect();
        baseSizeRef.current = { w: r.width, h: r.height };
      }
      const { w, h } = baseSizeRef.current;
      img.style.width = `${w * z}px`;
      img.style.height = `${h * z}px`;
      img.style.maxWidth = "none";
      img.style.maxHeight = "none";
    }
    setZoomDisplay(z);
  }, []);

  const resetZoom = useCtrlWheelZoom(stageRef, applyZoom, zoomRef);

  // Mirror the local preview up to the parent so App.tsx's window
  // sizer can resize to the sheet dimensions. Fired on every change
  // including the initial null → first-preview transition.
  useEffect(() => {
    onPreview?.(preview);
  }, [preview, onPreview]);

  const generate = useCallback(async () => {
    setBusy("Composing…");
    setError(null);
    try {
      const info = await composeOnce(
        buildSheetConfig(sheet, frameOrder, edits, trim, "png", spotlight),
      );
      setPreview(info);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }, [sheet, frameOrder, edits, trim, spotlight]);

  // Auto-regenerate the preview whenever the config changes, debounced
  // so dragging a slider doesn't fire a compose per-pixel.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      generate();
    }, 300);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet, excluded, frameOrder, edits, trim]);

  const save = useCallback(async () => {
    const target = await saveDialog({
      defaultPath: defaultDir
        ? `${defaultDir.replace(/[/\\]+$/, "")}/sprite-sheet.png`
        : "sprite-sheet.png",
      // Multi-format filters — extension the user picks decides
      // the encoder. PNG is listed first so it's the default.
      filters: [
        { name: "PNG image", extensions: ["png"] },
        { name: "JPEG image", extensions: ["jpg", "jpeg"] },
        { name: "WebP image", extensions: ["webp"] },
      ],
    });
    if (!target) return;
    const ext = target.split(".").pop()?.toLowerCase() ?? "png";
    const format: SheetFormat =
      ext === "jpg" || ext === "jpeg"
        ? "jpeg"
        : ext === "webp"
          ? "webp"
          : "png";

    setBusy("Saving…");
    setError(null);
    try {
      // PNG matches the cached preview, so we can copy it directly.
      // Other formats need a fresh compose with the picked encoder.
      const source =
        format === "png" && preview
          ? preview
          : await composeOnce(
              buildSheetConfig(sheet, frameOrder, edits, trim, format, spotlight),
            );
      await copyFile(source.path, target);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }, [defaultDir, preview, sheet, frameOrder, edits, trim, spotlight]);

  return (
    <div className="sheet-view">
      <div className="sheet-view__bar">
        {/* ——— Layout ——— */}
        <div className="sheet-view__group">
          <button type="button" className={`chip ${sheet.columnsMode === "auto" ? "chip--active" : ""}`}
            onClick={() => onChange({ columnsMode: "auto" })} title="Auto columns">Auto</button>
          <button type="button" className={`chip ${sheet.columnsMode === "manual" ? "chip--active" : ""}`}
            onClick={() => onChange({ columnsMode: "manual" })} title="Manual columns">Manual</button>
          {sheet.columnsMode === "manual" && (
            <input type="number" min={1} max={20} value={sheet.columns}
              onChange={(e) => onChange({ columns: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })}
              className="sheet-view__num" title="Columns" />
          )}
        </div>

        <span className="sheet-view__sep" />

        <div className="sheet-view__group">
          <label className="sheet-view__field">
            <span className="muted">Pad</span>
            <input type="number" min={0} max={40} value={sheet.padding}
              onChange={(e) => onChange({ padding: Math.max(0, Math.min(40, Number(e.target.value) || 0)) })}
              className="sheet-view__num" />
          </label>
          <label className="sheet-view__field">
            <span className="muted">Max-w</span>
            <input type="number" min={0} placeholder="—" value={sheet.maxWidth ?? ""}
              onChange={(e) => { const v = e.target.value; onChange({ maxWidth: v === "" ? null : Math.max(0, Number(v) || 0) || null }); }}
              className="sheet-view__num sheet-view__num--wide" title="Max width px" />
          </label>
        </div>

        <span className="sheet-view__sep" />

        {/* ——— Style ——— */}
        <div className="sheet-view__group">
          <input type="color" value={sheet.bgHex} disabled={sheet.bgTransparent}
            onChange={(e) => onChange({ bgHex: e.target.value })} title="Background color" />
          <button type="button" className={`chip ${sheet.bgTransparent ? "chip--active" : ""}`}
            onClick={() => onChange({ bgTransparent: !sheet.bgTransparent })} title="Transparent background">
            Transparent
          </button>
          <button type="button" className={`chip ${(sheet.borderWidth ?? 0) > 0 ? "chip--active" : ""}`}
            onClick={() => onChange({ borderWidth: (sheet.borderWidth ?? 0) > 0 ? 0 : 1 })} title="Frame border">
            Border
          </button>
        </div>

        <span className="sheet-view__sep" />

        {/* ——— Annotations ——— */}
        <div className="sheet-view__group">
          <button type="button" className={`chip ${sheet.showFrameNumber ? "chip--active" : ""}`}
            onClick={() => onChange({ showFrameNumber: !sheet.showFrameNumber })} title="Show frame number">
            Frame #
          </button>
          <button type="button" className={`chip ${sheet.showTimestamp ? "chip--active" : ""}`}
            onClick={() => onChange({ showTimestamp: !sheet.showTimestamp })} title="Show timestamp">
            Time
          </button>
          {(sheet.showFrameNumber || sheet.showTimestamp) && (
            <select value={sheet.annotationPosition}
              onChange={(e) => onChange({ annotationPosition: e.target.value as AnnotationPos })}
              title="Annotation position" className="sheet-view__pos-select">
              <option value="top-left">↖</option>
              <option value="top-right">↗</option>
              <option value="bottom-left">↙</option>
              <option value="bottom-right">↘</option>
            </select>
          )}
        </div>

        <div className="sheet-view__group" style={{ marginLeft: "auto" }}>
          <button type="button" className={`icon-btn ${busy ? "icon-btn--busy" : ""}`}
            onClick={save} disabled={!preview || !!busy} title={busy ?? "Save sprite sheet"}>
            <IconSave />
          </button>
          {compactNavButton}
        </div>
      </div>

      {error && (
        <div className="banner banner--error" onClick={() => setError(null)}>
          {error}
          <span className="banner__dismiss">dismiss</span>
        </div>
      )}

      <div
        className="sheet-view__stage"
        ref={stageRef}
        title="Ctrl+scroll to zoom · Double-click image to reset"
      >
        {busy ? (
          <div className="sheet-view__busy">
            <div className="home__busy-spinner" />
            <div className="muted">{busy}</div>
          </div>
        ) : preview ? (
          <div className="sheet-view__preview">
            <div className="sheet-view__img-wrap">
              <img
                ref={imgRef}
                className="sheet-view__img"
                src={convertFileSrc(preview.path) + "?t=" + Date.now()}
                alt="Sprite sheet preview"
                draggable={false}
                onMouseDown={(e) => {
                  // detail >= 2 means this mousedown is part of a double-click —
                  // skip the drag so the dblclick event can fire (zoom reset).
                  if (e.button !== 0 || e.detail >= 2) return;
                  api.startFileDrag(preview.path).catch(() => {});
                }}
                onDoubleClick={resetZoom}
              />
              <div className="player__drag-hint" aria-hidden="true">
                ↗ drag out
              </div>
            </div>
            <div className="sheet-view__meta muted">
              {preview.width}×{preview.height} · {preview.columns}×
              {preview.rows} · {preview.frameCount} frames
              {zoomDisplay !== 1 && (
                <> · <button
                  type="button"
                  className="link-btn"
                  onClick={resetZoom}
                  title="Reset zoom"
                >{Math.round(zoomDisplay * 100)}%</button></>
              )}
            </div>
          </div>
        ) : (
          <div className="muted">No preview yet…</div>
        )}
      </div>
    </div>
  );
}
