import { useEffect, useRef, useCallback } from "react";

export type ZoomApplier = (zoom: number) => void;

/**
 * Attaches a Ctrl+scroll wheel handler to `containerRef` that computes
 * a new zoom level and calls `applyZoom`. Plain scroll is left untouched
 * so the container can still scroll when zoomed in.
 *
 * Returns a `resetZoom` callback the caller can invoke on double-click.
 */
export function useCtrlWheelZoom(
  containerRef: React.RefObject<HTMLElement | null>,
  applyZoom: ZoomApplier,
  zoomRef: React.MutableRefObject<number>,
) {
  const applyRef = useRef(applyZoom);
  applyRef.current = applyZoom;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const next = Math.max(0.25, Math.min(8, zoomRef.current * factor));
      zoomRef.current = next;
      applyRef.current(next);
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  // Re-arm whenever the container mounts/remounts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef.current]);

  const resetZoom = useCallback(() => {
    zoomRef.current = 1;
    applyRef.current(1);
  }, [zoomRef]);

  return resetZoom;
}
