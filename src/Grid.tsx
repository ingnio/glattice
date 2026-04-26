import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc, FrameThumb, InputEvent } from "./lib/tauri";
import { FrameEdits, getFrameEdits } from "./lib/edits";
import { drawClicks, drawCursor, drawKeys, drawSpotlight, paintEdit } from "./lib/paintEdits";
import { SpotlightDraft } from "./lib/prefs";
import {
  IconCheckAll,
  IconCheckboxChecked,
  IconCheckboxEmpty,
  IconExcludeAll,
  IconSave,
  IconX,
} from "./icons";

interface Props {
  thumbs: FrameThumb[];
  excluded: Set<number>;
  /** Per-frame vector edits. Painted on each thumbnail so the grid
   *  matches what the player and exports produce. */
  edits: FrameEdits;
  /** Click + key events captured during recording. */
  inputEvents: InputEvent[];
  /** Spotlight vignette — applied on each thumbnail when enabled. */
  spotlight: SpotlightDraft;
  saving: boolean;
  onToggle: (index: number) => void;
  onZoom: (index: number) => void;
  /** Emit new frameOrder (array of original indices in display order). */
  onReorder: (newOrder: number[]) => void;
  /** Permanently remove frames from the display order and all exports. */
  onDelete: (indices: number[]) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onSaveSheet: () => void;
  compactNavButton?: React.ReactNode;
}

export default function Grid({
  thumbs,
  excluded,
  edits,
  inputEvents,
  spotlight,
  saving,
  onToggle,
  onZoom,
  onReorder,
  onDelete,
  onSelectAll,
  onDeselectAll,
  onSaveSheet,
  compactNavButton,
}: Props) {
  const includedCount = thumbs.length - excluded.size;

  // ——— selection state ———
  // selectedSet holds original frame indices (not positions). Positions
  // shift on reorder; indices are stable identifiers.
  const [selectedSet, setSelectedSet] = useState<Set<number>>(new Set());
  // Last-clicked position (not index) so shift-click range anchors correctly
  // after drag-reorders that change positions.
  const lastClickedPosRef = useRef<number | null>(null);

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
        // anchor stays at lastClickedPosRef for further shift-clicks
      } else {
        setSelectedSet(new Set([originalIdx]));
        lastClickedPosRef.current = pos;
      }
    },
    [thumbs],
  );

  // Delete / Backspace removes all selected frames.
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

  // ——— pointer-based reorder ———
  // HTML5 DnD is intercepted by WebView2's native file-drop handler when
  // dragDropEnabled=true (needed for GIF drop into Home). Pointer events
  // bypass that entirely and work reliably inside the webview.
  const gridRef = useRef<HTMLDivElement | null>(null);
  const dragSrcRef = useRef<number | null>(null);
  const startPtRef = useRef<{ x: number; y: number } | null>(null);
  // Set to true once the pointer moves past the drag deadzone so the
  // onClick handler can distinguish a drag-release from a plain click.
  const didDragRef = useRef(false);
  const [dragSrcPos, setDragSrcPos] = useState<number | null>(null);
  const [dropPos, setDropPos] = useState<number | null>(null);

  const commitReorder = useCallback(
    (src: number, dst: number) => {
      if (src === dst) return;
      const order = thumbs.map((t) => t.index);
      const [moved] = order.splice(src, 1);
      const insertAt = src < dst ? dst - 1 : dst;
      order.splice(insertAt, 0, moved);
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

  const insertionIdxAt = useCallback(
    (clientX: number, clientY: number): number | null => {
      const grid = gridRef.current;
      if (!grid) return null;
      const cards = grid.querySelectorAll<HTMLElement>(".grid-frame");
      for (let i = 0; i < cards.length; i++) {
        const r = cards[i].getBoundingClientRect();
        if (
          clientX >= r.left &&
          clientX < r.right &&
          clientY >= r.top &&
          clientY < r.bottom
        ) {
          return clientX < r.left + r.width / 2 ? i : i + 1;
        }
      }
      return null;
    },
    [],
  );

  return (
    <div className="grid-view">
      <div className="grid-view__chrome">
        <div className="grid-view__title">
          Frames{" "}
          <span className="muted">
            · {includedCount} / {thumbs.length}
          </span>
          {selectedSet.size > 0 && (
            <span className="muted"> · {selectedSet.size} selected</span>
          )}
        </div>
        <div className="grid-view__tools">
          <button
            type="button"
            className="icon-btn"
            onClick={onSelectAll}
            title="Include all frames"
          >
            <IconCheckAll />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={onDeselectAll}
            title="Exclude all frames"
          >
            <IconExcludeAll />
          </button>
          <span className="grid-view__sep" />
          <button
            type="button"
            className={`icon-btn ${saving ? "icon-btn--busy" : ""}`}
            onClick={onSaveSheet}
            disabled={includedCount === 0 || saving}
            title={saving ? "Saving…" : "Save sprite sheet"}
          >
            <IconSave />
          </button>
          {compactNavButton}
        </div>
      </div>

      <div
        ref={gridRef}
        className="grid-view__body"
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
          const isExcluded = excluded.has(t.index);
          const isSelected = selectedSet.has(t.index);
          const isDragging = dragSrcPos === pos;
          const lineLeft = dropPos === pos && dragSrcPos !== pos;
          const lineRight =
            pos === thumbs.length - 1 &&
            dropPos === thumbs.length &&
            dragSrcPos !== pos;
          return (
            <div
              key={t.index}
              className={[
                "grid-frame",
                isExcluded ? "grid-frame--excluded" : "",
                isSelected ? "grid-frame--selected" : "",
                isDragging ? "grid-frame--dragging" : "",
                lineLeft ? "grid-frame--line-left" : "",
                lineRight ? "grid-frame--line-right" : "",
              ]
                .filter(Boolean)
                .join(" ")}
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
              />
              <div className="grid-frame__footer">
                <span className="grid-frame__index">
                  {pos + 1}
                  {isExcluded && " · excluded"}
                </span>
                <div className="grid-frame__actions">
                  <button
                    type="button"
                    className={`icon-btn icon-btn--xs ${!isExcluded ? "icon-btn--active" : ""}`}
                    title={isExcluded ? "Include frame" : "Exclude frame"}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggle(t.index);
                    }}
                  >
                    {isExcluded ? (
                      <IconCheckboxEmpty size={14} />
                    ) : (
                      <IconCheckboxChecked size={14} />
                    )}
                  </button>
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
  );
}

interface FrameCanvasProps {
  thumb: FrameThumb;
  frameEdits: ReturnType<typeof getFrameEdits>;
  inputEvents: InputEvent[];
  spotlight: SpotlightDraft;
}

/** Per-thumbnail canvas: paints source PNG → frame edits → cursor →
 *  click rings → keys → spotlight. Matches Player + encodeVideo pipelines
 *  so the grid is a high-fidelity representation of what gets exported. */
function FrameCanvas({ thumb, frameEdits, inputEvents, spotlight }: FrameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    let cancelled = false;
    img.onload = () => {
      if (cancelled) return;
      if (
        canvas.width !== img.naturalWidth ||
        canvas.height !== img.naturalHeight
      ) {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      for (const e of frameEdits) paintEdit(ctx, img, e);
      if (thumb.cursor) drawCursor(ctx, thumb.cursor.x, thumb.cursor.y);
      if (inputEvents.length > 0) {
        drawClicks(ctx, inputEvents, thumb.elapsedMs, canvas.width, canvas.height);
        drawKeys(ctx, inputEvents, thumb.elapsedMs, canvas.width, canvas.height);
      }
      if (spotlight.enabled && thumb.cursor) {
        drawSpotlight(ctx, thumb.cursor.x, thumb.cursor.y, spotlight.radius, spotlight.dimOpacity);
      }
    };
    img.src = convertFileSrc(thumb.path);
    return () => {
      cancelled = true;
    };
  }, [thumb.path, thumb.elapsedMs, thumb.cursor, frameEdits, inputEvents, spotlight]);

  return (
    <canvas
      ref={canvasRef}
      className="grid-frame__canvas"
      aria-label={`Frame ${thumb.index + 1}`}
    />
  );
}
