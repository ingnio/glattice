import { useCallback, useEffect, useRef, useState } from "react";
import { api, convertFileSrc, RegionInput, WindowRect } from "./lib/tauri";
import { RegionDetection } from "./lib/prefs";
import "./RegionOverlay.css";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Props {
  /** Called with the picked region (physical pixels) or `null` for cancel. */
  onDone: (picked: RegionInput | null) => void;
  detection: RegionDetection;
}

// Magnifier lens geometry, CSS pixels.
const LENS_SIZE = 120;
const LENS_ZOOM = 4;
const LENS_OFFSET = 22; // push lens down-right of the true cursor point

export default function RegionOverlay({ onDone, detection }: Props) {
  const [drag, setDrag] = useState<Rect | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const [windows, setWindows] = useState<WindowRect[]>([]);
  const [viewport, setViewport] = useState<{ w: number; h: number }>({
    w: window.innerWidth,
    h: window.innerHeight,
  });
  const startRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const endRef = useRef<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);
  const shiftRef = useRef(false);

  useEffect(() => {
    const onResize = () =>
      setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    api
      .getOverlayBackground()
      .then((p) => {
        if (p) setBgUrl(convertFileSrc(p) + "?t=" + Date.now());
      })
      .catch(() => {});
    api
      .listVisibleWindows(detection)
      .then(setWindows)
      .catch(() => setWindows([]));
  }, [detection]);

  const cancel = useCallback(() => onDone(null), [onDone]);

  const commit = useCallback(
    (r: Rect, physicalAlready = false) => {
      if (r.w < 4 || r.h < 4) {
        cancel();
        return;
      }
      const dpr = physicalAlready ? 1 : window.devicePixelRatio || 1;
      onDone({
        x: Math.round(r.x * dpr),
        y: Math.round(r.y * dpr),
        width: Math.round(r.w * dpr),
        height: Math.round(r.h * dpr),
      });
    },
    [cancel, onDone],
  );

  const computeRect = (
    sx: number,
    sy: number,
    ex: number,
    ey: number,
    square: boolean,
  ): Rect => {
    let dx = ex - sx;
    let dy = ey - sy;
    if (square) {
      const side = Math.max(Math.abs(dx), Math.abs(dy));
      dx = dx < 0 ? -side : side;
      dy = dy < 0 ? -side : side;
    }
    return {
      x: Math.min(sx, sx + dx),
      y: Math.min(sy, sy + dy),
      w: Math.abs(dx),
      h: Math.abs(dy),
    };
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        cancel();
        return;
      }
      if (e.key === "Shift" && !shiftRef.current) {
        shiftRef.current = true;
        const s = startRef.current;
        const end = endRef.current;
        if (s && end && draggingRef.current) {
          setDrag(computeRect(s.x, s.y, end.x, end.y, true));
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift" && shiftRef.current) {
        shiftRef.current = false;
        const s = startRef.current;
        const end = endRef.current;
        if (s && end && draggingRef.current) {
          setDrag(computeRect(s.x, s.y, end.x, end.y, false));
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [cancel]);

  const onMouseDown = (e: React.MouseEvent) => {
    startRef.current = { x: e.clientX, y: e.clientY, time: Date.now() };
    endRef.current = { x: e.clientX, y: e.clientY };
    shiftRef.current = e.shiftKey;
    draggingRef.current = false;
    setDrag({ x: e.clientX, y: e.clientY, w: 0, h: 0 });
  };

  const onMouseMove = (e: React.MouseEvent) => {
    setCursor({ x: e.clientX, y: e.clientY });
    if (!startRef.current) return;
    endRef.current = { x: e.clientX, y: e.clientY };
    shiftRef.current = e.shiftKey;
    const sx = startRef.current.x;
    const sy = startRef.current.y;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    // Only treat as a drag once we've moved past a small threshold, so
    // a tiny slip during a click doesn't turn into a 1-pixel region.
    if (!draggingRef.current && Math.hypot(dx, dy) > 4) {
      draggingRef.current = true;
    }
    setDrag(computeRect(sx, sy, e.clientX, e.clientY, e.shiftKey));
  };

  // Find the smallest rect whose physical bounds contain the given
  // physical-pixel cursor coordinates. Prefering smallest (rather
  // than first-in-Z-order) means image-detected sub-panels win over
  // the OS parent window they live inside — which is exactly what
  // "high" mode wants.
  const findWindowAt = (physX: number, physY: number): WindowRect | null => {
    let best: WindowRect | null = null;
    let bestArea = Infinity;
    for (const w of windows) {
      if (
        physX >= w.x &&
        physX < w.x + w.width &&
        physY >= w.y &&
        physY < w.y + w.height
      ) {
        const area = w.width * w.height;
        if (area < bestArea) {
          best = w;
          bestArea = area;
        }
      }
    }
    return best;
  };

  const dpr = window.devicePixelRatio || 1;
  const hoveredWindow =
    !draggingRef.current && cursor
      ? findWindowAt(cursor.x * dpr, cursor.y * dpr)
      : null;

  const onMouseUp = () => {
    const r = drag;
    const start = startRef.current;
    const wasDragging = draggingRef.current;
    startRef.current = null;
    endRef.current = null;
    draggingRef.current = false;
    shiftRef.current = false;
    if (!start) return;

    if (wasDragging && r) {
      commit(r);
      return;
    }
    // Click without drag — snap to the window under the cursor, if any.
    if (hoveredWindow) {
      commit(
        {
          x: hoveredWindow.x,
          y: hoveredWindow.y,
          w: hoveredWindow.width,
          h: hoveredWindow.height,
        },
        true,
      );
      return;
    }
    // No drag, no window → just cancel (user probably mis-clicked).
    cancel();
  };

  // Rect to draw for visual feedback: the live drag OR the snapped
  // window under the cursor. CSS px coordinates.
  const highlight: Rect | null = drag && draggingRef.current
    ? drag
    : hoveredWindow
      ? {
          x: hoveredWindow.x / dpr,
          y: hoveredWindow.y / dpr,
          w: hoveredWindow.width / dpr,
          h: hoveredWindow.height / dpr,
        }
      : null;

  return (
    <div
      className="overlay"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      style={
        bgUrl
          ? {
              backgroundImage: `url("${bgUrl}")`,
              backgroundSize: "100% 100%",
              backgroundRepeat: "no-repeat",
            }
          : undefined
      }
    >
      <div className="overlay__hint">
        {hoveredWindow && !draggingRef.current
          ? `Click to select: ${hoveredWindow.title || "untitled window"}`
          : "Drag to select a region · Hold Shift for square · Click a window to snap · ESC to cancel"}
      </div>

      {!bgUrl && (
        <div className="overlay__loading">
          <div className="overlay__loading-spinner" />
          <div className="overlay__loading-label">Preparing region selection…</div>
        </div>
      )}
      {cursor && !drag && (
        <>
          <div
            className="overlay__guide overlay__guide--h"
            style={{ top: cursor.y }}
          />
          <div
            className="overlay__guide overlay__guide--v"
            style={{ left: cursor.x }}
          />
        </>
      )}
      {cursor && bgUrl && (() => {
        // Keep the lens on-screen — flip to the opposite side of the
        // cursor when close to an edge.
        const flipX = cursor.x + LENS_OFFSET + LENS_SIZE > viewport.w;
        const flipY = cursor.y + LENS_OFFSET + LENS_SIZE > viewport.h;
        const lensLeft = flipX
          ? cursor.x - LENS_OFFSET - LENS_SIZE
          : cursor.x + LENS_OFFSET;
        const lensTop = flipY
          ? cursor.y - LENS_OFFSET - LENS_SIZE
          : cursor.y + LENS_OFFSET;
        // Scale the background so 1 CSS px of screenshot = LENS_ZOOM px
        // on-screen. Offset so the cursor's screen position maps to the
        // lens centre.
        const bgW = viewport.w * LENS_ZOOM;
        const bgH = viewport.h * LENS_ZOOM;
        const bgX = -cursor.x * LENS_ZOOM + LENS_SIZE / 2;
        const bgY = -cursor.y * LENS_ZOOM + LENS_SIZE / 2;
        return (
          <div
            className="overlay__lens"
            style={{ left: lensLeft, top: lensTop }}
          >
            <div
              className="overlay__lens-bg"
              style={{
                backgroundImage: `url("${bgUrl}")`,
                backgroundSize: `${bgW}px ${bgH}px`,
                backgroundPosition: `${bgX}px ${bgY}px`,
              }}
            />
            <div className="overlay__lens-crosshair" />
            {drag && drag.w > 0 && drag.h > 0 && (
              <div className="overlay__lens-size">
                {Math.round(drag.w * (window.devicePixelRatio || 1))} ×{" "}
                {Math.round(drag.h * (window.devicePixelRatio || 1))}
              </div>
            )}
          </div>
        );
      })()}
      {highlight && highlight.w > 0 && highlight.h > 0 && (
        <>
          <div
            className="overlay__mask overlay__mask--top"
            style={{ height: highlight.y }}
          />
          <div
            className="overlay__mask overlay__mask--bottom"
            style={{ top: highlight.y + highlight.h }}
          />
          <div
            className="overlay__mask overlay__mask--left"
            style={{
              top: highlight.y,
              height: highlight.h,
              width: highlight.x,
            }}
          />
          <div
            className="overlay__mask overlay__mask--right"
            style={{
              top: highlight.y,
              height: highlight.h,
              left: highlight.x + highlight.w,
            }}
          />
          <div
            className={`overlay__rect ${!draggingRef.current ? "overlay__rect--snap" : ""}`}
            style={{
              left: highlight.x,
              top: highlight.y,
              width: highlight.w,
              height: highlight.h,
            }}
          >
            <div className="overlay__size">
              {Math.round(highlight.w * dpr)} × {Math.round(highlight.h * dpr)}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
