import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./RecordingIndicator.css";

interface RegionPayload {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}

export default function RecordingIndicator() {
  const [region, setRegion] = useState<RegionPayload | null>(null);
  // Prep mode: a centered "preparing region selection" card while the
  // main window is mid-resize. Independent of the recording marquee —
  // when prep is true we render the card and ignore region.
  const [prep, setPrep] = useState<boolean>(false);
  // Seconds left before recording starts, shown as a big number where
  // the user is looking: the middle of the region, or of the screen for
  // a full-screen take. `null` when no countdown is running.
  const [countdown, setCountdown] = useState<number | null>(null);

  useEffect(() => {
    const win = getCurrentWindow();
    win.setIgnoreCursorEvents(true).catch(() => {});
  }, []);

  // A number is only ever valid for its own second. If the next tick (or
  // the hide) never arrives, drop it rather than risk a stale countdown
  // sitting inside a region that is about to be recorded.
  useEffect(() => {
    if (countdown === null) return;
    const handle = window.setTimeout(() => setCountdown(null), 1600);
    return () => window.clearTimeout(handle);
  }, [countdown]);

  useEffect(() => {
    // Pull the current region from Rust state on mount — handles the
    // race where the first `show_recording_indicator` emit fires
    // before this listener is ready (initial load).
    invoke<RegionPayload | null>("get_indicator_region")
      .then((r) => {
        if (r) setRegion(r);
      })
      .catch(() => {});

    let unlistenRegion: (() => void) | undefined;
    let unlistenPrep: (() => void) | undefined;
    let unlistenCountdown: (() => void) | undefined;
    // Any change of region or mode clears the countdown; a countdown
    // tick always follows the region it belongs to.
    listen<RegionPayload | null>("indicator-region", (event) => {
      setRegion(event.payload);
      setPrep(false);
      setCountdown(null);
    }).then((fn) => {
      unlistenRegion = fn;
    });
    listen<boolean>("indicator-prep", (event) => {
      setPrep(event.payload);
      if (event.payload) {
        setRegion(null);
        setCountdown(null);
      }
    }).then((fn) => {
      unlistenPrep = fn;
    });
    listen<number | null>("indicator-countdown", (event) => {
      setCountdown(event.payload);
    }).then((fn) => {
      unlistenCountdown = fn;
    });
    return () => {
      unlistenRegion?.();
      unlistenPrep?.();
      unlistenCountdown?.();
    };
  }, []);

  if (prep) {
    return (
      <div className="indicator-prep" role="status" aria-live="polite">
        <div className="indicator-prep__card">
          <div className="indicator-prep__spinner" />
          <div className="indicator-prep__text">
            Preparing region selection…
          </div>
        </div>
      </div>
    );
  }

  // The countdown card. Centred on the region when there is one,
  // otherwise on the screen (the CSS default).
  const countdownCard = (center?: { x: number; y: number }) =>
    countdown === null ? null : (
      <div
        className="indicator-countdown"
        style={center ? { left: `${center.x}px`, top: `${center.y}px` } : undefined}
        role="status"
        aria-live="polite"
        aria-label={`Recording starts in ${countdown}`}
      >
        <div className="indicator-countdown__number" key={countdown}>
          {countdown}
        </div>
        <div className="indicator-countdown__hint">Ctrl+Shift+R to cancel</div>
      </div>
    );

  if (!region) return countdownCard();

  const dpr = window.devicePixelRatio || region.scale || 1;
  const x = region.x / dpr;
  const y = region.y / dpr;
  const w = region.width / dpr;
  const h = region.height / dpr;

  const stroke = 2;
  const pad = 4;

  return (
    <>
      {countdownCard({ x: x + w / 2, y: y + h / 2 })}
      <div
        className="indicator-hole"
        style={{
          left: `${x}px`,
          top: `${y}px`,
          width: `${w}px`,
          height: `${h}px`,
        }}
      />
      <svg
        className="indicator-svg"
        style={{
          left: `${x - pad}px`,
          top: `${y - pad}px`,
          width: `${w + pad * 2}px`,
          height: `${h + pad * 2}px`,
        }}
      >
        <rect
          className="indicator-ants"
          x={pad - stroke}
          y={pad - stroke}
          width={`calc(100% - ${(pad - stroke) * 2}px)`}
          height={`calc(100% - ${(pad - stroke) * 2}px)`}
          strokeWidth={stroke}
        />
      </svg>
    </>
  );
}
