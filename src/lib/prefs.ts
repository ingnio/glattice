import { Store } from "@tauri-apps/plugin-store";

export type AnnotationPos =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export interface SheetDraft {
  columnsMode: "auto" | "manual";
  columns: number;
  padding: number;
  bgHex: string;
  bgTransparent: boolean;
  border: boolean;
  maxWidth: number | null;
  showFrameNumber: boolean;
  showTimestamp: boolean;
  annotationPosition: AnnotationPos;
}

export type Theme = "light" | "dark" | "system";

export type RegionDetection = "low" | "medium" | "high";

/** Three modes for the cursor in a recording:
 *  - "off"     — don't track or render the cursor at all.
 *  - "baked"   — draw the cursor into each captured frame (legacy).
 *  - "overlay" — capture the cursor's position per-frame but DON'T
 *                draw it into the source PNG. Preview + export overlay
 *                the cursor on top of any edits, so the cursor isn't
 *                affected by simplify, blur, etc. */
export type CursorMode = "off" | "baked" | "overlay";

export interface SimplifyDraft {
  blockSize: number;
  threshold: number;
  merge: number;
  padding: number;
  roundness: number;
}

export interface SpotlightDraft {
  enabled: boolean;
  /** Spotlight radius in source-frame pixels. */
  radius: number;
  /** Opacity of the dim vignette outside the spotlight (0–1). */
  dimOpacity: number;
}

export interface Preferences {
  fps: number;
  highQuality: boolean;
  cursorMode: CursorMode;
  /** Capture click events during recording and overlay click rings on
   * playback / export. */
  recordClicks: boolean;
  /** Capture key-press events during recording and overlay a recent-keys
   * label on playback / export. */
  recordKeys: boolean;
  /** Capture microphone audio alongside the video frames. The samples
   * are written to a WAV file next to the GIF and muxed into MP4 /
   * WebM exports. GIF playback ignores audio entirely. */
  recordAudio: boolean;
  /** Pre-recording countdown, in seconds. 0 = start immediately. */
  countdownSeconds: number;
  defaultSaveDir: string | null;
  theme: Theme;
  regionDetection: RegionDetection;
  compactUi: boolean;
  /** Persisted sheet-composition settings (not exposed on the Config
   * page — edited in the sheet Config modal and remembered silently). */
  sheet: SheetDraft;
  /** Last-used simplify-tool tuning. Persisted silently — when the
   * user tweaks the toolbar sliders the new values become the
   * starting point next time they open the editor. */
  simplify: SimplifyDraft;
  /** Spotlight vignette overlay for Player / export. */
  spotlight: SpotlightDraft;
}

export const DEFAULT_SHEET: SheetDraft = {
  columnsMode: "auto",
  columns: 4,
  padding: 4,
  bgHex: "#ffffff",
  bgTransparent: false,
  border: false,
  maxWidth: null,
  showFrameNumber: false,
  showTimestamp: false,
  annotationPosition: "top-left",
};

export const DEFAULT_SIMPLIFY: SimplifyDraft = {
  blockSize: 4,
  threshold: 18,
  merge: 4,
  padding: 1,
  roundness: 6,
};

export const DEFAULT_SPOTLIGHT: SpotlightDraft = {
  enabled: false,
  radius: 200,
  dimOpacity: 0.72,
};

export const DEFAULT_PREFS: Preferences = {
  fps: 5,
  highQuality: false,
  cursorMode: "off",
  recordClicks: false,
  recordKeys: false,
  recordAudio: false,
  countdownSeconds: 3,
  defaultSaveDir: null,
  theme: "light",
  regionDetection: "medium",
  compactUi: false,
  sheet: DEFAULT_SHEET,
  simplify: DEFAULT_SIMPLIFY,
  spotlight: DEFAULT_SPOTLIGHT,
};

export interface HistoryEntry {
  id: number;
  gifPath: string;
  thumbPath: string;
  createdAt: number;
  width: number;
  height: number;
  frameCount: number;
  durationMs: number;
  fps: number;
  fromRecording: boolean;
}

const PREFS_FILE = "settings.json";
const HISTORY_FILE = "history.json";
const PREFS_KEY = "prefs";
const HISTORY_KEY = "entries";
const HISTORY_MAX = 20;

let prefsStore: Store | null = null;
let historyStore: Store | null = null;

async function openPrefs(): Promise<Store> {
  if (!prefsStore) prefsStore = await Store.load(PREFS_FILE);
  return prefsStore;
}

async function openHistory(): Promise<Store> {
  if (!historyStore) historyStore = await Store.load(HISTORY_FILE);
  return historyStore;
}

export async function loadPrefs(): Promise<Preferences> {
  const store = await openPrefs();
  // Permit a legacy `showCursor: boolean` field while we migrate users
  // off the old toggle onto the new tri-state cursorMode enum.
  const stored = await store.get<Partial<Preferences> & { showCursor?: boolean }>(
    PREFS_KEY,
  );
  let cursorMode: CursorMode | undefined = stored?.cursorMode;
  if (cursorMode === undefined && typeof stored?.showCursor === "boolean") {
    cursorMode = stored.showCursor ? "baked" : "off";
  }
  return {
    ...DEFAULT_PREFS,
    ...(stored ?? {}),
    cursorMode: cursorMode ?? DEFAULT_PREFS.cursorMode,
    sheet: { ...DEFAULT_SHEET, ...(stored?.sheet ?? {}) },
    simplify: { ...DEFAULT_SIMPLIFY, ...(stored?.simplify ?? {}) },
    spotlight: { ...DEFAULT_SPOTLIGHT, ...(stored?.spotlight ?? {}) },
  };
}

export async function savePrefs(prefs: Preferences): Promise<void> {
  const store = await openPrefs();
  await store.set(PREFS_KEY, prefs);
  await store.save();
}

export async function loadHistory(): Promise<HistoryEntry[]> {
  const store = await openHistory();
  const entries = (await store.get<HistoryEntry[]>(HISTORY_KEY)) ?? [];
  return entries.sort((a, b) => b.createdAt - a.createdAt);
}

export async function addHistoryEntry(
  entry: HistoryEntry,
): Promise<HistoryEntry[]> {
  const store = await openHistory();
  const existing = (await store.get<HistoryEntry[]>(HISTORY_KEY)) ?? [];
  // Deduplicate by gifPath so re-opening an existing recording bumps
  // it to the top rather than adding a duplicate row.
  const next = [
    entry,
    ...existing.filter(
      (e) => e.id !== entry.id && e.gifPath !== entry.gifPath,
    ),
  ].slice(0, HISTORY_MAX);
  await store.set(HISTORY_KEY, next);
  await store.save();
  return next.sort((a, b) => b.createdAt - a.createdAt);
}

export async function removeHistoryEntry(id: number): Promise<HistoryEntry[]> {
  const store = await openHistory();
  const existing = (await store.get<HistoryEntry[]>(HISTORY_KEY)) ?? [];
  const next = existing.filter((e) => e.id !== id);
  await store.set(HISTORY_KEY, next);
  await store.save();
  return next.sort((a, b) => b.createdAt - a.createdAt);
}
