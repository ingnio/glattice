import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, convertFileSrc, FrameThumb, InputEvent } from "./lib/tauri";
import { FrameEdits, getFrameEdits } from "./lib/edits";
import {
  drawClicks,
  drawCursor,
  drawKeys,
  drawSpotlight,
  paintEdit,
} from "./lib/paintEdits";
import type { SpotlightDraft } from "./lib/prefs";
import { applyTrim, TrimRange } from "./lib/trim";
import { useCtrlWheelZoom } from "./lib/useCtrlWheelZoom";
import {
  IconBoomerang,
  IconLoop,
  IconLoopOnce,
  IconNext,
  IconPause,
  IconPlay,
  IconPrev,
  IconSave,
  IconSpotlight,
  IconX,
} from "./icons";

const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4];

interface Props {
  thumbs: FrameThumb[];
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
  onExportSheet: () => void;
  spotlight: SpotlightDraft;
  /** Turn this clip's spotlight on or off. */
  onSpotlightChange: (update: Partial<SpotlightDraft>) => void;
  /** False when the clip has no recorded cursor for the spotlight to
   *  follow. The control then explains itself instead of toggling. */
  spotlightAvailable: boolean;
  /** Extra hold time in ms per original frame index. 0 / absent = no hold. */
  frameDelays: Record<number, number>;
  playing: boolean;
  onPlayingChange: (p: boolean) => void;
  loop: "loop" | "boomerang" | "once";
  onLoopChange: (l: "loop" | "boomerang" | "once") => void;
  speed: number;
  onSpeedChange: (s: number) => void;
  compactNavButton?: React.ReactNode;
}

export default function Player({
  thumbs,
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
  onExportSheet,
  spotlight,
  onSpotlightChange,
  spotlightAvailable,
  frameDelays,
  playing,
  onPlayingChange,
  loop,
  onLoopChange,
  speed,
  onSpeedChange,
  compactNavButton,
}: Props) {
  // Effective trim bounds as POSITIONS in `thumbs` (the displayed frame
  // order), both inclusive. Positions, not original frame indices: after
  // a frame is deleted, inserted or moved, indices have gaps and no
  // longer line up with the scrubber. With no trim the bounds are the
  // whole clip, so the scrubber handles always have a defined place.
  const lastPos = Math.max(0, thumbs.length - 1);
  const trimIn = trim ? Math.max(0, Math.min(trim.inPos, lastPos)) : 0;
  const trimOut = trim ? Math.max(trimIn, Math.min(trim.outPos, lastPos)) : lastPos;
  const trimActive = trim !== null;

  // The frames that play: everything, or the trimmed stretch.
  const playable = useMemo(() => applyTrim(thumbs, trim), [thumbs, trim]);
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

  // Position (0-based array index) for each original frame index. Used
  // for all scrubber percentage calculations so reordered / inserted
  // frames with non-contiguous original indices track correctly.
  const thumbPosByIdx = useMemo(() => {
    const m = new Map<number, number>();
    thumbs.forEach((t, i) => m.set(t.index, i));
    return m;
  }, [thumbs]);

  // Current playback position is an ORIGINAL frame index. This way
  // changing the trim or excludes doesn't shift the user's position.
  const [frameIdx, setFrameIdx] = useState<number>(thumbs[0]?.index ?? 0);
  const [scrubbing, setScrubbing] = useState(false);
  // Tracks playback direction for boomerang mode: +1 = forward, -1 = backward.
  const directionRef = useRef<1 | -1>(1);
  const [trimDrag, setTrimDrag] = useState<"in" | "out" | null>(null);
  const [saveMenuOpen, setSaveMenuOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const timerRef = useRef<number | null>(null);
  const frameIdxRef = useRef(frameIdx);
  frameIdxRef.current = frameIdx;

  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const [imageRevision, setImageRevision] = useState(0);

  // Preload image edits for all visible frames when edits change.
  useEffect(() => {
    type ImgEdit = Extract<import("./lib/edits").Edit, { kind: "image" }>;
    const toLoad: ImgEdit[] = [];
    for (const t of thumbs) {
      for (const e of getFrameEdits(edits, t.index)) {
        if (e.kind === "image" && !imageCacheRef.current.has(e.src)) {
          toLoad.push(e as ImgEdit);
        }
      }
    }
    if (toLoad.length === 0) return;
    let done = 0;
    for (const ie of toLoad) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => { imageCacheRef.current.set(ie.src, img); if (++done === toLoad.length) setImageRevision((r) => r + 1); };
      img.onerror = () => { if (++done === toLoad.length) setImageRevision((r) => r + 1); };
      img.src = ie.src;
    }
  }, [thumbs, edits]);
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
      // Snap to the nearest kept frame, by position in the clip: the
      // trim's first frame when the playhead is before it, its last
      // frame when after.
      const pos = thumbPosByIdx.get(frameIdx);
      const target =
        pos === undefined ? trimIn : Math.max(trimIn, Math.min(pos, trimOut));
      setFrameIdx(thumbs[target]?.index ?? playableIndices[0]);
    }
  }, [playableIndices, frameIdx, thumbs, thumbPosByIdx, trimIn, trimOut]);

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
      for (const e of frameEdits) paintEdit(ctx, img, e, { imageCache: imageCacheRef.current });
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
      if (spotlight.enabled && thumb.cursor) {
        drawSpotlight(ctx, thumb.cursor.x, thumb.cursor.y, spotlight.radius, spotlight.dimOpacity);
      }
    }
  }, [frameIdx, ready, edits, thumbByIdx, inputEvents, spotlight, imageRevision]);

  // ——— playback timer ———
  // Uses a setTimeout chain (not setInterval) so each frame waits
  // baseDuration + frameDelays[idx] before advancing — giving per-frame
  // hold control without quantising to a fixed tick period.
  useEffect(() => {
    if (!playing || scrubbing || trimDrag !== null || !ready || playableIndices.length <= 1) {
      return;
    }
    let cancelled = false;
    const baseDuration = Math.max(16, Math.round(1000 / Math.max(0.1, fps * speed)));

    const tick = (currentIdx: number) => {
      const extraMs = frameDelays[currentIdx] ?? 0;
      timerRef.current = window.setTimeout(() => {
        if (cancelled) return;
        const pos = playableIndices.indexOf(currentIdx);
        const last = playableIndices.length - 1;
        let nextIdx: number;

        if (loop === "boomerang") {
          const nextPos = pos + directionRef.current;
          if (nextPos > last) {
            directionRef.current = -1;
            nextIdx = playableIndices[Math.max(0, last - 1)];
          } else if (nextPos < 0) {
            directionRef.current = 1;
            nextIdx = playableIndices[Math.min(1, last)];
          } else {
            nextIdx = playableIndices[nextPos];
          }
        } else {
          const next = pos + 1;
          if (next > last) {
            if (loop === "loop") {
              nextIdx = playableIndices[0];
            } else {
              onPlayingChange(false);
              return; // stay on last frame
            }
          } else {
            nextIdx = playableIndices[next];
          }
        }

        setFrameIdx(nextIdx);
        tick(nextIdx);
      }, baseDuration + extraMs);
    };

    tick(frameIdxRef.current);
    return () => {
      cancelled = true;
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [playing, scrubbing, trimDrag, fps, speed, playableIndices, loop, ready, frameDelays]);

  const step = useCallback(
    (delta: number) => {
      if (playableIndices.length === 0) return;
      onPlayingChange(false);
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
    if (playing) {
      onPlayingChange(false);
    } else {
      const pos = playableIndices.indexOf(frameIdx);
      if (loop === "once" && pos >= playableIndices.length - 1) {
        setFrameIdx(playableIndices[0] ?? frameIdx);
      }
      if (loop === "boomerang") {
        directionRef.current = 1;
      }
      onPlayingChange(true);
    }
  }, [playing, frameIdx, playableIndices, loop, onPlayingChange]);

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
      const targetPos = Math.round(pct * (thumbs.length - 1));
      let best = playableIndices[0];
      let bestDist = Infinity;
      for (const idx of playableIndices) {
        const pos = thumbPosByIdx.get(idx) ?? 0;
        const d = Math.abs(pos - targetPos);
        if (d < bestDist) {
          bestDist = d;
          best = idx;
        }
      }
      return best;
    },
    [playableIndices, thumbs.length, pctFromClientX, thumbPosByIdx],
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
      onPlayingChange(false);
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
      onPlayingChange(false);
      setTrimDrag(which);
    },
    [thumbs.length],
  );

  // Every way of changing the trim ends up here. Both ends are positions
  // in `thumbs`; a range that covers the whole clip means "no trim".
  const commitTrim = useCallback(
    (inPos: number, outPos: number) => {
      if (inPos <= 0 && outPos >= lastPos) onTrimChange(null);
      else onTrimChange({ inPos, outPos });
    },
    [lastPos, onTrimChange],
  );

  useEffect(() => {
    if (trimDrag === null) return;
    const onMove = (ev: MouseEvent) => {
      const pos = rawFrameFromClientX(ev.clientX);
      if (trimDrag === "in") commitTrim(Math.min(pos, trimOut), trimOut);
      else commitTrim(trimIn, Math.max(pos, trimIn));
    };
    const onUp = () => setTrimDrag(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [trimDrag, rawFrameFromClientX, trimIn, trimOut, commitTrim]);

  // "Start here" / "End here" (and the I / O keys): move that end of the
  // trim to wherever the playhead is.
  const setTrimToCurrent = useCallback(
    (which: "in" | "out") => {
      const cur = thumbPosByIdx.get(frameIdx);
      if (cur === undefined) return;
      if (which === "in") commitTrim(Math.min(cur, trimOut), trimOut);
      else commitTrim(trimIn, Math.max(cur, trimIn));
    },
    [frameIdx, thumbPosByIdx, trimIn, trimOut, commitTrim],
  );

  const clearTrim = useCallback(() => onTrimChange(null), [onTrimChange]);

  // Keyboard equivalent of dragging a trim handle: move it one frame.
  const nudgeTrim = useCallback(
    (which: "in" | "out", delta: number) => {
      if (thumbs.length === 0) return;
      onPlayingChange(false);
      if (which === "in") {
        commitTrim(Math.max(0, Math.min(trimIn + delta, trimOut)), trimOut);
      } else {
        commitTrim(trimIn, Math.min(lastPos, Math.max(trimOut + delta, trimIn)));
      }
    },
    [thumbs.length, lastPos, trimIn, trimOut, commitTrim, onPlayingChange],
  );

  const onTrimKeyDown =
    (which: "in" | "out") => (e: React.KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      // Keep the arrow keys from also stepping the playhead.
      e.preventDefault();
      e.stopPropagation();
      nudgeTrim(which, e.key === "ArrowLeft" ? -1 : 1);
    };

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
  // All positions are array-based (0 … length-1), not original frame
  // indices, so reordered / inserted frames track correctly.
  const denom = Math.max(1, thumbs.length - 1);
  const currentPos = thumbPosByIdx.get(frameIdx) ?? 0;
  const currentPct = thumbs.length > 0 ? (currentPos / denom) * 100 : 0;
  const inPct = trimActive ? (trimIn / denom) * 100 : 0;
  const outPct = trimActive ? (trimOut / denom) * 100 : 100;

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
            {trimActive && ` (${thumbs.length - playable.length} hidden)`}
          </span>
        </div>
        <div className="player__chrome-right">
          <div className="player__save">
            <button
              type="button"
              className="icon-btn player__export-btn"
              onClick={() => setSaveMenuOpen((o) => !o)}
              title="Export as GIF, MP4, WebM or a sprite sheet"
              aria-label="Export"
              aria-haspopup="true"
              aria-expanded={saveMenuOpen}
            >
              <IconSave size={18} />
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
                  <button
                    type="button"
                    className="player__save-item"
                    onClick={() => {
                      setSaveMenuOpen(false);
                      onExportSheet();
                    }}
                  >
                    Sprite sheet…
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
                Drag into another app
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
          role="slider"
          tabIndex={playable.length === 0 ? -1 : 0}
          aria-label="Playback position"
          aria-valuemin={1}
          aria-valuemax={Math.max(1, playable.length)}
          aria-valuenow={Math.max(1, counterPos)}
          aria-valuetext={`Frame ${counterPos} of ${playable.length}`}
          title="Drag to scrub. Arrow keys step one frame; Home and End jump to the ends"
          onKeyDown={(e) => {
            // Arrow keys are handled by the Player's global shortcuts.
            if (playableIndices.length === 0) return;
            if (e.key === "Home") {
              e.preventDefault();
              onPlayingChange(false);
              setFrameIdx(playableIndices[0]);
            } else if (e.key === "End") {
              e.preventDefault();
              onPlayingChange(false);
              setFrameIdx(playableIndices[playableIndices.length - 1]);
            }
          }}
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
            onKeyDown={onTrimKeyDown("in")}
            role="slider"
            tabIndex={thumbs.length === 0 ? -1 : 0}
            aria-label="Trim start"
            aria-valuemin={1}
            aria-valuemax={trimOut + 1}
            aria-valuenow={trimIn + 1}
            title="Trim start: drag, or focus and use the arrow keys. Press I to set it to the current frame"
          />
          <div
            className={`scrub__trim-handle scrub__trim-handle--out ${
              trimDrag === "out" ? "is-dragging" : ""
            }`}
            style={{ left: `${outPct}%` }}
            onMouseDown={startTrimDrag("out")}
            onKeyDown={onTrimKeyDown("out")}
            role="slider"
            tabIndex={thumbs.length === 0 ? -1 : 0}
            aria-label="Trim end"
            aria-valuemin={trimIn + 1}
            aria-valuemax={Math.max(1, thumbs.length)}
            aria-valuenow={trimOut + 1}
            title="Trim end: drag, or focus and use the arrow keys. Press O to set it to the current frame"
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
          onClick={() => {
            if (loop === "loop") onLoopChange("boomerang");
            else if (loop === "boomerang") onLoopChange("once");
            else onLoopChange("loop");
          }}
          title={
            loop === "loop"
              ? "Repeat: loop. Click for back and forth"
              : loop === "boomerang"
                ? "Repeat: back and forth. Click to play once"
                : "Repeat: play once. Click to loop"
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
            className={`chip player__speed-btn ${speed !== 1 ? "chip--active" : ""}`}
            onClick={() => setSpeedMenuOpen((o) => !o)}
            title="Playback speed"
            aria-haspopup="true"
            aria-expanded={speedMenuOpen}
          >
            {speed}×
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
                      onSpeedChange(s);
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
        {/* Spotlight changes what is played and exported, so its state
            is always visible here. Without a recorded cursor it can't do
            anything; it then looks unavailable and, when clicked, says
            why (handled by the parent). */}
        <button
          type="button"
          className={`icon-btn ${spotlight.enabled ? "icon-btn--active" : ""} ${
            spotlightAvailable ? "" : "icon-btn--unavailable"
          }`}
          onClick={() => onSpotlightChange({ enabled: !spotlight.enabled })}
          aria-pressed={spotlight.enabled}
          aria-label="Spotlight"
          title={
            !spotlightAvailable
              ? "Spotlight needs a recorded cursor, and this clip has none"
              : spotlight.enabled
                ? "Spotlight is on: everything outside a circle around the cursor is dimmed. Click to turn it off"
                : "Spotlight: dim everything outside a circle around the cursor"
          }
        >
          <IconSpotlight active={spotlight.enabled} />
        </button>
        {/* The frame counter stays with the transport; everything about
            trimming is one group, so it wraps as a unit in narrow windows. */}
        <div className="player__counter muted">
          {playable.length > 0 ? `${counterPos} / ${playable.length}` : "—"}
        </div>
        <div className="player__trim" role="group" aria-label="Trim">
          <span className="muted player__trim-label">Trim</span>
          <button
            type="button"
            className="chip"
            onClick={() => setTrimToCurrent("in")}
            disabled={thumbs.length === 0}
            title="Start the clip at the current frame (I)"
          >
            Start here
          </button>
          <button
            type="button"
            className="chip"
            onClick={() => setTrimToCurrent("out")}
            disabled={thumbs.length === 0}
            title="End the clip at the current frame (O)"
          >
            End here
          </button>
          {trimActive && (
            <span
              className="player__trim-tag"
              title={`Playing frames ${trimIn + 1} to ${trimOut + 1}`}
            >
              {trimIn + 1}–{trimOut + 1}
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
        </div>
      </div>
    </div>
  );
}
