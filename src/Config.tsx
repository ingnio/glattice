import { open } from "@tauri-apps/plugin-dialog";
import { IconBack, IconFolder } from "./icons";
import { Preferences, Theme } from "./lib/prefs";

interface Props {
  prefs: Preferences;
  highQualityAvailable: boolean;
  onChange: (update: Partial<Preferences>) => void;
  onBack: () => void;
  onShowShortcuts: () => void;
}

const FPS_PRESETS = [2, 5, 10, 15, 30];
const COUNTDOWN_PRESETS = [0, 3, 5, 10];

export default function Config({
  prefs,
  highQualityAvailable,
  onChange,
  onBack,
  onShowShortcuts,
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
        <button
          type="button"
          className="icon-btn"
          onClick={onBack}
          title="Back to Home"
          aria-label="Back to Home"
        >
          <IconBack />
        </button>
        <h2 className="config__title">Settings</h2>
      </div>

      <div className="config__body">
        <h3 className="config__group">Appearance</h3>

        <section className="config__section">
          <div className="row">
            <span>Theme</span>
            <div className="row__control fps-row">
              {(["light", "dark", "system"] as Theme[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`chip ${prefs.theme === t ? "chip--active" : ""}`}
                  onClick={() => onChange({ theme: t })}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="config__section">
          <label className="row">
            <span>Compact layout</span>
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
            Tighter spacing for a denser home screen. Also available from the
            Compact button on Home.
          </p>
        </section>

        <section className="config__section">
          <div className="row">
            <span>Keyboard shortcuts</span>
            <div className="row__control">
              <button type="button" className="btn btn--sm" onClick={onShowShortcuts}>
                Show list
              </button>
            </div>
          </div>
          <p className="row__hint muted">
            Press <kbd>?</kbd> anywhere to see them.
          </p>
        </section>

        <h3 className="config__group">Recording</h3>

        <section className="config__section">
          <label className="row">
            <span>Frames per second</span>
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
          <p className="row__hint muted">
            Higher is smoother but makes bigger files. 5 to 10 suits most
            screen recordings.
          </p>
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
              ? "The cursor is left out of the recording."
              : prefs.cursorMode === "baked"
                ? "The cursor is part of the picture, so a blur or shape you add later can cover it."
                : "The cursor is drawn on top of your edits, so a blur or shape you add later never hides it."}
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
            Marks every mouse click with a ring that spreads out and fades.
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
            A pause before recording starts, so you can get the window
            ready. Esc cancels it.
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
            Shows the keys you press in the bottom-left corner of the
            recording.
          </p>
        </section>

        <section className="config__section">
          <label className="row">
            <span>Record microphone</span>
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
            Records your default microphone. The sound is included when
            you export MP4 or WebM; GIFs are always silent.
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
                <option value="low">Low — large windows only</option>
                <option value="medium">Medium — visible windows</option>
                <option value="high">High — includes panels & inner windows</option>
              </select>
            </div>
          </label>
          <p className="row__hint muted">
            When you select a region, it snaps to window edges. Higher settings
            also snap to toolbars and panels inside apps.
          </p>
        </section>

        <h3 className="config__group">Output</h3>

        <section className="config__section">
          <label className="row">
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
              ? "Better colors and smoother gradients in recorded GIFs. Recordings take noticeably longer to finish."
              : "Not included in this version of Glattice."}
          </p>
        </section>

        <section className="config__section">
          <div className="row">
            <span>Spotlight by default</span>
            <div className="row__control">
              <label className="switch">
                <input
                  type="checkbox"
                  checked={prefs.spotlight.enabled}
                  onChange={(e) =>
                    onChange({ spotlight: { ...prefs.spotlight, enabled: e.target.checked } })
                  }
                />
                <span className="slider" />
              </label>
            </div>
          </div>
          <label className="row">
            <span>Radius</span>
            <div className="row__control config__slider-row">
              <input
                type="range"
                min={0}
                max={200}
                step={5}
                value={prefs.spotlight.radius}
                onChange={(e) =>
                  onChange({ spotlight: { ...prefs.spotlight, radius: Number(e.target.value) } })
                }
              />
              <span className="muted config__slider-val">{prefs.spotlight.radius}px</span>
            </div>
          </label>
          <label className="row">
            <span>Darkness</span>
            <div className="row__control config__slider-row">
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={Math.round(prefs.spotlight.dimOpacity * 100)}
                onChange={(e) =>
                  onChange({ spotlight: { ...prefs.spotlight, dimOpacity: Number(e.target.value) / 100 } })
                }
              />
              <span className="muted config__slider-val">{Math.round(prefs.spotlight.dimOpacity * 100)}%</span>
            </div>
          </label>
          <p className="row__hint muted">
            Dims everything outside a circle around the cursor, in playback
            and in exports. New recordings start with it on or off as set
            here; switch it for a single recording in the Player or the
            Editor. It follows the recorded cursor, so Cursor has to be set
            to Show or Overlay.
          </p>
          {prefs.spotlight.enabled && prefs.cursorMode === "off" && (
            <div className="config__note" role="status">
              <span>
                Cursor is set to Off, so new recordings will have no cursor
                for the spotlight to follow.
              </span>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => onChange({ cursorMode: "overlay" })}
              >
                Use Overlay cursor
              </button>
            </div>
          )}
        </section>

        <section className="config__section">
          <label className="row">
            <span>Save folder</span>
            <div className="row__control save-dir">
              <span className="save-dir__path muted">
                {prefs.defaultSaveDir ?? "Not set"}
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
                  Clear
                </button>
              )}
            </div>
          </label>
          <p className="row__hint muted">
            {prefs.defaultSaveDir
              ? "Every export (GIF, MP4, WebM, sprite sheet, single frame) starts in this folder. You can still pick another one each time."
              : "Choose a folder and every export will start there. Until then, the save dialog opens wherever you saved last."}
          </p>
        </section>
      </div>
    </div>
  );
}
