import { useEffect, useState } from "react";
import { IconStop } from "./icons";
import { RegionInput } from "./lib/tauri";

interface Props {
  elapsedMs: number;
  fps: number;
  region: RegionInput | null;
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
      <div className="rec-strip" role="group" aria-label="Discard recording">
        <span className="rec-strip__ask">Discard this recording?</span>
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => setConfirming(false)}
          autoFocus
        >
          Keep recording
        </button>
        <button type="button" className="btn btn--sm btn--danger" onClick={onDiscard}>
          Discard
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
