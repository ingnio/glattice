import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  IconCamera,
  IconChevron,
  IconCompact,
  IconConfig,
  IconExpand,
  IconRecord,
  IconRegion,
  IconUpload,
  IconX,
} from "./icons";
import logoUrl from "./assets/glattice-logo.png";
import { convertFileSrc, RegionInput } from "./lib/tauri";
import { HistoryEntry } from "./lib/prefs";

export type CaptureMode = "record" | "screenshot";

interface Props {
  region: RegionInput | null;
  supported: boolean | null;
  busy: string | null;
  compact: boolean;
  history: HistoryEntry[];
  onOpenHistory: (path: string) => void;
  onRemoveHistory: (id: number) => void;
  onRecord: () => void;
  /** Capture one still and open it in the Editor. */
  onScreenshot: () => void;
  /** What the main capture button does. Chosen from the chevron on
   *  that button; lasts until changed or the app is restarted. */
  captureMode: CaptureMode;
  onCaptureModeChange: (mode: CaptureMode) => void;
  onSelectRegion: () => void;
  onClearRegion: () => void;
  onConfig: () => void;
  onCompactChange: (compact: boolean) => void;
  /** Natural content height of Home, for sizing the window to fit. */
  onContentHeight: (height: number, compact: boolean) => void;
  /** Compact-mode ⋮ menu for getting back to Player / Frames / Editor. */
  compactNavButton?: React.ReactNode;
  onDropGif: (path: string) => void;
}

export default function Home({
  region,
  supported,
  busy,
  compact,
  history,
  onOpenHistory,
  onRemoveHistory,
  onRecord,
  onScreenshot,
  captureMode,
  onCaptureModeChange,
  onSelectRegion,
  onClearRegion,
  onConfig,
  onCompactChange,
  onContentHeight,
  compactNavButton,
  onDropGif,
}: Props) {
  const [dragActive, setDragActive] = useState(false);
  // Compact mode keeps Recent collapsed until asked for.
  const [recentOpen, setRecentOpen] = useState(false);
  // The Record / Screenshot list opened from the capture button's chevron.
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const closeModeMenu = useCallback(() => setModeMenuOpen(false), []);
  const modeMenu = modeMenuOpen ? (
    <CaptureModeMenu
      mode={captureMode}
      onPick={(m) => {
        onCaptureModeChange(m);
        setModeMenuOpen(false);
      }}
      onClose={closeModeMenu}
    />
  ) : null;
  const rootRef = useRef<HTMLDivElement>(null);
  const lastHeightRef = useRef("");

  // The Home window is sized to its content in both layouts, so report
  // the natural height (children + gaps + padding) whenever it changes.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const gap = parseFloat(cs.rowGap) || 0;
    const kids = Array.from(el.children) as HTMLElement[];
    const h = Math.ceil(
      kids.reduce((sum, k) => sum + k.offsetHeight, 0) +
        gap * Math.max(0, kids.length - 1) +
        pad,
    );
    // Report which layout the height belongs to, so the window is never
    // resized with a measurement taken in the other layout.
    const key = `${compact ? "c" : "f"}:${h}`;
    if (key !== lastHeightRef.current) {
      lastHeightRef.current = key;
      onContentHeight(h, compact);
    }
  });

  // ESC clears a pending region on the home view so the user can back
  // out of "region selected" without actually starting a recording.
  // Inert when no region is set. (Home isn't on screen while a take is
  // running; the recording strip replaces it.)
  useEffect(() => {
    if (!region) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClearRegion();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [region, onClearRegion]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      unlisten = await getCurrentWebview().onDragDropEvent((event) => {
        const p = event.payload;
        if (p.type === "enter" || p.type === "over") setDragActive(true);
        else if (p.type === "leave") setDragActive(false);
        else if (p.type === "drop") {
          setDragActive(false);
          const paths = (p as { paths?: string[] }).paths ?? [];
          const gifPath = paths.find((s) => /\.gif$/i.test(s));
          if (gifPath) onDropGif(gifPath);
        }
      });
    })();
    return () => {
      unlisten?.();
    };
  }, [onDropGif]);

  const pickFile = async () => {
    const picked = await openDialog({
      multiple: false,
      filters: [{ name: "GIF", extensions: ["gif"] }],
    });
    if (typeof picked === "string") onDropGif(picked);
  };

  return (
    <div ref={rootRef} className={`home2 ${compact ? "home2--compact" : ""}`}>
      <header className="home2__header">
        <div className="home2__brand">
          <img className="home2__logo-img" src={logoUrl} alt="" aria-hidden="true" />
          <span className="home2__brand-name">Glattice</span>
        </div>
        <div className="home2__header-right">
          <button
            type="button"
            className="icon-btn"
            onClick={onConfig}
            title="Settings"
          >
            <IconConfig />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => onCompactChange(!compact)}
            aria-pressed={compact}
            aria-label="Compact layout"
            title={compact ? "Switch to the full layout" : "Switch to the compact layout"}
          >
            {compact ? <IconExpand /> : <IconCompact />}
          </button>
          {compactNavButton}
        </div>
      </header>

      <section className="home2__card">
        {busy ? (
          <div className="home__busy">
            <div className="home__busy-spinner" />
            <div className="home__busy-text">{busy}</div>
          </div>
        ) : region ? (
          <div className="home2__region-panel">
            <div className="home2__region-head">
              <span className="home2__region-title">Region selected</span>
              <span
                className="muted home2__region-size"
                title={`Top-left corner at (${region.x}, ${region.y})`}
              >
                {region.width} × {region.height} px
              </span>
            </div>
            <CaptureButton
              mode={captureMode}
              onRecord={onRecord}
              onScreenshot={onScreenshot}
              disabled={supported === false}
              region
              menuOpen={modeMenuOpen}
              onMenuToggle={() => setModeMenuOpen((o) => !o)}
            />
            {modeMenu}
            <div className="home2__region-actions">
              <button
                type="button"
                className="btn btn--sm"
                onClick={onSelectRegion}
                title="Draw a different region"
              >
                Change region
              </button>
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                onClick={onClearRegion}
                title="Remove the region and go back to full-screen recording (Esc)"
              >
                Reset region
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="action-grid">
              <CaptureButton
                mode={captureMode}
                onRecord={onRecord}
                onScreenshot={onScreenshot}
                disabled={supported === false}
                menuOpen={modeMenuOpen}
                onMenuToggle={() => setModeMenuOpen((o) => !o)}
              />
              <button
                type="button"
                className="action-card"
                onClick={onSelectRegion}
                disabled={supported === false}
              >
                <div className="action-card__icon">
                  <IconRegion size={28} />
                </div>
                <div className="action-card__title">Select region</div>
                <div className="action-card__subtitle">
                  Record just an area
                </div>
              </button>
            </div>
            {modeMenu}

            <p className="home2__tip muted">
              <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>{" "}
              {captureMode === "screenshot"
                ? "takes a screenshot from anywhere"
                : "starts and stops recording from anywhere"}
            </p>

            <div className="home2__or">
              <span className="home2__or-line" />
              <span className="home2__or-text muted">or</span>
              <span className="home2__or-line" />
            </div>

            <button
              type="button"
              className={`drop-area ${dragActive ? "drop-area--active" : ""}`}
              onClick={pickFile}
            >
              <IconUpload size={26} />
              <span className="drop-area__title">Open a file</span>
              <span className="drop-area__hint muted">
                or drag and drop an animated .gif
              </span>
            </button>
          </>
        )}
      </section>

      {history.length > 0 && !busy && (
        <section className="home2__recent">
          {compact ? (
            <button
              type="button"
              className="recent__header recent__toggle"
              onClick={() => setRecentOpen((o) => !o)}
              aria-expanded={recentOpen}
            >
              <span className="recent__title muted">
                Recent · {history.length}
              </span>
              <span
                className="recent__chevron muted"
                style={{ transform: recentOpen ? "rotate(180deg)" : undefined }}
              >
                <IconChevron size={14} />
              </span>
            </button>
          ) : (
            <div className="recent__header">
              <span className="recent__title muted">Recent</span>
            </div>
          )}
          {(!compact || recentOpen) && (
            <div className="recent__list">
              {history.slice(0, compact ? 5 : 8).map((entry) => (
                <RecentEntry
                  key={entry.id}
                  entry={entry}
                  onOpen={onOpenHistory}
                  onRemove={onRemoveHistory}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {supported === false && (
        <div className="home__warn">
          Screen capture not supported on this platform — you can still open a
          GIF to compose a sprite sheet.
        </div>
      )}
    </div>
  );
}

const MODES: { mode: CaptureMode; label: string; hint: string }[] = [
  { mode: "record", label: "Record", hint: "Capture a GIF or video" },
  { mode: "screenshot", label: "Screenshot", hint: "One picture to mark up" },
];

/** The main capture button, split in two: the large part does the
 *  current mode, and the chevron on its right edge switches the mode
 *  between recording and taking a screenshot. Used for the full-screen
 *  card and, with `region`, for the selected-region button. */
function CaptureButton({
  mode,
  onRecord,
  onScreenshot,
  disabled,
  region = false,
  menuOpen,
  onMenuToggle,
}: {
  mode: CaptureMode;
  onRecord: () => void;
  onScreenshot: () => void;
  disabled: boolean;
  region?: boolean;
  menuOpen: boolean;
  onMenuToggle: () => void;
}) {
  const shot = mode === "screenshot";

  const title = shot
    ? region
      ? "Screenshot region"
      : "Screenshot"
    : region
      ? "Record region"
      : "Record";
  const subtitle = region
    ? "Ctrl+Shift+R"
    : shot
      ? "One picture to mark up"
      : "Capture a new GIF";
  const tooltip = shot
    ? `Take one picture of ${region ? "this region" : "the screen"} and open it to mark up (Ctrl+Shift+R)`
    : `Record ${region ? "this region" : "the full screen"} (Ctrl+Shift+R)`;
  const Icon = shot ? IconCamera : IconRecord;

  return (
    <div className={`action-split ${region ? "action-split--region" : ""}`}>
      <button
        type="button"
        className={`action-card action-card--primary ${region ? "action-card--ready home2__region-record" : ""}`}
        onClick={shot ? onScreenshot : onRecord}
        disabled={disabled}
        title={tooltip}
      >
        <div className="action-card__icon">
          <Icon size={region ? 26 : 30} />
        </div>
        {region ? (
          <div className="home2__region-record-text">
            <div className="action-card__title">{title}</div>
            <div className="action-card__subtitle">{subtitle}</div>
          </div>
        ) : (
          <>
            <div className="action-card__title">{title}</div>
            <div className="action-card__subtitle">{subtitle}</div>
          </>
        )}
      </button>
      <button
        type="button"
        className="action-split__chevron"
        onClick={onMenuToggle}
        disabled={disabled}
        aria-haspopup="true"
        aria-expanded={menuOpen}
        aria-label="Choose what this button does"
        title="Record or screenshot: choose what this button does"
      >
        <IconChevron size={16} />
      </button>
    </div>
  );
}

/** The list the chevron opens. It sits in the page under the button
 *  rather than floating over it: Home's window is sized to its content,
 *  so a floating menu would be cut off at the window's edge. In the page,
 *  the window simply grows to fit while it is open. */
function CaptureModeMenu({
  mode,
  onPick,
  onClose,
}: {
  mode: CaptureMode;
  onPick: (mode: CaptureMode) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Close only the menu; don't let Esc also clear the region.
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <>
      <div className="action-split__scrim" onClick={onClose} />
      <div className="action-split__menu" role="menu">
        {MODES.map((m) => (
          <button
            key={m.mode}
            type="button"
            role="menuitemradio"
            aria-checked={mode === m.mode}
            className={`action-split__item ${mode === m.mode ? "is-current" : ""}`}
            onClick={() => onPick(m.mode)}
          >
            <span className="action-split__item-icon">
              {m.mode === "screenshot" ? <IconCamera size={16} /> : <IconRecord size={16} />}
            </span>
            <span className="action-split__item-text">
              <span className="action-split__item-label">{m.label}</span>
              <span className="action-split__item-hint muted">{m.hint}</span>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

function relTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  if (hours < 24) return `${hours} hr ago`;
  if (days === 1) return "Yesterday";
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function fmtDuration(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} sec`;
  return `${Math.floor(s / 60)} min ${Math.round(s % 60)} sec`;
}

/** The file's name without its folder or extension, as the row's title. */
function fileLabel(path: string): string {
  const name = path.split(/[/\\]/).pop() ?? path;
  return name.replace(/\.[^.]+$/, "") || name;
}

function RecentEntry({
  entry,
  onOpen,
  onRemove,
}: {
  entry: HistoryEntry;
  onOpen: (path: string) => void;
  onRemove: (id: number) => void;
}) {
  const [thumbErr, setThumbErr] = useState(false);

  return (
    <button
      type="button"
      className="recent-entry"
      onClick={() => onOpen(entry.gifPath)}
      title={`${entry.gifPath}\n${entry.width}×${entry.height} pixels`}
    >
      <div className="recent-entry__thumb">
        {!thumbErr && entry.thumbPath ? (
          <img
            src={convertFileSrc(entry.thumbPath)}
            alt=""
            aria-hidden="true"
            onError={() => setThumbErr(true)}
            draggable={false}
          />
        ) : (
          <div className="recent-entry__thumb-placeholder" />
        )}
      </div>
      <div className="recent-entry__body">
        <div className="recent-entry__meta">{fileLabel(entry.gifPath)}</div>
        <div className="recent-entry__time muted">
          <span className="recent-entry__details">
            {entry.frameCount} {entry.frameCount === 1 ? "frame" : "frames"} ·{" "}
            {fmtDuration(entry.durationMs)} ·{" "}
          </span>
          {relTime(entry.createdAt)}
        </div>
      </div>
      <button
        type="button"
        className="recent-entry__remove icon-btn icon-btn--xs"
        title="Remove from list (keeps the GIF file)"
        onClick={(e) => {
          e.stopPropagation();
          onRemove(entry.id);
        }}
      >
        <IconX size={12} />
      </button>
    </button>
  );
}

