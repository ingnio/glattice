import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  IconChevron,
  IconConfig,
  IconMoon,
  IconRecord,
  IconRegion,
  IconStop,
  IconSun,
  IconUpload,
  IconX,
} from "./icons";
import logoUrl from "./assets/glattice-logo.png";
import { convertFileSrc, RegionInput } from "./lib/tauri";
import { HistoryEntry, Theme } from "./lib/prefs";
import mascotLightUrl from "./assets/mascot.png";
import mascotDarkUrl from "./assets/mascot-dark.png";

interface Props {
  isRecording: boolean;
  elapsedMs: number;
  fps: number;
  region: RegionInput | null;
  supported: boolean | null;
  busy: string | null;
  theme: Theme;
  compact: boolean;
  history: HistoryEntry[];
  onOpenHistory: (path: string) => void;
  onRemoveHistory: (id: number) => void;
  onRecord: () => void;
  onStop: () => void;
  onSelectRegion: () => void;
  onSelectRegionHover: () => void;
  onClearRegion: () => void;
  onConfig: () => void;
  onThemeChange: (t: Theme) => void;
  onDropGif: (path: string) => void;
}

export default function Home({
  isRecording,
  elapsedMs,
  fps,
  region,
  supported,
  busy,
  theme,
  compact,
  history,
  onOpenHistory,
  onRemoveHistory,
  onRecord,
  onStop,
  onSelectRegion,
  onSelectRegionHover,
  onClearRegion,
  onConfig,
  onThemeChange,
  onDropGif,
}: Props) {
  const [dragActive, setDragActive] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);

  // ESC clears a pending region on the home view so the user can back
  // out of "region selected" without actually starting a recording.
  // Inert while recording (capture uses its own hotkey to stop) or
  // when no region is set.
  useEffect(() => {
    if (isRecording || !region) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClearRegion();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isRecording, region, onClearRegion]);

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
    <div className={`home2 ${compact ? "home2--compact" : ""}`}>
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
          <div className="theme-toggle">
            <button
              type="button"
              className="theme-toggle__btn"
              onClick={() => setThemeOpen((o) => !o)}
              aria-haspopup="true"
              aria-expanded={themeOpen}
            >
              {theme === "dark" ? <IconMoon size={16} /> : <IconSun size={16} />}
              <span>Theme</span>
              <IconChevron size={14} />
            </button>
            {themeOpen && (
              <>
                <div
                  className="theme-toggle__scrim"
                  onClick={() => setThemeOpen(false)}
                />
                <div className="theme-toggle__menu" role="menu">
                  {(["light", "dark", "system"] as Theme[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`theme-toggle__item ${t === theme ? "theme-toggle__item--active" : ""}`}
                      onClick={() => {
                        onThemeChange(t);
                        setThemeOpen(false);
                      }}
                    >
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {!compact && (
        <main className="home2__hero">
          <div className="home2__mascot">
            <Sparkles />
            <img
              className="home2__mascot-img home2__mascot-img--light"
              src={mascotLightUrl}
              alt="Glattice mascot"
            />
            <img
              className="home2__mascot-img home2__mascot-img--dark"
              src={mascotDarkUrl}
              alt="Glattice mascot"
              aria-hidden="true"
            />
          </div>
        </main>
      )}

      <section className="home2__card">
        {busy ? (
          <div className="home__busy">
            <div className="home__busy-spinner" />
            <div className="home__busy-text">{busy}</div>
          </div>
        ) : isRecording ? (
          <div className="home2__recording">
            <div className="home__recording">
              <div className="home__recording-dot" />
              <div className="home__recording-time">
                {(elapsedMs / 1000).toFixed(1)}s
              </div>
              <div className="home__recording-meta muted">
                {fps} fps ·{" "}
                {region ? `${region.width}×${region.height}` : "full display"}
              </div>
            </div>
            <button
              type="button"
              className="big-btn big-btn--danger"
              onClick={onStop}
            >
              <IconStop size={28} />
              <span>Stop</span>
            </button>
          </div>
        ) : (
          <>
            <div className="action-grid">
              <button
                type="button"
                className="action-card action-card--primary"
                onClick={onRecord}
                disabled={supported === false}
              >
                <div className="action-card__icon">
                  <IconRecord size={30} />
                </div>
                <div className="action-card__title">Record</div>
                <div className="action-card__subtitle">Capture a new GIF</div>
              </button>
              <button
                type="button"
                className={`action-card ${region ? "action-card--active" : ""}`}
                onClick={onSelectRegion}
                onMouseEnter={onSelectRegionHover}
                disabled={supported === false}
              >
                <div className="action-card__icon">
                  <IconRegion size={28} />
                </div>
                <div className="action-card__title">
                  {region ? "Region set" : "Select region"}
                </div>
                <div className="action-card__subtitle">
                  Record just an area
                </div>
              </button>
            </div>

            {region && (
              <div className="home__region-info">
                <span className="muted">
                  {region.width}×{region.height} @ ({region.x}, {region.y})
                </span>
                <button
                  type="button"
                  className="link-btn"
                  onClick={onClearRegion}
                >
                  clear
                </button>
              </div>
            )}

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

      {!compact && history.length > 0 && !isRecording && !busy && (
        <section className="home2__recent">
          <div className="recent__header">
            <span className="recent__title muted">Recent</span>
          </div>
          <div className="recent__list">
            {history.slice(0, 8).map((entry) => (
              <RecentEntry
                key={entry.id}
                entry={entry}
                onOpen={onOpenHistory}
                onRemove={onRemoveHistory}
              />
            ))}
          </div>
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

function relTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return "Yesterday";
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function fmtDuration(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
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
      title={entry.gifPath}
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
        <div className="recent-entry__meta">
          {entry.width}×{entry.height} · {entry.frameCount}f ·{" "}
          {fmtDuration(entry.durationMs)}
        </div>
        <div className="recent-entry__time muted">{relTime(entry.createdAt)}</div>
      </div>
      <button
        type="button"
        className="recent-entry__remove icon-btn icon-btn--xs"
        title="Remove from history"
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

function Sparkles() {
  return (
    <svg className="home2__sparkles" viewBox="0 0 200 120" aria-hidden="true">
      {[
        { x: 18, y: 28, s: 8 },
        { x: 180, y: 24, s: 10 },
        { x: 30, y: 95, s: 6 },
        { x: 176, y: 92, s: 8 },
      ].map((p, i) => (
        <path
          key={i}
          d={`M${p.x} ${p.y - p.s} L${p.x + p.s / 3} ${p.y - p.s / 3} L${p.x + p.s} ${p.y} L${p.x + p.s / 3} ${p.y + p.s / 3} L${p.x} ${p.y + p.s} L${p.x - p.s / 3} ${p.y + p.s / 3} L${p.x - p.s} ${p.y} L${p.x - p.s / 3} ${p.y - p.s / 3} Z`}
        />
      ))}
    </svg>
  );
}
