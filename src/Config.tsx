import { open } from "@tauri-apps/plugin-dialog";
import { IconBack, IconFolder } from "./icons";
import { Preferences } from "./lib/prefs";

interface Props {
  prefs: Preferences;
  highQualityAvailable: boolean;
  onChange: (update: Partial<Preferences>) => void;
  onBack: () => void;
}

const FPS_PRESETS = [2, 5, 10, 15, 30];
const COUNTDOWN_PRESETS = [0, 3, 5, 10];

export default function Config({
  prefs,
  highQualityAvailable,
  onChange,
  onBack,
}: Props) {
  const pickSaveDir = async () => {
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked === "string") {
      onChange({ defaultSaveDir: picked });
    }
  };

  return (
    <div className="config">
      <div className="config__chrome">
        <button type="button" className="icon-btn" onClick={onBack}>
          <IconBack />
        </button>
        <h2 className="config__title">Settings</h2>
      </div>

      <div className="config__body">
        <section className="config__section">
          <label className="row">
            <span>Default FPS</span>
            <div className="row__control fps-row">
              {FPS_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`chip ${prefs.fps === p ? "chip--active" : ""}`}
                  onClick={() => onChange({ fps: p })}
                >
                  {p}
                </button>
              ))}
              <input
                type="number"
                min={1}
                max={60}
                value={prefs.fps}
                onChange={(e) =>
                  onChange({
                    fps: Math.max(
                      1,
                      Math.min(60, Number(e.target.value) || 1),
                    ),
                  })
                }
              />
            </div>
          </label>
        </section>

        <section className="config__section">
          <div className="row">
            <span>Cursor</span>
            <div className="row__control fps-row">
              <button
                type="button"
                className={`chip ${prefs.cursorMode === "off" ? "chip--active" : ""}`}
                onClick={() => onChange({ cursorMode: "off" })}
              >
                Off
              </button>
              <button
                type="button"
                className={`chip ${prefs.cursorMode === "baked" ? "chip--active" : ""}`}
                onClick={() => onChange({ cursorMode: "baked" })}
              >
                Show
              </button>
              <button
                type="button"
                className={`chip ${prefs.cursorMode === "overlay" ? "chip--active" : ""}`}
                onClick={() => onChange({ cursorMode: "overlay" })}
              >
                Overlay
              </button>
            </div>
          </div>
          <p className="row__hint muted">
            {prefs.cursorMode === "off"
              ? "No cursor in the recording."
              : prefs.cursorMode === "baked"
                ? "Cursor drawn directly into each frame."
                : "Cursor recorded as metadata and re-drawn on top of any edits — keeps the cursor visible without exposing it to simplify, blur, etc."}
          </p>
        </section>

        <section className="config__section">
          <label className="row">
            <span>Show clicks</span>
            <div className="row__control">
              <label className="switch">
                <input
                  type="checkbox"
                  checked={prefs.recordClicks}
                  onChange={(e) =>
                    onChange({ recordClicks: e.target.checked })
                  }
                />
                <span className="slider" />
              </label>
            </div>
          </label>
          <p className="row__hint muted">
            Captures mouse-click positions during recording and overlays
            an expanding ring at each click.
          </p>
        </section>

        <section className="config__section">
          <div className="row">
            <span>Countdown</span>
            <div className="row__control fps-row">
              {COUNTDOWN_PRESETS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`chip ${prefs.countdownSeconds === s ? "chip--active" : ""}`}
                  onClick={() => onChange({ countdownSeconds: s })}
                >
                  {s === 0 ? "Off" : `${s}s`}
                </button>
              ))}
            </div>
          </div>
          <p className="row__hint muted">
            Delay before recording actually starts so you can position the
            target window. ESC cancels the countdown.
          </p>
        </section>

        <section className="config__section">
          <label className="row">
            <span>Show keystrokes</span>
            <div className="row__control">
              <label className="switch">
                <input
                  type="checkbox"
                  checked={prefs.recordKeys}
                  onChange={(e) =>
                    onChange({ recordKeys: e.target.checked })
                  }
                />
                <span className="slider" />
              </label>
            </div>
          </label>
          <p className="row__hint muted">
            Captures key presses during recording and shows the most
            recent ones in a corner of the playback.
          </p>
        </section>

        <section className="config__section">
          <label className="row">
            <span>Record audio</span>
            <div className="row__control">
              <label className="switch">
                <input
                  type="checkbox"
                  checked={prefs.recordAudio}
                  onChange={(e) =>
                    onChange({ recordAudio: e.target.checked })
                  }
                />
                <span className="slider" />
              </label>
            </div>
          </label>
          <p className="row__hint muted">
            Captures the default mic during recording. Audio is muxed
            into MP4 / WebM exports — GIFs are silent.
          </p>
        </section>

        <section className="config__section">
          <label
            className="row"
            title={
              highQualityAvailable
                ? ""
                : "This build was compiled without gifski support. Rebuild with --features gifski (AGPL)."
            }
          >
            <span>High quality GIF</span>
            <div className="row__control">
              <label className="switch">
                <input
                  type="checkbox"
                  checked={prefs.highQuality}
                  disabled={!highQualityAvailable}
                  onChange={(e) =>
                    onChange({ highQuality: e.target.checked })
                  }
                />
                <span className="slider" />
              </label>
            </div>
          </label>
          <p className="row__hint muted">
            {highQualityAvailable
              ? "Uses gifski's pngquant-based palette optimisation. Noticeably slower to encode."
              : "Unavailable in this build. Rebuild with the gifski Cargo feature to enable."}
          </p>
        </section>

        <section className="config__section">
          <label className="row">
            <span>Compact UI</span>
            <div className="row__control">
              <label className="switch">
                <input
                  type="checkbox"
                  checked={prefs.compactUi}
                  onChange={(e) =>
                    onChange({ compactUi: e.target.checked })
                  }
                />
                <span className="slider" />
              </label>
            </div>
          </label>
          <p className="row__hint muted">
            Hides the hero artwork and tightens spacing for a denser home view.
          </p>
        </section>

        <section className="config__section">
          <label className="row">
            <span>Region snapping</span>
            <div className="row__control">
              <select
                value={prefs.regionDetection}
                onChange={(e) =>
                  onChange({
                    regionDetection: e.target.value as
                      | "low"
                      | "medium"
                      | "high",
                  })
                }
              >
                <option value="low">Low — big windows only</option>
                <option value="medium">Medium — visible windows</option>
                <option value="high">High — panels & sub-windows</option>
              </select>
            </div>
          </label>
          <p className="row__hint muted">
            How aggressively the region-select overlay detects window edges
            for snapping. High picks up toolbars and individual panels inside
            apps; low sticks to big top-level windows.
          </p>
        </section>

        <section className="config__section">
          <label className="row">
            <span>Default save folder</span>
            <div className="row__control save-dir">
              <span className="save-dir__path muted">
                {prefs.defaultSaveDir ?? "Ask every time"}
              </span>
              <button
                type="button"
                className="btn btn--sm"
                onClick={pickSaveDir}
              >
                <IconFolder size={14} />
                Choose…
              </button>
              {prefs.defaultSaveDir && (
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => onChange({ defaultSaveDir: null })}
                >
                  clear
                </button>
              )}
            </div>
          </label>
          <p className="row__hint muted">
            Save dialogs will open here by default when exporting a sprite sheet.
          </p>
        </section>
      </div>
    </div>
  );
}
