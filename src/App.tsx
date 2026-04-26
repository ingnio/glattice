import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { copyFile, writeFile } from "@tauri-apps/plugin-fs";
import RegionOverlay from "./RegionOverlay";
import Home from "./Home";
import Config from "./Config";
import Player from "./Player";
import Grid from "./Grid";
import Zoom from "./Zoom";
import SheetPreviewModal from "./SheetPreviewModal";
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
  Theme,
} from "./lib/prefs";
import "./App.css";
import { IconGrid, IconHome, IconImage, IconMore, IconPlay } from "./icons";

type Source =
  | { kind: "recording"; info: RecordingInfo }
  | { kind: "gif"; info: GifInfo };

type View = "home" | "config" | "player" | "grid" | "zoom";

export default function App() {
  const [view, setView] = useState<View>("home");
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
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [thumbs, setThumbs] = useState<FrameThumb[]>([]);
  const [playerFrames, setPlayerFrames] = useState<FrameThumb[]>([]);
  // User-controlled display order: an array of original frame indices.
  // Initialised to [0, 1, 2, …] on load; drag-to-reorder updates it.
  const [frameOrder, setFrameOrder] = useState<number[]>([]);
  const [edits, setEdits] = useState<FrameEdits>({});
  const [inputEvents, setInputEvents] = useState<InputEvent[]>([]);
  // Player in/out trim (inclusive original frame indices). null = no
  // trim active (full range). Frames outside the trim are skipped at
  // playback and excluded from sprite-sheet export.
  const [trim, setTrim] = useState<{ inIdx: number; outIdx: number } | null>(
    null,
  );

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [region, setRegion] = useState<RegionInput | null>(null);
  const [overlayPrev, setOverlayPrev] = useState<PrevWindow | null>(null);
  const [regionPrep, setRegionPrep] = useState<boolean>(false);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Countdown remaining (seconds) before recording actually starts, or
  // null when no countdown is in progress. Surfaces a full-viewport
  // overlay during the wait so the user knows what's happening.
  const [countdown, setCountdown] = useState<number | null>(null);

  const isRecordingRef = useRef(false);
  isRecordingRef.current = isRecording;

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
  //   - Home: respects `compactUi` — the only view where the toggle
  //     applies. Compact drops the hero entirely.
  //   - Config: a taller, slightly wider panel than compact home so
  //     all settings fit without scrolling.
  //   - Player / Grid / Zoom: sized to the loaded animation, plus the
  //     player chrome (header, scrubber, controls). Clamped so a tiny
  //     GIF doesn't squash the toolbar (PLAYER_MIN_*) and a 4K
  //     recording doesn't overflow the monitor (90 % of the available
  //     screen).
  // Tauri's setSize anchors at the existing top-left, which is what
  // we want — the user's window position stays put as the size flexes.
  useEffect(() => {
    if (!prefsLoaded) return;

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
      const [w, h] = prefs.compactUi ? HOME_COMPACT : HOME_FULL;
      target = new LogicalSize(w, h);
    } else if (view === "config") {
      target = new LogicalSize(CONFIG_SIZE[0], CONFIG_SIZE[1]);
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
      getCurrentWindow()
        .setSize(target)
        .catch(() => {});
    }
  }, [prefsLoaded, prefs.compactUi, view, source]);

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

  // ——— recording timer ———
  useEffect(() => {
    let raf = 0;
    if (isRecording && recordStart !== null) {
      const tick = () => {
        setElapsedMs(Date.now() - recordStart);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
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
      setTrim(null);
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
  const beginRecording = useCallback(async () => {
    setError(null);
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
      if (region) {
        api.showRecordingIndicator(region).catch(() => {});
      }
    } catch (e) {
      setError(String(e));
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
    setError(null);
    const seconds = Math.max(0, Math.floor(prefs.countdownSeconds || 0));
    if (seconds <= 0) {
      void beginRecording();
      return;
    }
    setCountdown(seconds);
  }, [prefs.countdownSeconds, beginRecording]);

  // Drive the countdown each second; at 0 fire the actual recording
  // start. ESC during the wait cancels (handled below).
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      setCountdown(null);
      void beginRecording();
      return;
    }
    const handle = window.setTimeout(() => {
      setCountdown((c) => (c === null ? null : c - 1));
    }, 1000);
    return () => window.clearTimeout(handle);
  }, [countdown, beginRecording]);

  // ESC aborts an in-progress countdown.
  useEffect(() => {
    if (countdown === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setCountdown(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [countdown]);

  // ——— stop recording ———
  const handleStop = useCallback(async () => {
    api.hideRecordingIndicator().catch(() => {});
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

  // Ctrl+Shift+R toggles recording
  useEffect(() => {
    const unlistenPromise = listen("toggle-recording", () => {
      if (isRecordingRef.current) handleStop();
      else handleRecord();
    });
    return () => {
      unlistenPromise.then((fn) => fn()).catch(() => {});
    };
  }, [handleRecord, handleStop]);

  // ——— region overlay ———
  const handleSelectRegion = useCallback(async () => {
    // Flip into the "preparing" overlay immediately so the webview
    // always has a full-viewport solid panel to display while the
    // main window resizes to fullscreen. Without this the webview
    // flashes black during the resize transition before the region
    // overlay UI is ready.
    setRegionPrep(true);
    try {
      await api.hideRecordingIndicator().catch(() => {});
      // Show the prep spinner immediately — the pre-capture on hover
      // has (almost certainly) already saved the backdrop, so the
      // spinner won't be in the screenshot.
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
          api.showRecordingIndicator(picked).catch(() => {});
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

  const handleSaveVideo = useCallback(
    async (format: VideoFormat) => {
      if (thumbs.length === 0) return;
      const playerThumbs =
        orderedPlayerFrames.length > 0 ? orderedPlayerFrames : orderedThumbs;
      const fps =
        source?.kind === "recording"
          ? source.info.fps
          : source?.kind === "gif"
            ? source.info.inferredFps
            : prefs.fps;
      const ext = format;
      const target = await saveDialog({
        defaultPath: prefs.defaultSaveDir
          ? `${prefs.defaultSaveDir.replace(/[/\\]+$/, "")}/recording.${ext}`
          : `recording.${ext}`,
        filters: [
          { name: format === "mp4" ? "MP4 video" : "WebM video", extensions: [ext] },
        ],
      });
      if (!target) return;
      setBusy(`Encoding ${format.toUpperCase()}…`);
      setError(null);
      try {
        const bytes = await encodeVideo({
          thumbs: playerThumbs,
          trim,
          edits,
          inputEvents,
          fps: Math.max(1, Math.round(fps)),
          format,
          audioPath:
            source?.kind === "recording" ? source.info.audioPath : null,
          spotlight: prefs.spotlight,
          onProgress: (done, total) =>
            setBusy(`Encoding ${format.toUpperCase()}… ${done}/${total}`),
        });
        await writeFile(target, bytes);
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(null);
      }
    },
    [
      orderedThumbs,
      orderedPlayerFrames,
      trim,
      edits,
      inputEvents,
      source,
      prefs.fps,
      prefs.defaultSaveDir,
    ],
  );

  const handleSaveGif = useCallback(async () => {
    if (!source) return;
    const ext = "gif";
    const target = await saveDialog({
      defaultPath: prefs.defaultSaveDir
        ? `${prefs.defaultSaveDir.replace(/[/\\]+$/, "")}/recording.${ext}`
        : `recording.${ext}`,
      filters: [{ name: "GIF", extensions: [ext] }],
    });
    if (!target) return;
    try {
      await copyFile(source.info.path, target);
    } catch (e) {
      setError(String(e));
    }
  }, [source, prefs.defaultSaveDir]);


  const deletedIndices = useMemo(() => {
    const inOrder = new Set(frameOrder);
    return thumbs.filter((t) => !inOrder.has(t.index)).map((t) => t.index);
  }, [thumbs, frameOrder]);

  const handleRestore = useCallback((index: number) => {
    setFrameOrder((o) => [...o, index]);
    setEdits((e) => { const next = { ...e }; delete next[index]; return next; });
  }, []);

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
    view !== "home" &&
    view !== "config";

  const compactNavButton = showCompactNav ? (
    <button
      type="button"
      className={`icon-btn ${compactNavOpen ? "icon-btn--active" : ""}`}
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

  const sourceLabel =
    source?.kind === "recording"
      ? `Recording · ${source.info.width}×${source.info.height} · ${source.info.fps} fps`
      : source?.kind === "gif"
        ? `GIF · ${source.info.width}×${source.info.height}`
        : "";

  return (
    <div className="app">
      {error && (
        <div className="banner banner--error" onClick={() => setError(null)}>
          {error}
          <span className="banner__dismiss">dismiss</span>
        </div>
      )}

      {countdown !== null && (
        <div
          className="countdown-overlay"
          onClick={() => setCountdown(null)}
          role="status"
          aria-label={`Recording starts in ${countdown}`}
        >
          <div className="countdown-overlay__number">{countdown || "GO"}</div>
          <div className="countdown-overlay__hint">
            ESC or click to cancel
          </div>
        </div>
      )}

      {view === "home" && (
        <Home
          isRecording={isRecording}
          elapsedMs={elapsedMs}
          fps={prefs.fps}
          region={region}
          supported={supported}
          busy={busy}
          theme={prefs.theme}
          compact={prefs.compactUi}
          history={history}
          onOpenHistory={handleLoadGif}
          onRemoveHistory={(id) =>
            removeHistoryEntry(id).then(setHistory).catch(() => {})
          }
          onRecord={handleRecord}
          onStop={handleStop}
          onSelectRegion={handleSelectRegion}
          onSelectRegionHover={() => api.precaptureOverlayBg().catch(() => {})}
          onClearRegion={handleClearRegion}
          onConfig={() => setView("config")}
          onThemeChange={(t: Theme) => updatePrefs({ theme: t })}
          onDropGif={handleLoadGif}
        />
      )}

      {view === "config" && (
        <Config
          prefs={prefs}
          highQualityAvailable={highQualityAvailable}
          onChange={updatePrefs}
          onBack={() => setView("home")}
        />
      )}

      {view === "player" && (
        <Player
          thumbs={orderedPlayerFrames.length > 0 ? orderedPlayerFrames : orderedThumbs}
          edits={edits}
          inputEvents={inputEvents}
          trim={trim}
          onTrimChange={setTrim}
          dragSourcePath={source?.info.path ?? null}
          fps={
            source?.kind === "recording"
              ? source.info.fps
              : source?.kind === "gif"
                ? source.info.inferredFps
                : prefs.fps
          }
          sourceLabel={sourceLabel}
          onBack={() => setView("home")}
          onSaveGif={handleSaveGif}
          onSaveVideo={handleSaveVideo}
          spotlight={prefs.spotlight}
          compactNavButton={compactNavButton}
        />
      )}

      {view === "grid" && (
        <Grid
          thumbs={orderedThumbs}
          edits={edits}
          inputEvents={inputEvents}
          spotlight={prefs.spotlight}
          sheet={prefs.sheet}
          onSheetChange={updateSheet}
          trim={trim}
          deletedIndices={deletedIndices}
          onRestore={handleRestore}
          onZoom={(i) => { setZoomIndex(i); setView("zoom"); }}
          onReorder={setFrameOrder}
          onDelete={(indices) => {
            const toRemove = new Set(indices);
            setFrameOrder((o) => o.filter((i) => !toRemove.has(i)));
          }}
          onSpotlightChange={updateSpotlight}
          onPreview={() => setShowPreviewModal(true)}
          compactNavButton={compactNavButton}
        />
      )}

      {view === "zoom" && zoomIndex !== null && (
        <Zoom
          thumbs={orderedPlayerFrames.length > 0 ? orderedPlayerFrames : orderedThumbs}
          index={zoomIndex}
          edits={edits}
          inputEvents={inputEvents}
          simplify={prefs.simplify}
          spotlight={prefs.spotlight}
          onBack={() => setView("grid")}
          onNavigate={setZoomIndex}
          onDelete={(idx) => setFrameOrder((o) => o.filter((i) => i !== idx))}
          onEditsChange={setEdits}
          onSimplifyChange={updateSimplify}
          compactNavButton={compactNavButton}
        />
      )}

      {showPreviewModal && (
        <SheetPreviewModal
          sheet={prefs.sheet}
          frameOrder={frameOrder}
          edits={edits}
          trim={trim}
          spotlight={prefs.spotlight}
          defaultDir={prefs.defaultSaveDir}
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
            title="Player"
          >
            <IconPlay size={20} />
            <span>Player</span>
          </button>
          <button
            type="button"
            className={`global-nav__item ${view === "grid" ? "global-nav__item--active" : ""}`}
            onClick={() => source && setView("grid")}
            disabled={!source}
            title="Frames"
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
            title="Frame editor"
          >
            <IconImage size={20} />
            <span>Editor</span>
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
}

function CompactNav({
  view,
  hasSource,
  onClose,
  onHome,
  onPlayer,
  onFrames,
  onEditor,
}: CompactNavProps) {
  const items = [
    { label: "Home",   icon: <IconHome size={16} />,  active: view === "home" || view === "config", disabled: false,      action: onHome },
    { label: "Player", icon: <IconPlay size={16} />,  active: view === "player",                    disabled: !hasSource, action: onPlayer },
    { label: "Frames", icon: <IconGrid size={16} />,  active: view === "grid",                      disabled: !hasSource, action: onFrames },
    { label: "Editor", icon: <IconImage size={16} />, active: view === "zoom",                      disabled: !hasSource, action: onEditor },
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
