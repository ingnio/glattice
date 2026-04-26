import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { copyFile } from "@tauri-apps/plugin-fs";
import { api, convertFileSrc, SheetConfig, SheetInfo } from "./lib/tauri";
import { FrameEdits } from "./lib/edits";
import { SheetDraft, SpotlightDraft } from "./lib/prefs";
import { buildSheetConfig, SheetFormat } from "./lib/sheetConfig";
import { IconSave, IconX } from "./icons";

async function composeOnce(config: SheetConfig): Promise<SheetInfo> {
  const ready = new Promise<SheetInfo>((resolve, reject) => {
    let r: (() => void) | null = null;
    let e: (() => void) | null = null;
    const clean = () => { r?.(); e?.(); };
    listen<SheetInfo>("sheet-ready", (event) => { clean(); resolve(event.payload); }).then((fn) => { r = fn; });
    listen<{ message: string }>("sheet-error", (event) => { clean(); reject(new Error(event.payload.message)); }).then((fn) => { e = fn; });
  });
  await api.generateSpriteSheet(config);
  return ready;
}

interface Props {
  sheet: SheetDraft;
  frameOrder: number[];
  edits: FrameEdits;
  trim: { inIdx: number; outIdx: number } | null;
  spotlight: SpotlightDraft;
  defaultDir: string | null;
  onClose: () => void;
}

export default function SheetPreviewModal({
  sheet,
  frameOrder,
  edits,
  trim,
  spotlight,
  defaultDir,
  onClose,
}: Props) {
  const [preview, setPreview] = useState<SheetInfo | null>(null);
  const [busy, setBusy] = useState<string | null>("Composing…");
  const [error, setError] = useState<string | null>(null);

  // Compose once on open — settings can't be changed from within the modal.
  useEffect(() => {
    let cancelled = false;
    composeOnce(buildSheetConfig(sheet, frameOrder, edits, trim, "png", spotlight))
      .then((info) => { if (!cancelled) { setPreview(info); setBusy(null); } })
      .catch((e) => { if (!cancelled) { setError(String(e)); setBusy(null); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = useCallback(async () => {
    const target = await saveDialog({
      defaultPath: defaultDir
        ? `${defaultDir.replace(/[/\\]+$/, "")}/sprite-sheet.png`
        : "sprite-sheet.png",
      filters: [
        { name: "PNG image", extensions: ["png"] },
        { name: "JPEG image", extensions: ["jpg", "jpeg"] },
        { name: "WebP image", extensions: ["webp"] },
      ],
    });
    if (!target) return;
    const ext = target.split(".").pop()?.toLowerCase() ?? "png";
    const format: SheetFormat =
      ext === "jpg" || ext === "jpeg" ? "jpeg" : ext === "webp" ? "webp" : "png";
    setBusy("Saving…");
    setError(null);
    try {
      const source =
        format === "png" && preview
          ? preview
          : await composeOnce(buildSheetConfig(sheet, frameOrder, edits, trim, format, spotlight));
      await copyFile(source.path, target);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }, [defaultDir, preview, sheet, frameOrder, edits, trim, spotlight]);

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="sheet-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-modal__chrome">
          <span className="sheet-modal__title">Preview</span>
          <div className="sheet-modal__actions">
            <button
              type="button"
              className={`icon-btn ${busy ? "icon-btn--busy" : ""}`}
              onClick={save}
              disabled={!preview || !!busy}
              title={busy ?? "Save sprite sheet"}
            >
              <IconSave />
            </button>
            <button type="button" className="icon-btn" onClick={onClose} title="Close">
              <IconX size={18} />
            </button>
          </div>
        </div>

        {error && (
          <div className="banner banner--error" onClick={() => setError(null)}>
            {error}
            <span className="banner__dismiss">dismiss</span>
          </div>
        )}

        <div className="sheet-modal__body">
          {busy ? (
            <div className="sheet-modal__loading">
              <div className="home__busy-spinner" />
              <div className="muted">{busy}</div>
            </div>
          ) : preview ? (
            <>
              <img
                src={convertFileSrc(preview.path) + "?t=" + Date.now()}
                alt="Sprite sheet preview"
                className="sheet-modal__img"
                draggable={false}
              />
              <div className="sheet-modal__meta muted">
                {preview.width}×{preview.height} · {preview.columns}×{preview.rows} · {preview.frameCount} frames
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
