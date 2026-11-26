import { useEffect, useState } from "react";
import { IconStop } from "./icons";
import { RegionInput, ScrollStatus } from "./lib/tauri";

interface Props {
  elapsedMs: number;
  fps: number;
  region: RegionInput | null;
  /** Set while a scrolling screenshot is being taken: the strip then
   *  shows how tall the picture has become instead of a timer. */
  scroll?: ScrollStatus | null;
  onStop: () => void;
  onDiscard: () => void;
}

/** `0:05`, `12:40`, or `1:02:03` once a take passes the hour. */
export function formatClock(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** What the window becomes while recording: a small strip with the
 *  timer and the only two things you can do with a take in progress,
 *  stop it or throw it away. Everything else is out of the way. */
export default function RecordingStrip({
  elapsedMs,
  fps,
  region,
  scroll = null,
  onStop,
  onDiscard,
}: Props) {
  // Discarding loses the take, so it asks first, inside the strip. A
  // system dialog would show up in the recording if the answer is no.
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirming(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming]);

  if (confirming) {
    return (
      <div className="rec-strip" role="group" aria-label="Discard">
        <span className="rec-strip__ask">
          {scroll ? "Discard this screenshot?" : "Discard this recording?"}
        </span>
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => setConfirming(false)}
          autoFocus
        >
          {scroll ? "Keep going" : "Keep recording"}
        </button>
        <button type="button" className="btn btn--sm btn--danger" onClick={onDiscard}>
          Discard
        </button>
      </div>
    );
  }

  if (scroll) {
    return (
      <div className="rec-strip" role="group" aria-label="Scrolling screenshot">
        <span className="rec-strip__dot" aria-hidden="true" />
        <span className="rec-strip__time">Scroll the page</span>
        <span className="rec-strip__meta muted" role="status">
          {scroll.truncated
            ? "Size limit reached"
            : scroll.height > 0
              ? `${scroll.height.toLocaleString()} px tall`
              : "Starting…"}
        </span>
        <span className="rec-strip__spacer" />
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          onClick={() => setConfirming(true)}
          title="Throw this screenshot away"
        >
          Discard
        </button>
        <button
          type="button"
          className="btn btn--sm btn--primary"
          onClick={onStop}
          title="Finish and open the picture (Ctrl+Shift+R)"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="rec-strip" role="group" aria-label="Recording">
      <span className="rec-strip__dot" aria-hidden="true" />
      <span className="rec-strip__time" role="timer" aria-label="Recording time">
        {formatClock(elapsedMs)}
      </span>
      <span className="rec-strip__meta muted">
        {fps} fps · {region ? `${region.width}×${region.height}` : "full screen"}
      </span>
      <span className="rec-strip__spacer" />
      <button
        type="button"
        className="btn btn--sm btn--ghost"
        onClick={() => setConfirming(true)}
        title="Throw this recording away"
      >
        Discard
      </button>
      <button
        type="button"
        className="btn btn--sm btn--danger"
        onClick={onStop}
        title="Stop and open the recording (Ctrl+Shift+R)"
      >
        <IconStop size={14} />
        Stop
      </button>
    </div>
  );
}
