import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Edit } from "./edits";

export interface PlatformStatus {
  supported: boolean;
  hasPermission: boolean;
  highQualityAvailable: boolean;
}

export interface FrameThumb {
  index: number;
  path: string;
  elapsedMs: number;
  /** Cursor position (source-frame pixels) when the recording captured
   *  it. `null` for cursor-less recordings or imported GIFs. */
  cursor: { x: number; y: number } | null;
}

export interface RecordingInfo {
  path: string;
  frameCount: number;
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  sourceId: number;
  /** WAV file path with the recorded mic audio. `null` when audio
   *  recording was off, the device wasn't available, or the capture
   *  silently failed. */
  audioPath: string | null;
  /** True when the cursor is already drawn into the frames, so the
   *  captured GIF matches the preview without re-rendering the cursor. */
  cursorBaked?: boolean;
}

export interface GifInfo {
  path: string;
  frameCount: number;
  width: number;
  height: number;
  durationMs: number;
  inferredFps: number;
  sourceId: number;
}

export interface SheetConfig {
  columns: number | null;
  frameStride: number;
  padding: number;
  background: [number, number, number, number];
  /** Border width in source pixels. 0 = no border. */
  borderWidth: number;
  borderColor: [number, number, number, number];
  format: "png" | "jpeg" | "webp";
  maxWidth: number | null;
  showFrameNumber: boolean;
  showTimestamp: boolean;
  annotationPosition: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  selectedIndices: number[] | null;
  /** Per-frame vector edits, keyed by frame index. Baked in at compose. */
  edits: Record<number, Edit[]> | null;
  /** Spotlight vignette. When set, frames without a cursor are left unaffected. */
  spotlight: { radius: number; dimOpacity: number } | null;
}

export interface InsertedFrame {
  thumb: FrameThumb;
  playerFrame: FrameThumb;
}

export interface SheetInfo {
  path: string;
  width: number;
  height: number;
  columns: number;
  rows: number;
  frameCount: number;
  byteSize: number;
  mime: string;
}

export interface RegionInput {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MonitorGeometry {
  width: number;
  height: number;
  x: number;
  y: number;
  scaleFactor: number;
}

export type InputEvent =
  | {
      kind: "click";
      timestampMs: number;
      x: number;
      y: number;
      button: "left" | "right" | "middle";
    }
  | {
      kind: "key";
      timestampMs: number;
      label: string;
      modifiers: { ctrl: boolean; shift: boolean; alt: boolean; meta: boolean };
    };

export interface MonitorInfo {
  index: number;
  name: string;
  width: number;
  height: number;
  x: number;
  y: number;
  scaleFactor: number;
  isPrimary: boolean;
  isSelected: boolean;
}

export const api = {
  platformCheck: () => invoke<PlatformStatus>("platform_check"),
  isRecording: () => invoke<boolean>("is_recording"),
  startRecording: (
    fps: number,
    cursorMode: "off" | "baked" | "overlay",
    recordClicks: boolean,
    recordKeys: boolean,
    recordAudio: boolean,
  ) =>
    invoke<void>("start_recording", {
      fps,
      cursorMode,
      recordClicks,
      recordKeys,
      recordAudio,
    }),
  listInputEvents: () => invoke<InputEvent[]>("list_input_events"),
  startFileDrag: (path: string) =>
    invoke<void>("start_file_drag", { path }),
  stopRecording: (highQuality: boolean) =>
    invoke<number>("stop_recording", { highQuality }),
  /** Stop capturing and throw the take away without encoding it. */
  discardRecording: () => invoke<void>("discard_recording"),
  /** Shrink the main window into the small always-on-top recording
   *  strip (`active`, with its content size in logical px), or give it
   *  back its normal constraints. */
  setRecordingStrip: (active: boolean, width?: number, height?: number) =>
    invoke<void>("set_recording_strip", { active, width, height }),
  /** Open the file manager with `path` selected. */
  revealInFolder: (path: string) => invoke<void>("reveal_in_folder", { path }),
  /** Fire-and-forget; the decoded GifInfo arrives via `gif-ready`. */
  loadGif: (path: string) => invoke<number>("load_gif", { path }),
  listFrameThumbs: () => invoke<FrameThumb[]>("list_frame_thumbs"),
  listPlayerFrames: () => invoke<FrameThumb[]>("list_player_frames"),
  /** Fire-and-forget; result arrives via the `sheet-ready` event. */
  generateSpriteSheet: (config: SheetConfig) =>
    invoke<void>("generate_sprite_sheet", { config }),
  getRegion: () => invoke<RegionInput | null>("get_region"),
  setRegion: (region: RegionInput) => invoke<void>("set_region", { region }),
  clearRegion: () => invoke<void>("clear_region"),
  primaryMonitor: () => invoke<MonitorGeometry>("primary_monitor"),
  listMonitors: () => invoke<MonitorInfo[]>("list_monitors"),
  setMonitor: (index: number | null) =>
    invoke<void>("set_monitor", { index }),
  /** Snapshot the monitor under the cursor and cache it as the overlay
   *  backdrop. Call on hover of "Select region" so the screenshot is
   *  ready by the time the user clicks — eliminates the capture delay. */
  precaptureOverlayBg: () => invoke<void>("precapture_overlay_bg"),
  /** Fire-and-forget; the PrevWindow info arrives via `overlay-ready`. */
  enterRegionOverlay: () => invoke<void>("enter_region_overlay"),
  /** Light up the prep-mode spinner card on the indicator window
   *  immediately, without waiting for the screenshot+resize work that
   *  enter_region_overlay kicks off. The Rust task hides the spinner
   *  itself once it finishes — callers don't need a paired hide. */
  showPrepIndicator: () => invoke<void>("show_prep_indicator"),
  leaveRegionOverlay: (prev: PrevWindow) =>
    invoke<void>("leave_region_overlay", { prev }),
  showMainWindow: () => invoke<void>("show_main_window"),
  getOverlayBackground: () => invoke<string | null>("get_overlay_background"),
  listVisibleWindows: (level: "low" | "medium" | "high") =>
    invoke<WindowRect[]>("list_visible_windows", { level }),
  takePendingFile: () => invoke<string | null>("take_pending_file"),
  insertBlankFrame: () => invoke<InsertedFrame>("insert_blank_frame"),
  showRecordingIndicator: (r: RegionInput) =>
    invoke<void>("show_recording_indicator", {
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
    }),
  hideRecordingIndicator: () => invoke<void>("hide_recording_indicator"),
  /** Show the pre-recording countdown on screen (in the region, or in
   *  the middle of the screen). Call once per tick. */
  showCountdownIndicator: (seconds: number) =>
    invoke<void>("show_countdown_indicator", { seconds }),
  /** Take the on-screen countdown away: on cancel, and before capture. */
  hideCountdownIndicator: () => invoke<void>("hide_countdown_indicator"),
};

export interface PrevWindow {
  prevX: number;
  prevY: number;
  prevWidth: number;
  prevHeight: number;
  prevDecorated: boolean;
}

export interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
}

export { convertFileSrc };
