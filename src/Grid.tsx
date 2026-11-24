import { useCallback, useEffect, useRef, useState, memo } from "react";
import { useCtrlWheelZoom } from "./lib/useCtrlWheelZoom";
import { convertFileSrc, FrameThumb, InputEvent } from "./lib/tauri";
import { FrameEdits, getFrameEdits } from "./lib/edits";
import { drawAnnotation, drawClicks, drawCursor, drawKeys, drawSpotlight, paintEdit } from "./lib/paintEdits";
import { AnnotationPos, SheetDraft, SpotlightDraft } from "./lib/prefs";
import { TrimRange } from "./lib/trim";
import { IconCopy, IconEye, IconLayout, IconInfo, IconPlus, IconTrash, IconX } from "./icons";

interface Props {
  thumbs: FrameThumb[];
  edits: FrameEdits;
  inputEvents: InputEvent[];
  spotlight: SpotlightDraft;
  sheet: SheetDraft;
  onSheetChange: (update: Partial<SheetDraft>) => void;
  trim: TrimRange | null;
  /** Original indices no longer in frameOrder (deleted frames). */
  deletedIndices: number[];
  onRestore: (index: number) => void;
  onZoom: (index: number) => void;
  /** `moved` is the frame that was dragged. */
  onReorder: (newOrder: number[], moved: number) => void;
  onDelete: (indices: number[]) => void;
  /** Copy one frame to the clipboard as an image. */
  onCopy: (index: number) => void;
  frameDelays: Record<number, number>;
  onDelayChange: (frameIndex: number, extraMs: number) => void;
  onInsertBlank: () => void;
  onPreview: () => void;
  compactNavButton?: React.ReactNode;
}

export default function Grid({
  thumbs,
  edits,
  inputEvents,
  spotlight,
  sheet,
  onSheetChange,
  trim,
  deletedIndices,
  onRestore,
  onZoom,
  onReorder,
  onDelete,
  onCopy,
  frameDelays,
  onDelayChange,
  onInsertBlank,
  onPreview,
  compactNavButton,
}: Props) {
  // Sprite-sheet layout controls stay tucked away until asked for.
  const [sheetBarOpen, setSheetBarOpen] = useState(false);
  // ——— selection ———
  const [selectedSet, setSelectedSet] = useState<Set<number>>(new Set());
  const lastClickedPosRef = useRef<number | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  // Frame indices shown in the Properties modal (null = closed).
  const [propertiesTargets, setPropertiesTargets] = useState<number[] | null>(null);

  // Ctrl+scroll zoom: divides effectiveCols so cells grow/shrink while
  // still filling the container width with 1fr columns.
  const [zoomScale, setZoomScale] = useState(1);
  const zoomRef = useRef(1);
  const gridBodyRef = useRef<HTMLDivElement | null>(null);
  const applyZoom = useCallback((z: number) => { zoomRef.current = z; setZoomScale(z); }, []);
  const resetZoom = useCtrlWheelZoom(gridBodyRef, applyZoom, zoomRef);

  // Right-click context menu
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    frameIdx: number;
  } | null>(null);

  // Frames affected by a context menu action: all selected if the
  // right-clicked frame is part of the selection, otherwise just that frame.
  const contextTargets =
    contextMenu === null
      ? []
      : selectedSet.size > 1 && selectedSet.has(contextMenu.frameIdx)
        ? [...selectedSet]
        : [contextMenu.frameIdx];

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const handleFrameClick = useCallback(
    (pos: number, originalIdx: number, e: React.MouseEvent) => {
      if (e.ctrlKey || e.metaKey) {
        setSelectedSet((prev) => {
          const next = new Set(prev);
          if (next.has(originalIdx)) next.delete(originalIdx);
          else next.add(originalIdx);
          return next;
        });
        lastClickedPosRef.current = pos;
      } else if (e.shiftKey && lastClickedPosRef.current !== null) {
        const lo = Math.min(lastClickedPosRef.current, pos);
        const hi = Math.max(lastClickedPosRef.current, pos);
        setSelectedSet(new Set(thumbs.slice(lo, hi + 1).map((t) => t.index)));
      } else {
        setSelectedSet(new Set([originalIdx]));
        lastClickedPosRef.current = pos;
      }
    },
    [thumbs],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      // Ctrl+C copies the selected frame as an image (one frame: the
      // clipboard holds a single image).
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
        if (selectedSet.size === 1) onCopy([...selectedSet][0]);
        return;
      }
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (selectedSet.size === 0) return;
      onDelete([...selectedSet]);
      setSelectedSet(new Set());
      lastClickedPosRef.current = null;
      setContextMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedSet, onDelete, onCopy]);

  // ——— drag-to-reorder ———
  const gridRef = useRef<HTMLDivElement | null>(null);
  const dragSrcRef = useRef<number | null>(null);
  const startPtRef = useRef<{ x: number; y: number } | null>(null);
  const didDragRef = useRef(false);
  const [dragSrcPos, setDragSrcPos] = useState<number | null>(null);
  const [dropPos, setDropPos] = useState<number | null>(null);

  const commitReorder = useCallback(
    (src: number, dst: number) => {
      if (src === dst) return;
      const order = thumbs.map((t) => t.index);
      const [moved] = order.splice(src, 1);
      order.splice(src < dst ? dst - 1 : dst, 0, moved);
      onReorder(order, moved);
    },
    [thumbs, onReorder],
  );

  const clearDrag = useCallback(() => {
    dragSrcRef.current = null;
    startPtRef.current = null;
    setDragSrcPos(null);
    setDropPos(null);
  }, []);

  const insertionIdxAt = useCallback((clientX: number, clientY: number): number | null => {
    const grid = gridRef.current;
    if (!grid) return null;
    const cards = grid.querySelectorAll<HTMLElement>(".grid-frame");
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect();
      if (clientX >= r.left && clientX < r.right && clientY >= r.top && clientY < r.bottom) {
        return clientX < r.left + r.width / 2 ? i : i + 1;
      }
    }
    return null;
  }, []);

  const trimLabel =
    trim !== null ? ` · trim ${trim.inPos + 1}–${trim.outPos + 1}` : "";

  // Effective column count for the live sheet layout preview.
  // zoomScale > 1 → fewer columns → bigger thumbnails. Works in both modes.
  const baseEffectiveCols =
    sheet.columnsMode === "manual"
      ? Math.max(1, sheet.columns)
      : Math.max(1, Math.ceil(Math.sqrt(Math.max(1, thumbs.length))));
  const effectiveCols = Math.max(1, Math.round(baseEffectiveCols / zoomScale));

  return (
    <div className="grid-view">
      {/* ——— Chrome ——— */}
      <div className="grid-view__chrome">
        <div className="grid-view__title">
          Frames{" "}
          <span className="muted">
            · {thumbs.length}{trimLabel}
          </span>
          {selectedSet.size > 0 && (
            <span className="muted"> · {selectedSet.size} selected</span>
          )}
        </div>
        <div className="grid-view__tools">
          {selectedSet.size > 0 && (
            <button
              type="button"
              className="icon-btn"
              title={`Delete ${selectedSet.size} frame${selectedSet.size > 1 ? "s" : ""}`}
              onClick={() => {
                onDelete([...selectedSet]);
                setSelectedSet(new Set());
              }}
            >
              <IconTrash size={18} />
            </button>
          )}
          {deletedIndices.length > 0 && (
            <div className="grid-view__restore-wrap">
              <button
                type="button"
                className={`chip ${restoreOpen ? "chip--active" : ""}`}
                onClick={() => setRestoreOpen((o) => !o)}
                title="Restore deleted frames"
              >
                {deletedIndices.length} deleted
              </button>
              {restoreOpen && (
                <>
                  <div
                    className="grid-view__restore-scrim"
                    onClick={() => setRestoreOpen(false)}
                  />
                  <div className="grid-view__restore-menu">
                    {[...deletedIndices].sort((a, b) => a - b).map((idx) => (
                      <button
                        key={idx}
                        type="button"
                        className="grid-view__restore-item"
                        onClick={() => {
                          onRestore(idx);
                          if (deletedIndices.length === 1) setRestoreOpen(false);
                        }}
                      >
                        Frame {idx + 1}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          <button
            type="button"
            className={`icon-btn ${sheetBarOpen ? "icon-btn--active" : ""}`}
            onClick={() => setSheetBarOpen((o) => !o)}
            aria-expanded={sheetBarOpen}
            aria-label="Sheet layout"
            title="Sheet layout: columns, padding, background and labels for the sprite sheet"
          >
            <IconLayout size={18} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={onInsertBlank}
            title="Insert blank frame"
          >
            <IconPlus size={18} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={onPreview}
            title="Preview sprite sheet"
          >
            <IconEye size={18} />
          </button>
          {compactNavButton}
        </div>
      </div>

      {/* ——— Sheet settings strip (opened from the "Sheet layout" chip) ——— */}
      {sheetBarOpen && (
      <div className="grid-view__sheet-bar">
        <div className="sheet-view__group">
          <span className="muted sheet-bar__label">Columns</span>
          <button
            type="button"
            className={`chip ${sheet.columnsMode === "auto" ? "chip--active" : ""}`}
            onClick={() => onSheetChange({ columnsMode: "auto" })}
            title="Pick the number of columns automatically"
          >
            Auto
          </button>
          <button
            type="button"
            className={`chip ${sheet.columnsMode === "manual" ? "chip--active" : ""}`}
            onClick={() => onSheetChange({ columnsMode: "manual" })}
            title="Set the number of columns yourself"
          >
            Set
          </button>
          {sheet.columnsMode === "manual" && (
            <input
              type="number" min={1} max={20} value={sheet.columns}
              onChange={(e) => onSheetChange({ columns: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })}
              className="sheet-view__num" title="Number of columns" aria-label="Number of columns"
            />
          )}
        </div>

        <span className="sheet-view__sep" />

        <div className="sheet-view__group">
          <span className="muted sheet-bar__label">Padding</span>
          <input
            type="range" min={0} max={40} step={1} value={sheet.padding}
            onChange={(e) => onSheetChange({ padding: Number(e.target.value) })}
            className="sheet-bar__range" title="Padding between frames (px)"
          />
          <span className="muted sheet-bar__val">{sheet.padding}</span>
        </div>

        <span className="sheet-view__sep" />

        <div className="sheet-view__group">
          <span className="muted sheet-bar__label">Border</span>
          <input
            type="range" min={0} max={10} step={1} value={sheet.borderWidth ?? 0}
            onChange={(e) => onSheetChange({ borderWidth: Number(e.target.value) })}
            className="sheet-bar__range" title="Border width (px, 0 = none)"
          />
          <span className="muted sheet-bar__val">{sheet.borderWidth ?? 0}</span>
        </div>

        <span className="sheet-view__sep" />

        <div className="sheet-view__group">
          <label className="sheet-view__field">
            <span className="muted sheet-bar__label">Max width</span>
            <input
              type="number" min={0} placeholder="none" value={sheet.maxWidth ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                onSheetChange({ maxWidth: v === "" ? null : Math.max(0, Number(v) || 0) || null });
              }}
              className="sheet-view__num sheet-view__num--wide"
              title="Scale the sheet down to at most this many pixels wide. Leave empty for full size."
            />
            <span className="muted sheet-bar__label">px</span>
          </label>
        </div>

        <span className="sheet-view__sep" />

        <div className="sheet-view__group">
          <span className="muted sheet-bar__label">Background</span>
          <input
            type="color" value={sheet.bgHex} disabled={sheet.bgTransparent}
            onChange={(e) => onSheetChange({ bgHex: e.target.value })}
            title="Background color" aria-label="Background color"
          />
          <button
            type="button"
            className={`chip ${sheet.bgTransparent ? "chip--active" : ""}`}
            onClick={() => onSheetChange({ bgTransparent: !sheet.bgTransparent })}
            title="Transparent background"
          >
            Transparent
          </button>
        </div>

        <span className="sheet-view__sep" />

        <div className="sheet-view__group">
          <span className="muted sheet-bar__label">Label each frame</span>
          <button
            type="button"
            className={`chip ${sheet.showFrameNumber ? "chip--active" : ""}`}
            onClick={() => onSheetChange({ showFrameNumber: !sheet.showFrameNumber })}
            aria-pressed={sheet.showFrameNumber}
            title="Print the frame number on each frame"
          >
            Number
          </button>
          <button
            type="button"
            className={`chip ${sheet.showTimestamp ? "chip--active" : ""}`}
            onClick={() => onSheetChange({ showTimestamp: !sheet.showTimestamp })}
            aria-pressed={sheet.showTimestamp}
            title="Print the time since the start on each frame"
          >
            Time
          </button>
          {(sheet.showFrameNumber || sheet.showTimestamp) && (
            <select
              value={sheet.annotationPosition}
              onChange={(e) => onSheetChange({ annotationPosition: e.target.value as AnnotationPos })}
              title="Corner the label goes in"
              aria-label="Corner the label goes in"
              className="sheet-view__pos-select"
            >
              <option value="top-left">Top left</option>
              <option value="top-right">Top right</option>
              <option value="bottom-left">Bottom left</option>
              <option value="bottom-right">Bottom right</option>
            </select>
          )}
        </div>
      </div>
      )}

      {/* ——— Grid body — live sheet layout preview ———
            Outer div: full-width, provides the background colour/checkerboard.
            Inner div: centred, constrained by max-width, holds the grid cells. */}
      <div
        ref={gridBodyRef}
        // The sheet's own background is only previewed while its layout
        // controls are open. The rest of the time this is a place to
        // arrange frames, and it uses the app's surface so it isn't a
        // white slab in the dark theme.
        className={`grid-view__body ${sheetBarOpen && sheet.bgTransparent ? "grid-view__body--transparent" : ""}`}
        style={{ background: sheetBarOpen && !sheet.bgTransparent ? sheet.bgHex : undefined }}
        onDoubleClick={(e) => {
          // Double-click on the background (not a frame) resets zoom.
          if (!(e.target as HTMLElement).closest(".grid-frame")) resetZoom();
        }}
      >
      <div
        ref={gridRef}
        className="grid-view__layout"
        style={{
          gridTemplateColumns: `repeat(${effectiveCols}, 1fr)`,
          gap: `${Math.max(0, sheet.padding)}px`,
          padding: `${Math.max(0, sheet.padding)}px`,
          ...(sheet.maxWidth && sheet.maxWidth > 0 ? { maxWidth: `${sheet.maxWidth}px` } : {}),
        }}
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest(".grid-frame")) {
            setSelectedSet(new Set());
            lastClickedPosRef.current = null;
          }
        }}
        onPointerMove={(e) => {
          if (dragSrcRef.current === null || !startPtRef.current) return;
          const { x, y } = startPtRef.current;
          if (Math.hypot(e.clientX - x, e.clientY - y) < 6) return;
          didDragRef.current = true;
          if (dragSrcPos === null) {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            setDragSrcPos(dragSrcRef.current);
          }
          const idx = insertionIdxAt(e.clientX, e.clientY);
          if (idx !== null && idx !== dropPos) setDropPos(idx);
        }}
        onPointerUp={() => {
          const src = dragSrcRef.current;
          if (src !== null && dragSrcPos !== null && dropPos !== null) {
            commitReorder(src, dropPos);
          }
          clearDrag();
        }}
        onPointerLeave={clearDrag}
      >
        {thumbs.map((t, pos) => {
          const isSelected = selectedSet.has(t.index);
          const isDragging = dragSrcPos === pos;
          const isTrimmed = trim !== null && (pos < trim.inPos || pos > trim.outPos);
          const lineLeft = dropPos === pos && dragSrcPos !== pos;
          const lineRight =
            pos === thumbs.length - 1 && dropPos === thumbs.length && dragSrcPos !== pos;
          return (
            <div
              key={t.index}
              className={[
                "grid-frame",
                isSelected ? "grid-frame--selected" : "",
                isDragging ? "grid-frame--dragging" : "",
                isTrimmed ? "grid-frame--trimmed" : "",
                lineLeft ? "grid-frame--line-left" : "",
                lineRight ? "grid-frame--line-right" : "",
              ].filter(Boolean).join(" ")}
              style={{ '--frame-border-w': `${sheet.borderWidth ?? 0}px` } as React.CSSProperties}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                const target = e.target as HTMLElement;
                if (target.closest(".grid-frame__actions")) return;
                didDragRef.current = false;
                dragSrcRef.current = pos;
                startPtRef.current = { x: e.clientX, y: e.clientY };
              }}
              onClick={(e) => {
                if (didDragRef.current) return;
                const target = e.target as HTMLElement;
                if (target.closest(".grid-frame__actions")) return;
                handleFrameClick(pos, t.index, e);
              }}
              onDoubleClick={(e) => {
                if (didDragRef.current) return;
                const target = e.target as HTMLElement;
                if (target.closest(".grid-frame__actions")) return;
                onZoom(t.index);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setContextMenu({ x: e.clientX, y: e.clientY, frameIdx: t.index });
              }}
            >
              <FrameCanvas
                thumb={t}
                frameEdits={getFrameEdits(edits, t.index)}
                inputEvents={inputEvents}
                spotlight={spotlight}
                showFrameNumber={sheet.showFrameNumber}
                showTimestamp={sheet.showTimestamp}
                annotationPosition={sheet.annotationPosition}
                frameIndex={t.index}
              />
              <span className="grid-frame__index">{pos + 1}</span>
              {isTrimmed && <span className="grid-frame__trimmed-tag">Trimmed</span>}
            </div>
          );
        })}
      </div>
      </div>

      {/* The grid's gestures aren't visible on the frames themselves, so
          say them once here. */}
      <div className="grid-view__hints muted">
        {selectedSet.size > 0 ? (
          <span>
            {selectedSet.size} selected · <kbd>Delete</kbd> removes · right-click for more ·
            click empty space to clear
          </span>
        ) : (
          <span>
            Drag to reorder · double-click to edit · right-click for more ·{" "}
            <kbd>Ctrl</kbd> or <kbd>Shift</kbd>+click to select several
          </span>
        )}
      </div>

      {propertiesTargets !== null && (
        <FramePropertiesModal
          targets={propertiesTargets}
          frameDelays={frameDelays}
          onDelayChange={onDelayChange}
          onClose={() => setPropertiesTargets(null)}
        />
      )}

      {contextMenu !== null && (
        <>
          <div
            className="context-menu__scrim"
            onClick={closeContextMenu}
            onContextMenu={(e) => { e.preventDefault(); closeContextMenu(); }}
          />
          <div
            className="context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            role="menu"
          >
            {contextTargets.length > 1 && (
              <div className="context-menu__label muted">
                {contextTargets.length} frames selected
              </div>
            )}
            <button
              type="button"
              role="menuitem"
              className="context-menu__item"
              title={
                contextTargets.length > 1
                  ? "Copies the frame you right-clicked; the clipboard holds one image"
                  : undefined
              }
              onClick={() => {
                // The clipboard holds one image, so this is always the
                // frame under the pointer, even with several selected.
                onCopy(contextMenu.frameIdx);
                closeContextMenu();
              }}
            >
              <span className="context-menu__icon"><IconCopy size={13} /></span>
              {contextTargets.length > 1 ? "Copy this frame" : "Copy image"}
            </button>
            <button
              type="button"
              role="menuitem"
              className="context-menu__item"
              onClick={() => {
                setPropertiesTargets(contextTargets);
                closeContextMenu();
              }}
            >
              <span className="context-menu__icon"><IconInfo size={13} /></span>
              Hold longer…
            </button>
            <button
              type="button"
              role="menuitem"
              className="context-menu__item context-menu__item--danger"
              onClick={() => {
                onDelete(contextTargets);
                if (contextTargets.length > 1) setSelectedSet(new Set());
                closeContextMenu();
              }}
            >
              <span className="context-menu__icon"><IconTrash size={13} /></span>
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ——— Frame Properties Modal ————————————————————————————————————————

function FramePropertiesModal({
  targets,
  frameDelays,
  onDelayChange,
  onClose,
}: {
  targets: number[];
  frameDelays: Record<number, number>;
  onDelayChange: (idx: number, ms: number) => void;
  onClose: () => void;
}) {
  const values = targets.map((idx) => frameDelays[idx] ?? 0);
  const allSame = values.every((v) => v === values[0]);
  const [duration, setDuration] = useState(allSame ? values[0] : 0);

  const apply = () => {
    targets.forEach((idx) => onDelayChange(idx, duration));
    onClose();
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") apply();
    if (e.key === "Escape") onClose();
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="frame-props-modal" onClick={(e) => e.stopPropagation()}>
        <div className="frame-props-modal__chrome">
          <span className="frame-props-modal__title">
            {targets.length > 1 ? `Hold ${targets.length} frames longer` : "Hold this frame longer"}
          </span>
          <button type="button" className="icon-btn" onClick={onClose} title="Close">
            <IconX size={16} />
          </button>
        </div>
        <div className="frame-props-modal__body">
          <label className="row">
            <span>Extra time on screen</span>
            <div className="row__control" style={{ gap: 6 }}>
              <input
                type="number"
                min={0}
                max={10000}
                step={100}
                value={duration}
                placeholder={!allSame ? "mixed" : undefined}
                onChange={(e) => setDuration(Math.max(0, Number(e.target.value) || 0))}
                onKeyDown={handleKey}
                className="frame-props-modal__input"
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
              />
              <span className="muted">ms</span>
            </div>
          </label>
          <p className="row__hint muted">
            Added on top of the frame's normal time, in playback and in
            every export. 1000 ms is one second; 0 plays it at normal speed.
          </p>
        </div>
        <div className="frame-props-modal__footer">
          <button type="button" className="btn btn--sm" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn--sm btn--primary" onClick={apply}>OK</button>
        </div>
      </div>
    </div>
  );
}

interface FrameCanvasProps {
  thumb: FrameThumb;
  frameEdits: ReturnType<typeof getFrameEdits>;
  inputEvents: InputEvent[];
  spotlight: SpotlightDraft;
  showFrameNumber: boolean;
  showTimestamp: boolean;
  annotationPosition: AnnotationPos;
  frameIndex: number;
}

const FrameCanvas = memo(function FrameCanvas({
  thumb,
  frameEdits,
  inputEvents,
  spotlight,
  showFrameNumber,
  showTimestamp,
  annotationPosition,
  frameIndex,
}: FrameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [loadedImg, setLoadedImg] = useState<HTMLImageElement | null>(null);
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const [imageRevision, setImageRevision] = useState(0);

  useEffect(() => {
    type ImgEdit = Extract<import("./lib/edits").Edit, { kind: "image" }>;
    const toLoad = (frameEdits as import("./lib/edits").Edit[])
      .filter((e): e is ImgEdit => e.kind === "image")
      .filter((e) => !imageCacheRef.current.has(e.src));
    if (toLoad.length === 0) return;
    let done = 0;
    for (const ie of toLoad) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => { imageCacheRef.current.set(ie.src, img); if (++done === toLoad.length) setImageRevision((r) => r + 1); };
      img.onerror = () => { if (++done === toLoad.length) setImageRevision((r) => r + 1); };
      img.src = ie.src;
    }
  }, [frameEdits]);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    let cancelled = false;
    img.onload = () => { if (!cancelled) setLoadedImg(img); };
    img.src = convertFileSrc(thumb.path);
    return () => { cancelled = true; };
  }, [thumb.path]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !loadedImg) return;
    if (canvas.width !== loadedImg.naturalWidth || canvas.height !== loadedImg.naturalHeight) {
      canvas.width = loadedImg.naturalWidth;
      canvas.height = loadedImg.naturalHeight;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(loadedImg, 0, 0);
    for (const e of frameEdits) paintEdit(ctx, loadedImg, e, { imageCache: imageCacheRef.current });
    if (thumb.cursor) drawCursor(ctx, thumb.cursor.x, thumb.cursor.y);
    if (inputEvents.length > 0) {
      drawClicks(ctx, inputEvents, thumb.elapsedMs, canvas.width, canvas.height);
      drawKeys(ctx, inputEvents, thumb.elapsedMs, canvas.width, canvas.height);
    }
    if (spotlight.enabled && thumb.cursor) {
      drawSpotlight(ctx, thumb.cursor.x, thumb.cursor.y, spotlight.radius, spotlight.dimOpacity);
    }
    if (showFrameNumber || showTimestamp) {
      drawAnnotation(ctx, frameIndex, thumb.elapsedMs, showFrameNumber, showTimestamp, annotationPosition);
    }
  }, [loadedImg, thumb.cursor, thumb.elapsedMs, frameEdits, inputEvents, spotlight,
      showFrameNumber, showTimestamp, annotationPosition, frameIndex, imageRevision]);

  return (
    <canvas
      ref={canvasRef}
      className="grid-frame__canvas"
      aria-label={`Frame ${thumb.index + 1}`}
    />
  );
});

