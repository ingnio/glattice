import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  currentMonitor,
  getCurrentWindow,
  LogicalSize,
  PhysicalPosition,
} from "@tauri-apps/api/window";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { copyFile, writeFile } from "@tauri-apps/plugin-fs";
import RegionOverlay from "./RegionOverlay";
import Home, { CaptureMode } from "./Home";
import Config from "./Config";
import Player from "./Player";
import Grid from "./Grid";
import Zoom from "./Zoom";
import Steps from "./Steps";
import { Guide } from "./lib/steps";
import SheetPreviewModal from "./SheetPreviewModal";
import ErrorBanner from "./ErrorBanner";
import RecordingStrip from "./RecordingStrip";
import Toast from "./Toast";
import ShortcutsModal from "./ShortcutsModal";
import {
  api,
  FrameThumb,
  GifInfo,
  InputEvent,
  PrevWindow,
  RecordingInfo,
  RegionInput,
} from "./lib/tauri";

import { encodeVideo, VideoFormat } from "./lib/encodeVideo";
import { encodeGif } from "./lib/encodeGif";
import { copyFrameToClipboard } from "./lib/copyFrame";
import { applyTrim, remapTrim, TrimRange } from "./lib/trim";
import { FrameEdits } from "./lib/edits";
import {
  addHistoryEntry,
  DEFAULT_PREFS,
  HistoryEntry,
  loadHistory,
  loadPrefs,
  Preferences,
  removeHistoryEntry,
  savePrefs,
  SheetDraft,
  SimplifyDraft,
  SpotlightDraft,
} from "./lib/prefs";
import "./App.css";
import { IconGrid, IconHome, IconImage, IconMore, IconPlay, IconSteps } from "./icons";

type Source =
  | { kind: "recording"; info: RecordingInfo }
  | { kind: "gif"; info: GifInfo };

type View = "home" | "config" | "player" | "grid" | "zoom" | "steps";

/** Content size of the window while it is the recording strip. */
const STRIP_SIZE: [number, number] = [380, 56];

/** `2026-11-23-210733` in local time, for default export file names. */
function fileStamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

/** Last path segment, whichever slash the path uses. */
function baseName(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}

/** Whether two paths name the same file, ignoring slash style and case
 *  (Windows and default macOS volumes are case-insensitive). */
function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/[/\\]+/g, "/").toLowerCase();
  return norm(a) === norm(b);
}

/** Move the window, if needed, so all of it sits inside the monitor's
 *  work area (the screen minus the taskbar). It only ever moves the
 *  window; if the window is larger than the work area, the top-left
 *  corner wins so the title bar stays reachable. */
async function keepWindowOnScreen(): Promise<void> {
  try {
    const win = getCurrentWindow();
    const [monitor, pos, size] = await Promise.all([
      currentMonitor(),
      win.outerPosition(),
      win.outerSize(),
    ]);
    if (!monitor) return;
    const area = monitor.workArea;
    const x = Math.max(
      area.position.x,
      Math.min(pos.x, area.position.x + area.size.width - size.width),
    );
    const y = Math.max(
      area.position.y,
      Math.min(pos.y, area.position.y + area.size.height - size.height),
    );
    if (x !== pos.x || y !== pos.y) {
      await win.setPosition(new PhysicalPosition(x, y));
    }
  } catch {
    // Best effort: a window that can't be measured is left where it is.
  }
}

export default function App() {
  const [view, setView] = useState<View>("home");
  // What Home's capture button and the hotkey do. Not saved: it goes
  // back to recording when the app is restarted.
  const [captureMode, setCaptureMode] = useState<CaptureMode>("record");
  const captureModeRef = useRef<CaptureMode>("record");
  captureModeRef.current = captureMode;
  // The step-by-step guide for the loaded clip, once its Steps tab has
  // been opened. Kept here so captions survive moving between tabs.
  const [guide, setGuide] = useState<Guide | null>(null);
  const [zoomIndex, setZoomIndex] = useState<number | null>(null);

  const [supported, setSupported] = useState<boolean | null>(null);
  const [prefsLoaded, setPrefsLoaded] = useState<boolean>(false);
  const [highQualityAvailable, setHighQualityAvailable] = useState<boolean>(false);
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFS);

  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordStart, setRecordStart] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number>(0);

  const [source, setSource] = useState<Source | null>(null);
  const [compactNavOpen, setCompactNavOpen] = useState(false);
  // Natural content height reported by Home, tagged with the layout it
  // was measured in (null = not measured yet).
  const [homeMeasure, setHomeMeasure] = useState<{
    h: number;
    compact: boolean;
  } | null>(null);
  const handleHomeHeight = useCallback(
    (h: number, compact: boolean) => setHomeMeasure({ h, compact }),
    [],
  );
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [thumbs, setThumbs] = useState<FrameThumb[]>([]);
  const [playerFrames, setPlayerFrames] = useState<FrameThumb[]>([]);
  // User-controlled display order: an array of original frame indices.
  // Initialised to [0, 1, 2, …] on load; drag-to-reorder updates it.
  const [frameOrder, setFrameOrder] = useState<number[]>([]);
  const [edits, setEdits] = useState<FrameEdits>({});
  const [frameDelays, setFrameDelays] = useState<Record<number, number>>({});
  const [inputEvents, setInputEvents] = useState<InputEvent[]>([]);
  // The kept stretch of the clip, as positions in the displayed frame
  // order (see lib/trim.ts). null = the whole clip. Frames outside it
  // are skipped in playback and left out of every export.
  const [trim, setTrim] = useState<TrimRange | null>(null);

  // Every change to the frame order after load goes through here, so the
  // trim follows its frames to their new positions instead of staying on
  // the same slots (which would start cutting different frames).
  const frameOrderRef = useRef<number[]>([]);
  frameOrderRef.current = frameOrder;
  const changeFrameOrder = useCallback(
    (update: number[] | ((prev: number[]) => number[]), moved?: number) => {
      const prev = frameOrderRef.current;
      const next = typeof update === "function" ? update(prev) : update;
      frameOrderRef.current = next;
      setFrameOrder(next);
      setTrim((t) => remapTrim(prev, next, t, moved));
    },
    [],
  );

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [region, setRegion] = useState<RegionInput | null>(null);
  const [overlayPrev, setOverlayPrev] = useState<PrevWindow | null>(null);
  const [regionPrep, setRegionPrep] = useState<boolean>(false);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Progress of an export in flight. Shown as an overlay in every view,
  // so a long encode never looks like nothing is happening.
  const [exporting, setExporting] = useState<{
    label: string;
    done: number;
    total: number;
  } | null>(null);
  // A short message floating over the window ("Saved …"), with an
  // optional follow-up button such as "Show in folder".
  const [notice, setNotice] = useState<{
    id: number;
    message: string;
    /** "success" confirms something done; "info" explains a no-op. */
    tone: "success" | "info";
    action?: { label: string; run: () => void };
  } | null>(null);
  // When the current source was captured or opened; dates the default
  // export file names.
  const [sourceTime, setSourceTime] = useState(() => Date.now());

  const notify = useCallback(
    (
      message: string,
      action?: { label: string; run: () => void },
      tone: "success" | "info" = "success",
    ) => {
      setNotice({ id: Date.now(), message, tone, action });
    },
    [],
  );
  const notifySaved = useCallback(
    (path: string) =>
      notify(`Saved ${baseName(path)}`, {
        label: "Show in folder",
        run: () => {
          api.revealInFolder(path).catch((e) => setError(String(e)));
        },
      }),
    [notify],
  );
  // Messages clear themselves; ones with a button stay a little longer
  // so there is time to use it.
  useEffect(() => {
    if (!notice) return;
    const handle = window.setTimeout(
      () => setNotice(null),
      notice.action ? 8000 : 4000,
    );
    return () => window.clearTimeout(handle);
  }, [notice]);

  // Persisted player state — survive view navigation.
  const [playerPlaying, setPlayerPlaying] = useState(true);
  const [playerLoop, setPlayerLoop] = useState<"loop" | "boomerang" | "once">("loop");
  const [playerSpeed, setPlayerSpeed] = useState(1);
  // Countdown remaining (seconds) before recording actually starts, or
  // null when no countdown is in progress. Surfaces a full-viewport
  // overlay during the wait so the user knows what's happening.
  const [countdown, setCountdown] = useState<number | null>(null);

  const isRecordingRef = useRef(false);
  isRecordingRef.current = isRecording;
  const countdownRef = useRef<number | null>(null);
  countdownRef.current = countdown;
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  // Spotlight is switched per clip, in the Player or the Editor. The
  // Settings toggle only decides whether a new clip starts with it on,
  // so turning it on for one recording doesn't follow you into the next.
  const [spotlightOn, setSpotlightOn] = useState(false);

  // ——— startup ———
  useEffect(() => {
    api
      .platformCheck()
      .then((s) => {
        setSupported(s.supported);
        setHighQualityAvailable(s.highQualityAvailable);
      })
      .catch(() => setSupported(false));
    api.getRegion().then(setRegion).catch(() => {});
    loadPrefs()
      .then((p) => setPrefs(p))
      .catch(() => {})
      .finally(() => setPrefsLoaded(true));
    loadHistory().then(setHistory).catch(() => {});
  }, []);

  // ——— persist prefs (debounced) ———
  useEffect(() => {
    if (!prefsLoaded) return;
    const handle = window.setTimeout(() => {
      savePrefs(prefs).catch(() => {});
    }, 300);
    return () => window.clearTimeout(handle);
  }, [prefsLoaded, prefs]);

  // Apply theme selection to the document. "system" defers to the
  // user's OS preference; "light"/"dark" are explicit overrides.
  useEffect(() => {
    const root = document.documentElement;
    if (prefs.theme === "system") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", prefs.theme);
    }
  }, [prefs.theme]);

  // Auto-resize the window to fit the current view.
  //   - Home: sized to its content, in the full or the compact layout
  //     (`compactUi`), so there is no empty space under the last card.
  //   - Config: a taller, slightly wider panel than compact home so
  //     all settings fit without scrolling.
  //   - Player / Grid / Zoom: sized to the loaded animation, plus the
  //     player chrome (header, scrubber, controls). Clamped so a tiny
  //     GIF doesn't squash the toolbar (PLAYER_MIN_*) and a 4K
  //     recording doesn't overflow the monitor (90 % of the available
  //     screen).
  // Tauri's setSize anchors at the existing top-left, which is what
  // we want — the user's window position stays put as the size flexes.
  //
  // While recording, the window is instead a small always-on-top strip
  // (timer, Stop, Discard): out of the way of what is being recorded,
  // and always reachable. The backend lowers the minimum size, resizes
  // and pins the window in one step; afterwards it restores the normal
  // constraints and the sizing effect below takes over again. This
  // effect is declared first so that restore is requested before the
  // window is sized for the view it returns to.
  const stripShownRef = useRef(false);
  useEffect(() => {
    if (isRecording) {
      stripShownRef.current = true;
      api.setRecordingStrip(true, STRIP_SIZE[0], STRIP_SIZE[1]).catch(() => {});
    } else if (stripShownRef.current) {
      stripShownRef.current = false;
      api.setRecordingStrip(false).catch(() => {});
    }
  }, [isRecording]);

  const revealedRef = useRef(false);
  useEffect(() => {
    if (!prefsLoaded) return;
    // The recording strip owns the window size while a take is running.
    if (isRecording) return;

    const screenW = window.screen.availWidth;
    const screenH = window.screen.availHeight;
    const maxW = Math.max(420, Math.floor(screenW * 0.9));
    const maxH = Math.max(420, Math.floor(screenH * 0.9));

    const HOME_COMPACT: [number, number] = [300, 240];
    const HOME_FULL: [number, number] = [460, 910];
    const CONFIG_SIZE: [number, number] = [480, Math.min(720, maxH)];
    // Min keeps the player's scrubber + save buttons usable for
    // very-small animations. Chrome accounts for the header,
    // scrubber, controls row, and stage padding.
    const PLAYER_MIN: [number, number] = [460, 500];
    const PLAYER_CHROME_W = 32;
    const PLAYER_CHROME_H = 270; // +50 for the global nav bar

    let target: LogicalSize | null = null;

    if (view === "home") {
      // Home fits its content in both layouts (Recent list, region
      // panel, recording state, …). Wait for a measurement taken in the
      // layout now on screen, so toggling compact resizes once, straight
      // to the right size. The window also has to leave room for the tab
      // bar and any error banner drawn around Home. There is no fixed
      // cap: the Recent list scrolls inside its own card, so the content
      // has a bounded height, and only a short screen can limit it.
      if (homeMeasure !== null && homeMeasure.compact === prefs.compactUi) {
        const px = (sel: string) =>
          document.querySelector<HTMLElement>(sel)?.offsetHeight ?? 0;
        const around = px(".global-nav") + (error ? px(".banner") + 10 : 0);
        const natural = homeMeasure.h + around;
        const [w, h] = prefs.compactUi
          ? [HOME_COMPACT[0], Math.min(maxH, natural)]
          : [HOME_FULL[0], Math.min(maxH, Math.max(420, natural))];
        target = new LogicalSize(w, h);
      }
    } else if (view === "config") {
      target = new LogicalSize(CONFIG_SIZE[0], CONFIG_SIZE[1]);
    } else if (view === "steps") {
      // A reading-width column, as tall as the screen comfortably allows.
      target = new LogicalSize(Math.min(maxW, 620), Math.min(maxH, 860));
    } else if (
      (view === "player" || view === "grid" || view === "zoom") &&
      source
    ) {
      // Captured frames are physical pixels; convert to the window's
      // logical pixels via DPR so a 200%-scaled monitor doesn't show
      // a 2x-too-big window.
      const physW = source.info.width;
      const physH = source.info.height;
      const dpr = window.devicePixelRatio || 1;
      const logicalW = physW / dpr;
      const logicalH = physH / dpr;
      const w = Math.max(
        PLAYER_MIN[0],
        Math.min(maxW, Math.round(logicalW + PLAYER_CHROME_W)),
      );
      const h = Math.max(
        PLAYER_MIN[1],
        Math.min(maxH, Math.round(logicalH + PLAYER_CHROME_H)),
      );
      target = new LogicalSize(w, h);
    }

    if (target) {
      const win = getCurrentWindow();
      win
        .setSize(target)
        .catch(() => {})
        // Resizing keeps the top-left corner where it was, so a window
        // that grows (a big recording opening in the Player) can end up
        // hanging off the bottom or right of the screen. Slide it back.
        .then(() => keepWindowOnScreen())
        .then(() => {
          // The window starts hidden (tauri.conf.json) so nobody sees a
          // blank, wrong-sized frame while the app loads. Reveal it the
          // first time it has its real size and content. Rust shows it
          // anyway after a few seconds in case this never runs.
          if (revealedRef.current) return;
          revealedRef.current = true;
          win
            .show()
            .then(() => win.setFocus())
            .catch(() => {});
        });
    }
  }, [prefsLoaded, prefs.compactUi, view, source, homeMeasure, error, isRecording]);

  const updatePrefs = useCallback((update: Partial<Preferences>) => {
    setPrefs((p) => ({ ...p, ...update }));
  }, []);

  const updateSheet = useCallback((update: Partial<SheetDraft>) => {
    setPrefs((p) => ({ ...p, sheet: { ...p.sheet, ...update } }));
  }, []);

  const updateSimplify = useCallback((update: Partial<SimplifyDraft>) => {
    setPrefs((p) => ({ ...p, simplify: { ...p.simplify, ...update } }));
  }, []);

  const updateSpotlight = useCallback((update: Partial<SpotlightDraft>) => {
    setPrefs((p) => ({ ...p, spotlight: { ...p.spotlight, ...update } }));
  }, []);

  const updateFrameDelay = useCallback((frameIndex: number, extraMs: number) => {
    setFrameDelays((prev) => {
      if (extraMs <= 0) {
        const { [frameIndex]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [frameIndex]: extraMs };
    });
  }, []);

  // ——— recording timer ———
  // The strip shows whole seconds, so a few updates a second is plenty
  // and keeps the app nearly idle while it records.
  useEffect(() => {
    if (!isRecording || recordStart === null) return;
    const tick = () => setElapsedMs(Date.now() - recordStart);
    tick();
    const handle = window.setInterval(tick, 200);
    return () => window.clearInterval(handle);
  }, [isRecording, recordStart]);

  // ——— thumb loading after a source becomes current ———
  const loadThumbs = useCallback(async (): Promise<FrameThumb[]> => {
    try {
      const [thumbList, playerList] = await Promise.all([
        api.listFrameThumbs(),
        api.listPlayerFrames(),
      ]);
      setThumbs(thumbList);
      setPlayerFrames(playerList);
      setFrameOrder(thumbList.map((t) => t.index));
      setEdits({});
      setFrameDelays({});
      setPlayerPlaying(true);
      setPlayerLoop("loop");
      setPlayerSpeed(1);
      setTrim(null);
      setGuide(null);
      setSpotlightOn(prefsRef.current.spotlight.enabled);
      try {
        setInputEvents(await api.listInputEvents());
      } catch {
        setInputEvents([]);
      }
      return thumbList;
    } catch {
      setThumbs([]);
      setPlayerFrames([]);
      setEdits({});
      setTrim(null);
      setInputEvents([]);
      return [];
    }
  }, []);

  // ——— GIF drop / load ———
  const handleLoadGif = useCallback(
    async (path: string) => {
      setBusy("Decoding GIF…");
      setError(null);

      const ready = new Promise<GifInfo>((resolve, reject) => {
        let r: (() => void) | null = null;
        let e: (() => void) | null = null;
        const clean = () => {
          r?.();
          e?.();
        };
        listen<GifInfo>("gif-ready", (event) => {
          clean();
          resolve(event.payload);
        }).then((fn) => {
          r = fn;
        });
        listen<{ message: string }>("gif-error", (event) => {
          clean();
          reject(new Error(event.payload.message));
        }).then((fn) => {
          e = fn;
        });
      });

      try {
        await api.loadGif(path);
        const info = await ready;
        setSource({ kind: "gif", info });
        setSourceTime(Date.now());
        const thumbList = await loadThumbs();
        addHistoryEntry({
          id: Date.now(),
          gifPath: path,
          thumbPath: thumbList[0]?.path ?? "",
          createdAt: Date.now(),
          width: info.width,
          height: info.height,
          frameCount: info.frameCount,
          durationMs: info.durationMs,
          fps: info.inferredFps,
          fromRecording: false,
        }).then(setHistory).catch(() => {});
        setView("player");
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(null);
      }
    },
    [loadThumbs],
  );

  // Auto-open any GIF path the OS passed to us (double-click from
  // Explorer, drag-onto-exe, etc.). Also react to subsequent opens
  // forwarded by the single-instance plugin.
  useEffect(() => {
    const check = async () => {
      try {
        const path = await api.takePendingFile();
        if (path) handleLoadGif(path);
      } catch {}
    };
    check();
    const p = listen("open-file-requested", () => {
      check();
    });
    return () => {
      p.then((fn) => fn()).catch(() => {});
    };
  }, [handleLoadGif]);

  // ——— start recording ———
  // True while the on-screen countdown is up, so it is only torn down
  // when it was actually shown.
  const countdownShownRef = useRef(false);
  // True from the moment a take is being started until it is running (or
  // failed), so a second press of Record or the hotkey can't start
  // another one on top of it.
  const startingRef = useRef(false);

  const beginRecording = useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    setError(null);
    if (countdownShownRef.current) {
      countdownShownRef.current = false;
      // Take the countdown off the screen and give the compositor a
      // moment, so the number can't show up in the first captured frame.
      await api.hideCountdownIndicator().catch(() => {});
      await new Promise((r) => setTimeout(r, 150));
    }
    // Exclude Glattice from screen capture so it stays visible (with its
    // Stop button) but never appears inside the recording.
    const win = getCurrentWindow();
    await win.setContentProtected(true).catch(() => {});
    await new Promise((r) => setTimeout(r, 100));
    try {
      await api.startRecording(
        prefs.fps,
        prefs.cursorMode,
        prefs.recordClicks,
        prefs.recordKeys,
        prefs.recordAudio,
      );
      setIsRecording(true);
      setRecordStart(Date.now());
      setElapsedMs(0);
      // A take can be started from any tab with the hotkey. Whatever was
      // open, come back to Home afterwards, where the encoding progress
      // (or an error) is shown.
      setView("home");
      setCompactNavOpen(false);
      if (region) {
        api.showRecordingIndicator(region).catch(() => {});
      }
    } catch (e) {
      await win.setContentProtected(false).catch(() => {});
      setError(String(e));
    } finally {
      startingRef.current = false;
    }
  }, [
    prefs.fps,
    prefs.cursorMode,
    prefs.recordClicks,
    prefs.recordKeys,
    prefs.recordAudio,
    region,
  ]);

  const handleRecord = useCallback(() => {
    if (startingRef.current) return;
    setError(null);
    const seconds = Math.max(0, Math.floor(prefs.countdownSeconds || 0));
    if (seconds <= 0) {
      void beginRecording();
      return;
    }
    setCountdown(seconds);
  }, [prefs.countdownSeconds, beginRecording]);

  // Stop a countdown without recording: Esc, a click on the overlay, or
  // the record hotkey (the only one of the three that works while
  // another app has the keyboard).
  const cancelCountdown = useCallback(() => {
    setCountdown(null);
    if (countdownShownRef.current) {
      countdownShownRef.current = false;
      api.hideCountdownIndicator().catch(() => {});
    }
  }, []);

  // Drive the countdown each second; at 0 fire the actual recording
  // start. Each tick is also shown on screen, in the region about to be
  // recorded (or the middle of the screen), since that is where the
  // user is looking, not at this window.
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      setCountdown(null);
      void beginRecording();
      return;
    }
    countdownShownRef.current = true;
    api.showCountdownIndicator(countdown).catch(() => {});
    const handle = window.setTimeout(() => {
      setCountdown((c) => (c === null ? null : c - 1));
    }, 1000);
    return () => window.clearTimeout(handle);
  }, [countdown, beginRecording]);

  // "?" opens the keyboard shortcut list from any view.
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;
      setShortcutsOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ESC aborts an in-progress countdown.
  useEffect(() => {
    if (countdown === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelCountdown();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [countdown, cancelCountdown]);

  // ——— screenshot ———
  // One still frame, opened straight in the Editor to mark up. It is
  // loaded as a one-frame clip, so everything else works on it as usual.
  const handleScreenshot = useCallback(async () => {
    if (startingRef.current || isRecordingRef.current) return;
    startingRef.current = true;
    setError(null);
    const win = getCurrentWindow();
    // Keep Glattice itself out of the picture.
    await win.setContentProtected(true).catch(() => {});
    await new Promise((r) => setTimeout(r, 120));
    setBusy("Taking screenshot…");

    const ready = new Promise<RecordingInfo>((resolve, reject) => {
      let r: (() => void) | null = null;
      let e: (() => void) | null = null;
      const clean = () => {
        r?.();
        e?.();
      };
      listen<RecordingInfo>("recording-ready", (event) => {
        clean();
        resolve(event.payload);
      }).then((fn) => {
        r = fn;
      });
      listen<{ message: string }>("recording-error", (event) => {
        clean();
        reject(new Error(event.payload.message));
      }).then((fn) => {
        e = fn;
      });
    });

    try {
      await api.captureScreenshot();
      // The frame is captured by the time that call returns; Glattice can
      // show up in captures again while the picture is prepared.
      await win.setContentProtected(false).catch(() => {});
      const info = await ready;
      setSource({ kind: "recording", info });
      setSourceTime(Date.now());
      const thumbList = await loadThumbs();
      addHistoryEntry({
        id: Date.now(),
        gifPath: info.path,
        thumbPath: thumbList[0]?.path ?? "",
        createdAt: Date.now(),
        width: info.width,
        height: info.height,
        frameCount: info.frameCount,
        durationMs: info.durationMs,
        fps: info.fps,
        fromRecording: true,
      }).then(setHistory).catch(() => {});
      setZoomIndex(thumbList[0]?.index ?? 0);
      setCompactNavOpen(false);
      setView("zoom");
    } catch (e) {
      setError(String(e));
    } finally {
      await win.setContentProtected(false).catch(() => {});
      setBusy(null);
      startingRef.current = false;
    }
  }, [loadThumbs]);

  // ——— stop recording ———
  const handleStop = useCallback(async () => {
    api.hideRecordingIndicator().catch(() => {});
    // Recording is over: let Glattice appear in screen captures again.
    await getCurrentWindow().setContentProtected(false).catch(() => {});
    // High-quality (gifski) is gated by a Cargo feature. If the build
    // wasn't compiled with it, fall back to the standard encoder even
    // when the user's saved pref still has the toggle on — otherwise
    // Rust will reject the request with InvalidConfig.
    const useHighQuality = prefs.highQuality && highQualityAvailable;
    setBusy(useHighQuality ? "Encoding GIF (high quality)…" : "Encoding GIF…");

    const unlistenProgress = await listen<{ done: number; total: number }>(
      "encode-progress",
      (event) => {
        const { done, total } = event.payload;
        setBusy(`Encoding GIF… ${done}/${total}`);
      },
    );
    const unlistenThumb = await listen<{ done: number; total: number }>(
      "thumb-progress",
      (event) => {
        const { done, total } = event.payload;
        setBusy(`Generating thumbnails… ${done}/${total}`);
      },
    );

    const ready = new Promise<RecordingInfo>((resolve, reject) => {
      let r: (() => void) | null = null;
      let e: (() => void) | null = null;
      const clean = () => {
        r?.();
        e?.();
      };
      listen<RecordingInfo>("recording-ready", (event) => {
        clean();
        resolve(event.payload);
      }).then((fn) => {
        r = fn;
      });
      listen<{ message: string }>("recording-error", (event) => {
        clean();
        reject(new Error(event.payload.message));
      }).then((fn) => {
        e = fn;
      });
    });

    try {
      await api.stopRecording(useHighQuality);
      setIsRecording(false);
      setRecordStart(null);
      const info = await ready;
      setSource({ kind: "recording", info });
      setSourceTime(Date.now());
      const thumbList = await loadThumbs();
      addHistoryEntry({
        id: Date.now(),
        gifPath: info.path,
        thumbPath: thumbList[0]?.path ?? "",
        createdAt: Date.now(),
        width: info.width,
        height: info.height,
        frameCount: info.frameCount,
        durationMs: info.durationMs,
        fps: info.fps,
        fromRecording: true,
      }).then(setHistory).catch(() => {});
      setView("player");
    } catch (e) {
      setError(String(e));
      setIsRecording(false);
      setRecordStart(null);
    } finally {
      unlistenProgress();
      unlistenThumb();
      setBusy(null);
    }
  }, [prefs.highQuality, highQualityAvailable, loadThumbs]);

  // ——— discard recording ———
  // Stop capturing and throw the take away: nothing is encoded and
  // nothing is added to Recent.
  const handleDiscard = useCallback(async () => {
    api.hideRecordingIndicator().catch(() => {});
    await getCurrentWindow().setContentProtected(false).catch(() => {});
    try {
      await api.discardRecording();
      notify("Recording discarded");
    } catch (e) {
      setError(String(e));
    } finally {
      setIsRecording(false);
      setRecordStart(null);
    }
  }, [notify]);

  // Ctrl+Shift+R toggles recording. During the countdown it backs out
  // instead, so there is a way to cancel from whatever app has focus.
  useEffect(() => {
    const unlistenPromise = listen("toggle-recording", () => {
      if (countdownRef.current !== null) cancelCountdown();
      else if (isRecordingRef.current) handleStop();
      // The hotkey does whatever Home's capture button is set to.
      else if (captureModeRef.current === "screenshot") handleScreenshot();
      else handleRecord();
    });
    return () => {
      unlistenPromise.then((fn) => fn()).catch(() => {});
    };
  }, [handleRecord, handleStop, cancelCountdown]);

  // ——— region overlay ———
  const handleSelectRegion = useCallback(async () => {
    // Hide the indicator BEFORE flipping the prep overlay so the old
    // region border doesn't flash on screen during the transition.
    // This IPC call is fast (~5 ms) — imperceptible to the user.
    await api.hideRecordingIndicator().catch(() => {});
    // Now flip the prep overlay so the webview has a solid panel
    // during the resize-to-fullscreen transition.
    setRegionPrep(true);
    try {
      // Show the prep spinner — the pre-capture on hover has
      // (almost certainly) already saved the backdrop.
      api.showPrepIndicator().catch(() => {});

      const ready = new Promise<PrevWindow>((resolve, reject) => {
        let r: (() => void) | null = null;
        let e: (() => void) | null = null;
        const clean = () => {
          r?.();
          e?.();
        };
        listen<PrevWindow>("overlay-ready", (event) => {
          clean();
          resolve(event.payload);
        }).then((fn) => {
          r = fn;
        });
        listen<{ message: string }>("overlay-error", (event) => {
          clean();
          reject(new Error(event.payload.message));
        }).then((fn) => {
          e = fn;
        });
      });

      await api.enterRegionOverlay();
      const prev = await ready;
      setOverlayPrev(prev);
    } catch (e) {
      setError(String(e));
    } finally {
      setRegionPrep(false);
    }
  }, []);

  const exitOverlay = useCallback(
    async (picked: RegionInput | null) => {
      const prev = overlayPrev;
      if (!prev) return;
      try {
        await api.leaveRegionOverlay(prev);
        if (picked) {
          await api.setRegion(picked);
          setRegion(picked);
          // The recording indicator dims everything outside the region and
          // stays topmost, so it is shown only once recording starts.
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setOverlayPrev(null);
      }
    },
    [overlayPrev],
  );

  // ——— ordered thumb views ———
  // Apply frameOrder permutation so every consumer sees frames in the
  // user's chosen order. Original indices are preserved on each thumb
  // so edits, excluded, and input-event lookups remain correct.
  const orderedThumbs = useMemo(() => {
    const byIdx = new Map(thumbs.map((t) => [t.index, t]));
    return frameOrder.map((i) => byIdx.get(i)).filter((t): t is FrameThumb => t != null);
  }, [thumbs, frameOrder]);

  const orderedPlayerFrames = useMemo(() => {
    const byIdx = new Map(playerFrames.map((t) => [t.index, t]));
    return frameOrder.map((i) => byIdx.get(i)).filter((t): t is FrameThumb => t != null);
  }, [playerFrames, frameOrder]);

  // The Editor works on the clip as trimmed: frames cut off by the trim
  // are not part of it, so they can't be stepped to or edited there.
  const editorThumbs = useMemo(
    () =>
      applyTrim(
        orderedPlayerFrames.length > 0 ? orderedPlayerFrames : orderedThumbs,
        trim,
      ),
    [orderedPlayerFrames, orderedThumbs, trim],
  );
  // The frame the Editor shows. If the remembered one has since been
  // trimmed off, fall to the nearest kept end.
  const editorIndex = useMemo(() => {
    if (zoomIndex === null || editorThumbs.length === 0) return null;
    if (editorThumbs.some((t) => t.index === zoomIndex)) return zoomIndex;
    const at = frameOrder.indexOf(zoomIndex);
    const beforeStart = trim !== null && at >= 0 && at < trim.inPos;
    return (beforeStart ? editorThumbs[0] : editorThumbs[editorThumbs.length - 1]).index;
  }, [zoomIndex, editorThumbs, frameOrder, trim]);

  // Spotlight follows the recorded cursor, so it only exists for clips
  // that have one (recorded with Cursor set to Show or Overlay).
  const clipHasCursor = useMemo(
    () =>
      thumbs.some((t) => t.cursor !== null) ||
      playerFrames.some((t) => t.cursor !== null),
    [thumbs, playerFrames],
  );

  // The spotlight as every view and export applies it: the remembered
  // look (radius, darkness) from Settings, switched by this clip's own
  // toggle, and never on for a clip without a cursor.
  const spotlight = useMemo<SpotlightDraft>(
    () => ({ ...prefs.spotlight, enabled: spotlightOn && clipHasCursor }),
    [prefs.spotlight, spotlightOn, clipHasCursor],
  );

  // From the Player's and Editor's Spotlight controls. On/off belongs to
  // the clip; radius and darkness are remembered as the effect's look.
  // Frames → right-click → Copy image. The frame goes to the clipboard
  // as the Player shows it, edits and overlays included.
  const handleCopyFrame = useCallback(
    (index: number) => {
      const all = orderedPlayerFrames.length > 0 ? orderedPlayerFrames : orderedThumbs;
      const thumb = all.find((t) => t.index === index);
      if (!thumb) return;
      copyFrameToClipboard(thumb, { edits, inputEvents, spotlight })
        .then(() => notify("Frame copied to the clipboard"))
        .catch((e) => setError(String(e)));
    },
    [orderedPlayerFrames, orderedThumbs, edits, inputEvents, spotlight, notify],
  );

  const handleSpotlightChange = useCallback(
    (update: Partial<SpotlightDraft>) => {
      const { enabled, ...look } = update;
      if (Object.keys(look).length > 0) updateSpotlight(look);
      if (enabled === undefined) return;
      if (enabled && !clipHasCursor) {
        // Say why nothing happens, and where to change it, instead of a
        // switch that silently does nothing.
        notify(
          "This clip has no cursor to spotlight. Turn on Cursor in Settings before recording.",
          { label: "Open Settings", run: () => setView("config") },
          "info",
        );
        return;
      }
      setSpotlightOn(enabled);
    },
    [clipHasCursor, notify, updateSpotlight],
  );

  // Frame rate the clip plays at, for exports.
  const clipFps =
    source?.kind === "recording"
      ? source.info.fps
      : source?.kind === "gif"
        ? source.info.inferredFps
        : prefs.fps;

  // True once the clip on screen differs from the captured file: any
  // edit, trim, hold, reorder, deleted or inserted frame, or an overlay
  // that is drawn at render time (clicks, keys, an un-baked cursor, the
  // spotlight). Exports then have to render frames instead of copying
  // the capture, and the capture file must not be handed out as-is.
  const clipModified = useMemo(() => {
    if (!source) return false;
    if (trim !== null) return true;
    if (Object.values(edits).some((list) => list.length > 0)) return true;
    if (Object.keys(frameDelays).length > 0) return true;
    if (inputEvents.length > 0) return true;
    if (
      thumbs.length !== source.info.frameCount ||
      frameOrder.length !== thumbs.length ||
      frameOrder.some((idx, i) => idx !== thumbs[i].index)
    ) {
      return true;
    }
    const cursorBaked =
      source.kind === "recording" && source.info.cursorBaked === true;
    return clipHasCursor && (!cursorBaked || spotlight.enabled);
  }, [
    source,
    trim,
    edits,
    frameDelays,
    inputEvents,
    thumbs,
    frameOrder,
    clipHasCursor,
    spotlight.enabled,
  ]);

  // Default file name (without extension) for anything exported from
  // this clip: the opened file's own name, or a dated "recording-…" for
  // takes, including ones reopened from Recent under their internal
  // name (recording-12.gif).
  const exportStem = useMemo(() => {
    if (source?.kind === "gif") {
      const stem = baseName(source.info.path).replace(/\.[^.]+$/, "");
      if (stem && !/^recording-\d+$/.test(stem)) return stem;
    }
    return `recording-${fileStamp(sourceTime)}`;
  }, [source, sourceTime]);

  const defaultExportPath = useCallback(
    (fileName: string) =>
      prefs.defaultSaveDir
        ? `${prefs.defaultSaveDir.replace(/[/\\]+$/, "")}/${fileName}`
        : fileName,
    [prefs.defaultSaveDir],
  );

  const handleSaveVideo = useCallback(
    async (format: VideoFormat) => {
      if (thumbs.length === 0) return;
      const playerThumbs =
        orderedPlayerFrames.length > 0 ? orderedPlayerFrames : orderedThumbs;
      const ext = format;
      const target = await saveDialog({
        defaultPath: defaultExportPath(`${exportStem}.${ext}`),
        filters: [
          { name: format === "mp4" ? "MP4 video" : "WebM video", extensions: [ext] },
        ],
      });
      if (!target) return;
      const label = `Exporting ${format === "mp4" ? "MP4" : "WebM"}`;
      setExporting({ label, done: 0, total: playerThumbs.length });
      setError(null);
      try {
        const bytes = await encodeVideo({
          thumbs: playerThumbs,
          trim,
          edits,
          inputEvents,
          fps: Math.max(1, Math.round(clipFps)),
          format,
          audioPath:
            source?.kind === "recording" ? source.info.audioPath : null,
          spotlight,
          frameDelays,
          onProgress: (done, total) => setExporting({ label, done, total }),
        });
        await writeFile(target, bytes);
        notifySaved(target);
      } catch (e) {
        setError(String(e));
      } finally {
        setExporting(null);
      }
    },
    [
      thumbs.length,
      orderedThumbs,
      orderedPlayerFrames,
      trim,
      edits,
      inputEvents,
      frameDelays,
      source,
      clipFps,
      spotlight,
      exportStem,
      defaultExportPath,
      notifySaved,
    ],
  );

  const handleSaveGif = useCallback(async () => {
    if (!source || thumbs.length === 0) return;
    // An edited copy of someone's own GIF shouldn't default to the
    // original's name.
    const editedImport =
      clipModified && source.kind === "gif" && !exportStem.startsWith("recording-");
    const target = await saveDialog({
      defaultPath: defaultExportPath(
        `${exportStem}${editedImport ? "-edited" : ""}.gif`,
      ),
      filters: [{ name: "GIF", extensions: ["gif"] }],
    });
    if (!target) return;
    setError(null);
    try {
      if (!clipModified) {
        // Nothing was changed, so the captured file already is the clip.
        // (Saving an opened GIF over itself is then a no-op.)
        if (!samePath(source.info.path, target)) {
          await copyFile(source.info.path, target);
        }
      } else {
        // Render what the Player shows: edits, trim, order, holds and
        // overlays all end up in the file.
        const frames =
          orderedPlayerFrames.length > 0 ? orderedPlayerFrames : orderedThumbs;
        const label = "Exporting GIF";
        setExporting({ label, done: 0, total: frames.length });
        const bytes = await encodeGif({
          thumbs: frames,
          trim,
          edits,
          inputEvents,
          fps: Math.max(1, clipFps),
          frameDelays,
          spotlight,
          onProgress: (done, total) => setExporting({ label, done, total }),
        });
        await writeFile(target, bytes);
      }
      notifySaved(target);
    } catch (e) {
      setError(String(e));
    } finally {
      setExporting(null);
    }
  }, [
    source,
    thumbs.length,
    clipModified,
    exportStem,
    defaultExportPath,
    orderedThumbs,
    orderedPlayerFrames,
    trim,
    edits,
    inputEvents,
    clipFps,
    frameDelays,
    spotlight,
    notifySaved,
  ]);


  const deletedIndices = useMemo(() => {
    const inOrder = new Set(frameOrder);
    return thumbs.filter((t) => !inOrder.has(t.index)).map((t) => t.index);
  }, [thumbs, frameOrder]);

  const handleRestore = useCallback((index: number) => {
    changeFrameOrder((o) => [...o, index]);
    setEdits((e) => { const next = { ...e }; delete next[index]; return next; });
  }, [changeFrameOrder]);

  const handleInsertBlankFrame = useCallback(async () => {
    try {
      const result = await api.insertBlankFrame();
      setThumbs((prev) => [...prev, result.thumb]);
      setPlayerFrames((prev) => [...prev, result.playerFrame]);
      changeFrameOrder((prev) => [...prev, result.thumb.index]);
    } catch (e) {
      setError(String(e));
    }
  }, [changeFrameOrder]);

  const handleClearRegion = useCallback(async () => {
    try {
      await api.clearRegion();
      setRegion(null);
      await api.hideRecordingIndicator().catch(() => {});
    } catch (e) {
      setError(String(e));
    }
  }, []);


  // ——— compact nav ———
  // In compact mode the ⋮ trigger lives inside each view's existing
  // chrome toolbar so it never overlaps other buttons.
  const showCompactNav =
    prefs.compactUi &&
    !overlayPrev &&
    !regionPrep &&
    // On Home it only appears once there is something to go back to.
    (view !== "home" || !!source) &&
    view !== "config";

  const compactNavButton = showCompactNav ? (
    <button
      type="button"
      className={`icon-btn compact-nav-btn ${compactNavOpen ? "icon-btn--active" : ""}`}
      onClick={() => setCompactNavOpen((o) => !o)}
      title="Navigate"
      aria-haspopup="true"
      aria-expanded={compactNavOpen}
    >
      <IconMore />
    </button>
  ) : null;

  // ——— render ———
  if (overlayPrev) {
    return (
      <RegionOverlay onDone={exitOverlay} detection={prefs.regionDetection} />
    );
  }

  if (regionPrep) {
    // Full-viewport solid pane so the webview never exposes a blank
    // repaint during the window's resize-to-fullscreen transition.
    return (
      <div className="prep-overlay">
        <div className="home__busy-spinner" />
        <div className="prep-overlay__text">Preparing region selection…</div>
      </div>
    );
  }

  if (isRecording) {
    // The whole window is the recording strip until the take ends.
    return (
      <div className="app app--strip">
        <RecordingStrip
          elapsedMs={elapsedMs}
          fps={prefs.fps}
          region={region}
          onStop={handleStop}
          onDiscard={handleDiscard}
        />
      </div>
    );
  }

  const sourceLabel =
    source?.kind === "recording"
      ? `Recording · ${source.info.width}×${source.info.height} · ${source.info.fps} fps`
      : source?.kind === "gif"
        ? `GIF · ${source.info.width}×${source.info.height}`
        : "";

  return (
    <div className="app">
      {error && (
        <ErrorBanner error={error} onDismiss={() => setError(null)} />
      )}

      {exporting && (
        <div className="export-overlay" role="status" aria-live="polite">
          <div className="export-overlay__card">
            <div className="export-overlay__label">{exporting.label}…</div>
            <div
              className="export-overlay__bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={exporting.total}
              aria-valuenow={exporting.done}
            >
              <div
                className="export-overlay__fill"
                style={{
                  width: `${exporting.total > 0 ? (exporting.done / exporting.total) * 100 : 0}%`,
                }}
              />
            </div>
            <div className="export-overlay__count muted">
              Frame {exporting.done} of {exporting.total}
            </div>
          </div>
        </div>
      )}

      {shortcutsOpen && <ShortcutsModal onClose={() => setShortcutsOpen(false)} />}
      {notice && (
        <Toast
          key={notice.id}
          message={notice.message}
          tone={notice.tone}
          actionLabel={notice.action?.label}
          onAction={
            notice.action
              ? () => {
                  notice.action?.run();
                  setNotice(null);
                }
              : undefined
          }
          onDismiss={() => setNotice(null)}
        />
      )}

      {countdown !== null && (
        <div
          className="countdown-overlay"
          onClick={cancelCountdown}
          role="status"
          aria-label={`Recording starts in ${countdown}`}
        >
          <div className="countdown-overlay__number">{countdown || "GO"}</div>
          <div className="countdown-overlay__hint">
            Esc, click, or Ctrl+Shift+R to cancel
          </div>
        </div>
      )}

      {view === "home" && (
        <Home
          region={region}
          supported={supported}
          busy={busy}
          compact={prefs.compactUi}
          history={history}
          onOpenHistory={handleLoadGif}
          onRemoveHistory={(id) =>
            removeHistoryEntry(id).then(setHistory).catch(() => {})
          }
          onRecord={handleRecord}
          onScreenshot={handleScreenshot}
          captureMode={captureMode}
          onCaptureModeChange={setCaptureMode}
          onSelectRegion={handleSelectRegion}
          onClearRegion={handleClearRegion}
          onConfig={() => setView("config")}
          onCompactChange={(c: boolean) => updatePrefs({ compactUi: c })}
          onContentHeight={handleHomeHeight}
          compactNavButton={compactNavButton}
          onDropGif={handleLoadGif}
        />
      )}

      {view === "config" && (
        <Config
          prefs={prefs}
          highQualityAvailable={highQualityAvailable}
          onChange={updatePrefs}
          onBack={() => setView("home")}
          onShowShortcuts={() => setShortcutsOpen(true)}
        />
      )}

      {view === "player" && (
        <Player
          thumbs={orderedPlayerFrames.length > 0 ? orderedPlayerFrames : orderedThumbs}
          edits={edits}
          inputEvents={inputEvents}
          trim={trim}
          onTrimChange={setTrim}
          // Dragging hands out the captured file as-is, so it is only
          // offered while that file still matches what is on screen.
          dragSourcePath={clipModified ? null : (source?.info.path ?? null)}
          fps={clipFps}
          sourceLabel={sourceLabel}
          onSaveGif={handleSaveGif}
          onSaveVideo={handleSaveVideo}
          onExportSheet={() => setShowPreviewModal(true)}
          spotlight={spotlight}
          onSpotlightChange={handleSpotlightChange}
          spotlightAvailable={clipHasCursor}
          frameDelays={frameDelays}
          playing={playerPlaying}
          onPlayingChange={setPlayerPlaying}
          loop={playerLoop}
          onLoopChange={setPlayerLoop}
          speed={playerSpeed}
          onSpeedChange={setPlayerSpeed}
          compactNavButton={compactNavButton}
        />
      )}

      {view === "grid" && (
        <Grid
          thumbs={orderedPlayerFrames.length > 0 ? orderedPlayerFrames : orderedThumbs}
          edits={edits}
          inputEvents={inputEvents}
          spotlight={spotlight}
          sheet={prefs.sheet}
          onSheetChange={updateSheet}
          trim={trim}
          deletedIndices={deletedIndices}
          onRestore={handleRestore}
          onZoom={(i) => {
            if (!editorThumbs.some((t) => t.index === i)) {
              notify(
                "This frame is trimmed off, so it can't be edited. Widen or clear the trim in the Player to bring it back.",
                { label: "Open Player", run: () => setView("player") },
                "info",
              );
              return;
            }
            setZoomIndex(i);
            setView("zoom");
          }}
          onReorder={changeFrameOrder}
          onCopy={handleCopyFrame}
          onDelete={(indices) => {
            const toRemove = new Set(indices);
            changeFrameOrder((o) => o.filter((i) => !toRemove.has(i)));
          }}
          frameDelays={frameDelays}
          onDelayChange={updateFrameDelay}
          onInsertBlank={handleInsertBlankFrame}
          onPreview={() => setShowPreviewModal(true)}
          compactNavButton={compactNavButton}
        />
      )}

      {view === "zoom" && editorIndex !== null && (
        <Zoom
          thumbs={editorThumbs}
          index={editorIndex}
          edits={edits}
          inputEvents={inputEvents}
          simplify={prefs.simplify}
          spotlight={spotlight}
          onSpotlightChange={handleSpotlightChange}
          spotlightAvailable={clipHasCursor}
          onBack={() => setView("grid")}
          onNavigate={setZoomIndex}
          onDelete={(idx) => changeFrameOrder((o) => o.filter((i) => i !== idx))}
          onCopyFrame={handleCopyFrame}
          onEditsChange={setEdits}
          onSimplifyChange={updateSimplify}
          exportPath={defaultExportPath(`${exportStem}-frame`)}
          onSaved={notifySaved}
          onError={setError}
          compactNavButton={compactNavButton}
        />
      )}

      {view === "steps" && source && (
        <Steps
          thumbs={editorThumbs}
          edits={edits}
          inputEvents={inputEvents}
          guide={guide}
          onGuideChange={setGuide}
          defaultTitle={exportStem}
          saveFolder={defaultExportPath("")}
          onSaved={notifySaved}
          onCopied={() => notify("Guide copied to the clipboard")}
          onError={setError}
          onOpenEditor={(i) => {
            setZoomIndex(i);
            setView("zoom");
          }}
          onOpenSettings={() => setView("config")}
          compactNavButton={compactNavButton}
        />
      )}

      {showPreviewModal && (
        <SheetPreviewModal
          sheet={prefs.sheet}
          frameOrder={frameOrder}
          edits={edits}
          trim={trim}
          spotlight={spotlight}
          defaultPath={defaultExportPath(`${exportStem}-sheet.png`)}
          onSaved={notifySaved}
          onClose={() => setShowPreviewModal(false)}
        />
      )}

      {/* Global nav — hidden in compact home (too tight) and during
          region overlay / recording overlay (they go fullscreen). */}

      {/* Compact nav popover — the trigger button lives inside each
          view's chrome; the scrim + menu overlay is rendered here. */}
      {showCompactNav && compactNavOpen && (
        <CompactNav
          view={view}
          hasSource={!!source}
          onClose={() => setCompactNavOpen(false)}
          onHome={() => { setView("home"); setCompactNavOpen(false); }}
          onPlayer={() => { if (source) setView("player"); setCompactNavOpen(false); }}
          onFrames={() => { if (source) setView("grid"); setCompactNavOpen(false); }}
          onEditor={() => {
            if (!source) return;
            if (zoomIndex === null && orderedThumbs.length > 0)
              setZoomIndex(orderedThumbs[0].index);
            setView("zoom");
            setCompactNavOpen(false);
          }}
          onSteps={() => { if (source) setView("steps"); setCompactNavOpen(false); }}
        />
      )}

      {!prefs.compactUi && !overlayPrev && !regionPrep && (
        <nav className="global-nav">
          <button
            type="button"
            className={`global-nav__item ${view === "home" || view === "config" ? "global-nav__item--active" : ""}`}
            onClick={() => setView("home")}
            title="Home"
          >
            <IconHome size={20} />
            <span>Home</span>
          </button>
          <button
            type="button"
            className={`global-nav__item ${view === "player" ? "global-nav__item--active" : ""}`}
            onClick={() => source && setView("player")}
            disabled={!source}
            title={source ? "Player" : "Record or open a GIF to unlock"}
          >
            <IconPlay size={20} />
            <span>Player</span>
          </button>
          <button
            type="button"
            className={`global-nav__item ${view === "grid" ? "global-nav__item--active" : ""}`}
            onClick={() => source && setView("grid")}
            disabled={!source}
            title={source ? "Frames" : "Record or open a GIF to unlock"}
          >
            <IconGrid size={20} />
            <span>Frames</span>
          </button>
          <button
            type="button"
            className={`global-nav__item ${view === "zoom" ? "global-nav__item--active" : ""}`}
            onClick={() => {
              if (!source) return;
              if (zoomIndex === null && orderedThumbs.length > 0) {
                setZoomIndex(orderedThumbs[0].index);
              }
              setView("zoom");
            }}
            disabled={!source}
            title={source ? "Frame editor" : "Record or open a GIF to unlock"}
          >
            <IconImage size={20} />
            <span>Editor</span>
          </button>
          <button
            type="button"
            className={`global-nav__item ${view === "steps" ? "global-nav__item--active" : ""}`}
            onClick={() => source && setView("steps")}
            disabled={!source}
            title={source ? "Step-by-step guide" : "Record or open a GIF to unlock"}
          >
            <IconSteps size={20} />
            <span>Steps</span>
          </button>
        </nav>
      )}

    </div>
  );
}

// ——— Compact nav overlay ——————————————————————————————————————————
// The trigger button lives inside each view's chrome (passed as
// compactNavButton prop). This component renders only the scrim +
// menu overlay, shown when compactNavOpen is true.

interface CompactNavProps {
  view: string;
  hasSource: boolean;
  onClose: () => void;
  onHome: () => void;
  onPlayer: () => void;
  onFrames: () => void;
  onEditor: () => void;
  onSteps: () => void;
}

function CompactNav({
  view,
  hasSource,
  onClose,
  onHome,
  onPlayer,
  onFrames,
  onEditor,
  onSteps,
}: CompactNavProps) {
  const items = [
    { label: "Home",   icon: <IconHome size={16} />,  active: view === "home" || view === "config", disabled: false,      action: onHome },
    { label: "Player", icon: <IconPlay size={16} />,  active: view === "player",                    disabled: !hasSource, action: onPlayer },
    { label: "Frames", icon: <IconGrid size={16} />,  active: view === "grid",                      disabled: !hasSource, action: onFrames },
    { label: "Editor", icon: <IconImage size={16} />, active: view === "zoom",                      disabled: !hasSource, action: onEditor },
    { label: "Steps",  icon: <IconSteps size={16} />, active: view === "steps",                     disabled: !hasSource, action: onSteps },
  ];

  return (
    <>
      <div className="compact-nav__scrim" onClick={onClose} />
      <div className="compact-nav__menu" role="menu">
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            className={`compact-nav__item ${item.active ? "compact-nav__item--active" : ""}`}
            disabled={item.disabled}
            onClick={item.action}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </>
  );
}
