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

  useEffect(() => {
    const win = getCurrentWindow();
    win.setIgnoreCursorEvents(true).catch(() => {});
  }, []);

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
    listen<RegionPayload>("indicator-region", (event) => {
      setRegion(event.payload);
      setPrep(false);
    }).then((fn) => {
      unlistenRegion = fn;
    });
    listen<boolean>("indicator-prep", (event) => {
      setPrep(event.payload);
      if (event.payload) setRegion(null);
    }).then((fn) => {
      unlistenPrep = fn;
    });
    return () => {
      unlistenRegion?.();
      unlistenPrep?.();
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

  if (!region) return null;

  const dpr = window.devicePixelRatio || region.scale || 1;
  const x = region.x / dpr;
  const y = region.y / dpr;
  const w = region.width / dpr;
  const h = region.height / dpr;

  const stroke = 2;
  const pad = 4;

  return (
    <>
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
