import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, convertFileSrc, FrameThumb, InputEvent } from "./lib/tauri";
import { FrameEdits, getFrameEdits } from "./lib/edits";
import {
  drawClicks,
  drawCursor,
  drawKeys,
  paintEdit,
} from "./lib/paintEdits";
import { useCtrlWheelZoom } from "./lib/useCtrlWheelZoom";
import {
  IconBoomerang,
  IconLoop,
  IconLoopOnce,
  IconMore,
  IconNext,
  IconPause,
  IconPlay,
  IconPrev,
  IconSave,
  IconX,
} from "./icons";

const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4];

export interface TrimRange {
  inIdx: number;
  outIdx: number;
}

interface Props {
  thumbs: FrameThumb[];
  excluded: Set<number>;
  edits: FrameEdits;
  inputEvents: InputEvent[];
  trim: TrimRange | null;
  onTrimChange: (trim: TrimRange | null) => void;
  /** Absolute path to the file the canvas should drag-out as. Usually
   *  the recording's GIF on disk. `null` while no source is loaded. */
  dragSourcePath: string | null;
  fps: number;
  sourceLabel: string;
  onBack: () => void;
  onSaveGif: () => void;
  onSaveVideo: (format: "mp4" | "webm") => void;
  compactNavButton?: React.ReactNode;
}

export default function Player({
  thumbs,
  excluded,
  edits,
  inputEvents,
  trim,
  onTrimChange,
  dragSourcePath,
  fps,
  sourceLabel,
  onBack,
  onSaveGif,
  onSaveVideo,
  compactNavButton,
}: Props) {
  // Effective trim bounds in ORIGINAL frame indices. When trim is null
  // we treat the bounds as the full range — that way the scrubber
  // handles always have a defined position.
  const trimIn = trim?.inIdx ?? 0;
  const trimOut = trim?.outIdx ?? Math.max(0, thumbs.length - 1);
  const trimActive = trim !== null;

  // Frames that actually play. Filtered by both manual excludes and
  // the in/out trim window.
  const playable = useMemo(
    () =>
      thumbs.filter(
        (t) =>
          !excluded.has(t.index) && t.index >= trimIn && t.index <= trimOut,
      ),
    [thumbs, excluded, trimIn, trimOut],
  );
  const playableIndices = useMemo(
    () => playable.map((t) => t.index),
    [playable],
  );

  // Lookup helpers (built once per source).
  const thumbByIdx = useMemo(() => {
    const m = new Map<number, FrameThumb>();
    for (const t of thumbs) m.set(t.index, t);
    return m;
  }, [thumbs]);

  // Current playback position is an ORIGINAL frame index. This way
  // changing the trim or excludes doesn't shift the user's position.
  const [frameIdx, setFrameIdx] = useState<number>(thumbs[0]?.index ?? 0);
  const [playing, setPlaying] = useState(true);
  const [loop, setLoop] = useState<"loop" | "boomerang" | "once">("loop");
  const [scrubbing, setScrubbing] = useState(false);
  // Tracks playback direction for boomerang mode: +1 = forward, -1 = backward.
  const directionRef = useRef<1 | -1>(1);
  const [trimDrag, setTrimDrag] = useState<"in" | "out" | null>(null);
  const [saveMenuOpen, setSaveMenuOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const timerRef = useRef<number | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const imagesRef = useRef<Map<number, HTMLImageElement>>(new Map());
  const zoomRef = useRef(1);
  // Rendered size of the canvas at zoom=1 (measured on first zoom action).
  const baseSizeRef = useRef<{ w: number; h: number } | null>(null);

  const applyZoom = useCallback((z: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (z === 1) {
      canvas.style.width = "";
      canvas.style.height = "";
      canvas.style.maxWidth = "";
      canvas.style.maxHeight = "";
      baseSizeRef.current = null;
    } else {
      if (!baseSizeRef.current) {
        const r = canvas.getBoundingClientRect();
        baseSizeRef.current = { w: r.width, h: r.height };
      }
      const { w, h } = baseSizeRef.current;
      canvas.style.width = `${w * z}px`;
      canvas.style.height = `${h * z}px`;
      canvas.style.maxWidth = "none";
      canvas.style.maxHeight = "none";
    }
  }, []);

  const resetZoom = useCtrlWheelZoom(stageRef, applyZoom, zoomRef);

  // Preload every thumb up-front so flipping frames is a synchronous
  // canvas blit. Keyed by ORIGINAL frame index so the same map works
  // regardless of how the trim / excludes filter changes.
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    const map = new Map<number, HTMLImageElement>();
    const promises = thumbs.map(
      (t) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = () => resolve();
          img.crossOrigin = "anonymous";
          img.src = convertFileSrc(t.path);
          map.set(t.index, img);
        }),
    );
    Promise.all(promises).then(() => {
      if (cancelled) return;
      imagesRef.current = map;
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [thumbs]);

  // When the frame list changes identity (new source, or user reordered
  // frames in the Grid view), seek to the first frame of the new sequence.
  // The thumbs array identity only changes when orderedThumbs is
  // recomputed — i.e., when frameOrder or the underlying thumb list changes.
  const prevThumbsRef = useRef(thumbs);
  useEffect(() => {
    if (thumbs !== prevThumbsRef.current) {
      prevThumbsRef.current = thumbs;
      if (thumbs.length > 0) setFrameIdx(thumbs[0].index);
    }
  }, [thumbs]);

  // Snap the current frame to playable when filters tighten enough to
  // exclude it. Otherwise keep the user's position fixed.
  useEffect(() => {
    if (playableIndices.length === 0) {
      if (thumbs.length > 0) setFrameIdx(thumbs[0].index);
      return;
    }
    if (!playableIndices.includes(frameIdx)) {
      // Snap to the closest playable frame (preferring the one to the
      // right of the current position so trims feel "forward").
      let best = playableIndices[0];
      let bestDist = Infinity;
      for (const idx of playableIndices) {
        const d = Math.abs(idx - frameIdx);
        if (d < bestDist) {
          bestDist = d;
          best = idx;
        }
      }
      setFrameIdx(best);
    }
  }, [playableIndices, frameIdx, thumbs]);

  // Draw the current frame to the canvas. Re-runs on every frame
  // change AND on ready-flip + edits change so the preview always
  // reflects the latest state.
  useEffect(() => {
    if (!ready) return;
    const canvas = canvasRef.current;
    const img = imagesRef.current.get(frameIdx);
    if (!canvas || !img || !img.naturalWidth) return;
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
    const thumb = thumbByIdx.get(frameIdx);
    if (thumb) {
      const frameEdits = getFrameEdits(edits, thumb.index);
      for (const e of frameEdits) paintEdit(ctx, img, e);
      if (thumb.cursor) drawCursor(ctx, thumb.cursor.x, thumb.cursor.y);
      if (inputEvents.length > 0) {
        drawClicks(
          ctx,
          inputEvents,
          thumb.elapsedMs,
          canvas.width,
          canvas.height,
        );
        drawKeys(
          ctx,
          inputEvents,
          thumb.elapsedMs,
          canvas.width,
          canvas.height,
        );
      }
    }
  }, [frameIdx, ready, edits, thumbByIdx, inputEvents]);

  // ——— playback timer ———
  useEffect(() => {
    if (
      !playing ||
      scrubbing ||
      trimDrag !== null ||
      !ready ||
      playableIndices.length <= 1
    ) {
      return;
    }
    const effectiveFps = Math.max(0.1, fps * speed);
    const interval = Math.max(16, Math.round(1000 / effectiveFps));
    timerRef.current = window.setInterval(() => {
      setFrameIdx((idx) => {
        const pos = playableIndices.indexOf(idx);
        const last = playableIndices.length - 1;

        if (loop === "boomerang") {
          const nextPos = pos + directionRef.current;
          if (nextPos > last) {
            // Hit the end — flip direction, skip back to last-1
            directionRef.current = -1;
            return playableIndices[Math.max(0, last - 1)];
          }
          if (nextPos < 0) {
            // Hit the start — flip direction, skip forward to 1
            directionRef.current = 1;
            return playableIndices[Math.min(1, last)];
          }
          return playableIndices[nextPos];
        }

        const next = pos + 1;
        if (next > last) {
          if (loop === "loop") return playableIndices[0];
          setPlaying(false);
          return playableIndices[last];
        }
        return playableIndices[next];
      });
    }, interval);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [playing, scrubbing, trimDrag, fps, speed, playableIndices, loop, ready]);

  const step = useCallback(
    (delta: number) => {
      if (playableIndices.length === 0) return;
      setPlaying(false);
      setFrameIdx((idx) => {
        let pos = playableIndices.indexOf(idx);
        if (pos < 0) pos = 0;
        const wrapped =
          (pos + delta + playableIndices.length) % playableIndices.length;
        return playableIndices[wrapped];
      });
    },
    [playableIndices],
  );

  const togglePlay = useCallback(() => {
    setPlaying((p) => {
      if (p) return false;
      const pos = playableIndices.indexOf(frameIdx);
      if (loop === "once" && pos >= playableIndices.length - 1) {
        setFrameIdx(playableIndices[0] ?? frameIdx);
      }
      if (loop === "boomerang") {
        directionRef.current = 1; // always restart forward
      }
      return true;
    });
  }, [frameIdx, playableIndices, loop]);

  // ——— scrubbing helpers ———
  // Map a clientX to a fractional position on the track [0, 1].
  const pctFromClientX = useCallback((clientX: number): number => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
  }, []);

  // Map a clientX to the closest playable original frame index.
  const playableFrameFromClientX = useCallback(
    (clientX: number): number | null => {
      if (playableIndices.length === 0 || thumbs.length === 0) return null;
      const pct = pctFromClientX(clientX);
      const targetIdx = Math.round(pct * (thumbs.length - 1));
      let best = playableIndices[0];
      let bestDist = Infinity;
      for (const idx of playableIndices) {
        const d = Math.abs(idx - targetIdx);
        if (d < bestDist) {
          bestDist = d;
          best = idx;
        }
      }
      return best;
    },
    [playableIndices, thumbs.length, pctFromClientX],
  );

  // Map a clientX to a raw original frame index, no playability snap.
  // Used when dragging trim handles — the user should be able to set
  // trim bounds without being filtered to "playable" only.
  const rawFrameFromClientX = useCallback(
    (clientX: number): number => {
      if (thumbs.length === 0) return 0;
      const pct = pctFromClientX(clientX);
      return Math.max(
        0,
        Math.min(thumbs.length - 1, Math.round(pct * (thumbs.length - 1))),
      );
    },
    [thumbs.length, pctFromClientX],
  );

  const startScrub = useCallback(
    (e: React.MouseEvent) => {
      if (playableIndices.length === 0) return;
      setPlaying(false);
      setScrubbing(true);
      const next = playableFrameFromClientX(e.clientX);
      if (next !== null) setFrameIdx(next);
    },
    [playableFrameFromClientX, playableIndices.length],
  );

  useEffect(() => {
    if (!scrubbing) return;
    const onMove = (ev: MouseEvent) => {
      const next = playableFrameFromClientX(ev.clientX);
      if (next !== null) setFrameIdx(next);
    };
    const onUp = () => setScrubbing(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [scrubbing, playableFrameFromClientX]);

  // ——— trim handle drag ———
  const startTrimDrag = useCallback(
    (which: "in" | "out") => (e: React.MouseEvent) => {
      e.stopPropagation();
      if (thumbs.length === 0) return;
      setPlaying(false);
      setTrimDrag(which);
    },
    [thumbs.length],
  );

  useEffect(() => {
    if (trimDrag === null) return;
    const onMove = (ev: MouseEvent) => {
      const idx = rawFrameFromClientX(ev.clientX);
      const lastIdx = thumbs.length - 1;
      if (trimDrag === "in") {
        const newIn = Math.min(idx, trimOut);
        const newOut = trimOut;
        if (newIn === 0 && newOut === lastIdx) onTrimChange(null);
        else onTrimChange({ inIdx: newIn, outIdx: newOut });
      } else {
        const newOut = Math.max(idx, trimIn);
        const newIn = trimIn;
        if (newIn === 0 && newOut === lastIdx) onTrimChange(null);
        else onTrimChange({ inIdx: newIn, outIdx: newOut });
      }
    };
    const onUp = () => setTrimDrag(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [trimDrag, rawFrameFromClientX, trimIn, trimOut, onTrimChange, thumbs.length]);

  const setTrimToCurrent = useCallback(
    (which: "in" | "out") => {
      if (thumbs.length === 0) return;
      const lastIdx = thumbs.length - 1;
      if (which === "in") {
        const newIn = Math.min(frameIdx, trimOut);
        if (newIn === 0 && trimOut === lastIdx) onTrimChange(null);
        else onTrimChange({ inIdx: newIn, outIdx: trimOut });
      } else {
        const newOut = Math.max(frameIdx, trimIn);
        if (trimIn === 0 && newOut === lastIdx) onTrimChange(null);
        else onTrimChange({ inIdx: trimIn, outIdx: newOut });
      }
    },
    [frameIdx, thumbs.length, trimIn, trimOut, onTrimChange],
  );

  const clearTrim = useCallback(() => onTrimChange(null), [onTrimChange]);

  // ——— keyboard ———
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if (e.key === " ") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowLeft") {
        step(-1);
      } else if (e.key === "ArrowRight") {
        step(1);
      } else if (e.key === "Escape") {
        onBack();
      } else if (e.key === "i" || e.key === "I") {
        setTrimToCurrent("in");
      } else if (e.key === "o" || e.key === "O") {
        setTrimToCurrent("out");
      } else if (e.key === "x" || e.key === "X") {
        if (trimActive) clearTrim();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, onBack, togglePlay, setTrimToCurrent, clearTrim, trimActive]);

  // ——— derived percentages for rendering ———
  const denom = Math.max(1, thumbs.length - 1);
  const currentPct = thumbs.length > 0 ? (frameIdx / denom) * 100 : 0;
  const inPct = thumbs.length > 0 ? (trimIn / denom) * 100 : 0;
  const outPct = thumbs.length > 0 ? (trimOut / denom) * 100 : 100;

  const counterPos =
    playableIndices.indexOf(frameIdx) < 0
      ? 0
      : playableIndices.indexOf(frameIdx) + 1;

  return (
    <div className="player">
      <div className="player__chrome">
        <div className="player__title">
          {sourceLabel}{" "}
          <span className="muted">
            · {playable.length} frame{playable.length === 1 ? "" : "s"}
            {(excluded.size > 0 || trimActive) &&
              ` (${thumbs.length - playable.length} hidden)`}
          </span>
        </div>
        <div className="player__chrome-right">
          <div className="player__save">
            <button
              type="button"
              className="icon-btn"
              onClick={() => setSaveMenuOpen((o) => !o)}
              title="Save as…"
              aria-haspopup="true"
              aria-expanded={saveMenuOpen}
            >
              <IconSave />
            </button>
            {saveMenuOpen && (
              <>
                <div
                  className="player__speed-scrim"
                  onClick={() => setSaveMenuOpen(false)}
                />
                <div className="player__save-menu" role="menu">
                  <button
                    type="button"
                    className="player__save-item"
                    onClick={() => {
                      setSaveMenuOpen(false);
                      onSaveGif();
                    }}
                  >
                    GIF
                  </button>
                  <button
                    type="button"
                    className="player__save-item"
                    onClick={() => {
                      setSaveMenuOpen(false);
                      onSaveVideo("mp4");
                    }}
                  >
                    MP4
                  </button>
                  <button
                    type="button"
                    className="player__save-item"
                    onClick={() => {
                      setSaveMenuOpen(false);
                      onSaveVideo("webm");
                    }}
                  >
                    WebM
                  </button>
                </div>
              </>
            )}
          </div>
          {compactNavButton}
        </div>
      </div>

      <div className="player__stage" ref={stageRef}>
        {playable.length === 0 ? (
          <div className="muted">No frames in range</div>
        ) : !ready ? (
          <div className="muted">Loading frames…</div>
        ) : (
          <div className="player__canvas-wrap">
            <canvas
              ref={canvasRef}
              className={`player__canvas ${dragSourcePath ? "player__canvas--draggable" : ""}`}
              onDoubleClick={resetZoom}
              aria-label={`Frame ${counterPos}`}
              title={
                dragSourcePath
                  ? "Drag the recording out of Glattice into another app"
                  : undefined
              }
              onMouseDown={(e) => {
                if (e.button !== 0 || !dragSourcePath || e.detail >= 2) return;
                api.startFileDrag(dragSourcePath).catch(() => {});
              }}
            />
            {dragSourcePath && (
              <div className="player__drag-hint" aria-hidden="true">
                ↗ drag out
              </div>
            )}
          </div>
        )}
      </div>

      <div className="player__scrubber">
        <div
          ref={trackRef}
          className={`scrub ${scrubbing ? "scrub--active" : ""} ${
            thumbs.length === 0 ? "scrub--disabled" : ""
          } ${trimActive ? "scrub--trimmed" : ""}`}
          onMouseDown={startScrub}
        >
          <div className="scrub__track" />
          {/* Dimmed regions for the trimmed-out areas. */}
          {trimActive && inPct > 0 && (
            <div
              className="scrub__trim-mask"
              style={{ left: 0, width: `${inPct}%` }}
            />
          )}
          {trimActive && outPct < 100 && (
            <div
              className="scrub__trim-mask"
              style={{ left: `${outPct}%`, right: 0 }}
            />
          )}
          {/* Active region between trim handles. */}
          <div
            className="scrub__trim-region"
            style={{ left: `${inPct}%`, width: `${outPct - inPct}%` }}
          />
          {/* Playback fill within the trim region. */}
          <div
            className="scrub__fill"
            style={{
              left: `${inPct}%`,
              width: `${Math.max(0, currentPct - inPct)}%`,
            }}
          />
          <div
            className="scrub__handle"
            style={{ left: `${currentPct}%` }}
          />
          <div
            className={`scrub__trim-handle scrub__trim-handle--in ${
              trimDrag === "in" ? "is-dragging" : ""
            }`}
            style={{ left: `${inPct}%` }}
            onMouseDown={startTrimDrag("in")}
            title="Drag to set in point (or press I)"
          />
          <div
            className={`scrub__trim-handle scrub__trim-handle--out ${
              trimDrag === "out" ? "is-dragging" : ""
            }`}
            style={{ left: `${outPct}%` }}
            onMouseDown={startTrimDrag("out")}
            title="Drag to set out point (or press O)"
          />
        </div>
      </div>

      <div className="player__controls">
        <button
          type="button"
          className="icon-btn"
          onClick={() => step(-1)}
          disabled={playable.length === 0}
          title="Previous frame"
        >
          <IconPrev />
        </button>
        <button
          type="button"
          className="icon-btn icon-btn--lg"
          onClick={togglePlay}
          disabled={playable.length === 0}
          title={playing ? "Pause" : "Play"}
        >
          {playing ? <IconPause size={24} /> : <IconPlay size={24} />}
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => step(1)}
          disabled={playable.length === 0}
          title="Next frame"
        >
          <IconNext />
        </button>
        <button
          type="button"
          className={`icon-btn ${loop !== "once" ? "icon-btn--active" : ""}`}
          onClick={() =>
            setLoop((l) => {
              if (l === "loop") return "boomerang";
              if (l === "boomerang") return "once";
              return "loop";
            })
          }
          title={
            loop === "loop"
              ? "Looping — click for boomerang"
              : loop === "boomerang"
                ? "Boomerang — click to play once"
                : "Play once — click to loop"
          }
        >
          {loop === "loop" ? (
            <IconLoop />
          ) : loop === "boomerang" ? (
            <IconBoomerang />
          ) : (
            <IconLoopOnce />
          )}
        </button>
        <div className="player__speed">
          <button
            type="button"
            className={`icon-btn ${speed !== 1 ? "icon-btn--active" : ""}`}
            onClick={() => setSpeedMenuOpen((o) => !o)}
            title={`Playback speed: ${speed}×`}
            aria-haspopup="true"
            aria-expanded={speedMenuOpen}
          >
            <IconMore />
          </button>
          {speedMenuOpen && (
            <>
              <div
                className="player__speed-scrim"
                onClick={() => setSpeedMenuOpen(false)}
              />
              <div className="player__speed-menu" role="menu">
                <div className="player__speed-label muted">Speed</div>
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`player__speed-item ${s === speed ? "player__speed-item--active" : ""}`}
                    onClick={() => {
                      setSpeed(s);
                      setSpeedMenuOpen(false);
                    }}
                  >
                    {s}×
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="player__counter muted">
          {playable.length > 0 ? (
            <>
              {counterPos} / {playable.length}
              {trimActive && (
                <span className="player__trim-tag" title="Trim is active">
                  · trim {trimIn + 1}-{trimOut + 1}
                  <button
                    type="button"
                    className="player__trim-clear"
                    onClick={clearTrim}
                    title="Clear trim (X)"
                  >
                    <IconX size={12} />
                  </button>
                </span>
              )}
            </>
          ) : (
            "—"
          )}
        </div>
      </div>
    </div>
  );
}
