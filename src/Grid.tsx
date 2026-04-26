import { useCallback, useEffect, useRef, useState, memo } from "react";
import { convertFileSrc, FrameThumb, InputEvent } from "./lib/tauri";
import { FrameEdits, getFrameEdits } from "./lib/edits";
import { drawAnnotation, drawClicks, drawCursor, drawKeys, drawSpotlight, paintEdit } from "./lib/paintEdits";
import { AnnotationPos, SheetDraft, SpotlightDraft } from "./lib/prefs";
import { IconEye, IconTrash, IconX } from "./icons";

interface Props {
  thumbs: FrameThumb[];
  edits: FrameEdits;
  inputEvents: InputEvent[];
  spotlight: SpotlightDraft;
  sheet: SheetDraft;
  onSheetChange: (update: Partial<SheetDraft>) => void;
  trim: { inIdx: number; outIdx: number } | null;
  /** Original indices no longer in frameOrder (deleted frames). */
  deletedIndices: number[];
  onRestore: (index: number) => void;
  onZoom: (index: number) => void;
  onReorder: (newOrder: number[]) => void;
  onDelete: (indices: number[]) => void;
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
  onPreview,
  compactNavButton,
}: Props) {
  // ——— selection ———
  const [selectedSet, setSelectedSet] = useState<Set<number>>(new Set());
  const lastClickedPosRef = useRef<number | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);

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
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (selectedSet.size === 0) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      onDelete([...selectedSet]);
      setSelectedSet(new Set());
      lastClickedPosRef.current = null;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedSet, onDelete]);

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
      onReorder(order);
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
    trim !== null ? ` · trim ${trim.inIdx + 1}–${trim.outIdx + 1}` : "";

  // Effective column count for the live sheet layout preview.
  const effectiveCols =
    sheet.columnsMode === "manual"
      ? Math.max(1, sheet.columns)
      : Math.max(1, Math.ceil(Math.sqrt(Math.max(1, thumbs.length))));

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
            className="icon-btn"
            onClick={onPreview}
            title="Preview sprite sheet"
          >
            <IconEye size={18} />
          </button>
          {compactNavButton}
        </div>
      </div>

      {/* ——— Sheet settings strip ——— */}
      <div className="grid-view__sheet-bar">
        <div className="sheet-view__group">
          <button
            type="button"
            className={`chip ${sheet.columnsMode === "auto" ? "chip--active" : ""}`}
            onClick={() => onSheetChange({ columnsMode: "auto" })}
            title="Auto columns"
          >
            Auto
          </button>
          <button
            type="button"
            className={`chip ${sheet.columnsMode === "manual" ? "chip--active" : ""}`}
            onClick={() => onSheetChange({ columnsMode: "manual" })}
            title="Manual columns"
          >
            Manual
          </button>
          {sheet.columnsMode === "manual" && (
            <input
              type="number" min={1} max={20} value={sheet.columns}
              onChange={(e) => onSheetChange({ columns: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })}
              className="sheet-view__num" title="Columns"
            />
          )}
        </div>

        <span className="sheet-view__sep" />

        <div className="sheet-view__group">
          <span className="muted" style={{ fontSize: 11 }}>Pad</span>
          <input
            type="range" min={0} max={40} step={1} value={sheet.padding}
            onChange={(e) => onSheetChange({ padding: Number(e.target.value) })}
            className="sheet-bar__range" title="Padding between frames (px)"
          />
          <span className="muted sheet-bar__val">{sheet.padding}</span>
        </div>

        <span className="sheet-view__sep" />

        <div className="sheet-view__group">
          <span className="muted" style={{ fontSize: 11 }}>Border</span>
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
            <span className="muted">Max-w</span>
            <input
              type="number" min={0} placeholder="—" value={sheet.maxWidth ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                onSheetChange({ maxWidth: v === "" ? null : Math.max(0, Number(v) || 0) || null });
              }}
              className="sheet-view__num sheet-view__num--wide" title="Max width px"
            />
          </label>
        </div>

        <span className="sheet-view__sep" />

        <div className="sheet-view__group">
          <input
            type="color" value={sheet.bgHex} disabled={sheet.bgTransparent}
            onChange={(e) => onSheetChange({ bgHex: e.target.value })} title="Background color"
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
          <button
            type="button"
            className={`chip ${sheet.showFrameNumber ? "chip--active" : ""}`}
            onClick={() => onSheetChange({ showFrameNumber: !sheet.showFrameNumber })}
            title="Show frame number"
          >
            Frame #
          </button>
          <button
            type="button"
            className={`chip ${sheet.showTimestamp ? "chip--active" : ""}`}
            onClick={() => onSheetChange({ showTimestamp: !sheet.showTimestamp })}
            title="Show timestamp"
          >
            Time
          </button>
          {(sheet.showFrameNumber || sheet.showTimestamp) && (
            <select
              value={sheet.annotationPosition}
              onChange={(e) => onSheetChange({ annotationPosition: e.target.value as AnnotationPos })}
              title="Annotation position"
              className="sheet-view__pos-select"
            >
              <option value="top-left">↖</option>
              <option value="top-right">↗</option>
              <option value="bottom-left">↙</option>
              <option value="bottom-right">↘</option>
            </select>
          )}
        </div>
      </div>

      {/* ——— Grid body — live sheet layout preview ———
            Outer div: full-width, provides the background colour/checkerboard.
            Inner div: centred, constrained by max-width, holds the grid cells. */}
      <div
        className={`grid-view__body ${sheet.bgTransparent ? "grid-view__body--transparent" : ""}`}
        style={{ background: sheet.bgTransparent ? undefined : sheet.bgHex }}
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
                lineLeft ? "grid-frame--line-left" : "",
                lineRight ? "grid-frame--line-right" : "",
              ].filter(Boolean).join(" ")}
              style={(sheet.borderWidth ?? 0) > 0
                ? { boxShadow: `inset 0 0 0 ${sheet.borderWidth}px rgba(200,200,200,0.8)` }
                : undefined}
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
              <div className="grid-frame__footer">
                <span className="grid-frame__index">{pos + 1}</span>
                <div className="grid-frame__actions">
                  <button
                    type="button"
                    className="icon-btn icon-btn--xs"
                    title="Delete frame"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete([t.index]);
                    }}
                  >
                    <IconX size={14} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
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
    for (const e of frameEdits) paintEdit(ctx, loadedImg, e);
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
      showFrameNumber, showTimestamp, annotationPosition, frameIndex]);

  return (
    <canvas
      ref={canvasRef}
      className="grid-frame__canvas"
      aria-label={`Frame ${thumb.index + 1}`}
    />
  );
});

