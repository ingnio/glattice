# Glattice

<p align="center">
  <img src="src/assets/glattice-logo.png" alt="Glattice" width="200" />
</p>

A lightweight desktop screen recorder built for bug reports and tutorials. Record your screen, annotate individual frames, then export as an animated GIF, MP4/WebM, or a sprite sheet you can paste directly into a GitHub issue.

Built with [Tauri v2](https://tauri.app), React 19, and Rust. Runs on Windows 10 and 11.

<p align="center">
  <img src="docs/screenshots/editor.png" alt="The frame editor with numbered step markers and a blurred email address on a frame" width="720" />
</p>

| Player | Frames |
| --- | --- |
| ![The Player with scrubber, trim and export controls](docs/screenshots/player.png) | ![The Frames grid showing every frame of a recording](docs/screenshots/frames.png) |

Everything stays on your computer: Glattice makes no network connections and collects nothing. See [PRIVACY.md](PRIVACY.md).

---

## Install

Download the latest installer from the [Releases](https://github.com/ingnio/glattice/releases) page and run it. It installs for your user account only, so it doesn't need administrator rights.

The installers are not code-signed yet, so Windows SmartScreen may warn the first time. Choose **More info**, then **Run anyway**.

To build it yourself instead, see [Building](#building).

---

## Features

### Recording
- **Full-screen or region capture** — drag to select any area, or snap to a detected window
- **Configurable FPS** — presets (2 / 5 / 10 / 15 / 30) plus a custom input
- **Click indicators** — animated ripple rings baked into the output (left = amber, right = red, middle = purple)
- **Key press display** — recent keystrokes shown as on-screen chips (e.g. `Ctrl+S`)
- **Cursor overlay** — cursor re-drawn on top of all edits so it stays sharp; can be off, baked, or overlay
- **Audio recording** — optional microphone capture, muxed into MP4 / WebM exports
- **Countdown timer** — 0–10 s delay before capture starts, shown on screen where the recording will happen
- **Recording strip** — while recording, Glattice shrinks to a small always-on-top strip with the timer, Stop and Discard; it never appears in the recording
- **Global hotkey** — `Ctrl+Shift+R` starts and stops a recording from anywhere

### Editing
- **Per-frame annotation tools** — arrows, rectangles, ellipses, freehand lines, and text labels
- **Step numbers** — click to drop numbered markers (1, 2, 3…) that point out steps in order
- **Image overlay** — insert a PNG/JPG/WebP image onto any frame; drag to move, drag corners to resize; baked into all exports including sprite sheets
- **Blur** — drag a region to apply Gaussian blur (radius 2–40 px) for privacy
- **Simplify** — AI-style text redaction: detects text blocks and replaces them with solid rounded shapes; tunable block size, threshold, merge, and roundness
- **Spotlight** — darkening vignette around the cursor; configurable radius and opacity; applied consistently across player, editor, video export, and sprite sheet
- **Per-frame hold time** — add extra pause duration to individual frames directly from the player; reflected in MP4/WebM mux timing
- **Trim** — set in/out points with `I` / `O` keys (or drag the scrubber handles); trimmed frames are left out of playback, the editor and every export, and the trim follows its frames when you delete or reorder
- **Delete and restore frames** — remove frames from the clip and bring them back later
- **Undo and redo** — `Ctrl+Z` and `Ctrl+Y` on the current frame's edits
- **Tool shortcuts** — single letters pick editor tools; press `?` anywhere for the full shortcut list
- **Copy edits to all frames** — apply the current frame's annotations to every frame at once

### Playback
- **Player** with scrubber, loop / boomerang / play-once modes; loop mode, speed, and play state persist across view navigation
- **Speed control** — 0.25× to 4× playback multiplier
- **Frames grid** — thumbnail overview with multi-frame selection (click / Ctrl+click / Shift+click range); Ctrl+scroll to zoom the grid; right-click context menu with per-frame actions and Properties
- **Live sheet preview** — grid layout updates in real time as you adjust columns, padding, border, background, and annotation settings
- **Frame editor** — full-size per-frame editing with resize handles on every annotation

### Export
| Format | Notes |
|--------|-------|
| **Animated GIF** | Includes your edits, trim, frame order and overlays; high-quality option via gifski (see below) |
| **MP4** | H.264 + AAC, WebCodecs-based encoding in-browser |
| **WebM** | VP9 + Opus |
| **Sprite sheet** | PNG / JPEG / WebP; configurable columns, padding, borders, frame number / timestamp annotations |

- **Drag-out** — drag an unedited recording straight from the Player into Slack, Discord, a file manager, or a browser upload field
- **Save dialog** — choose the destination each time; an optional save folder sets where it starts
- **Export feedback** — progress while encoding, then a confirmation with **Show in folder**

### UI
- **Compact layout** — a small, dense home window; toggle from Home or Settings
- **Light / dark / system theme**
- **Recent history** — last 20 recordings / imports with thumbnails

---

## Building

### Prerequisites

- [Rust](https://rustup.rs) (stable)
- [Node.js](https://nodejs.org) ≥ 20 + [pnpm](https://pnpm.io)
- The [Tauri prerequisites for Windows](https://tauri.app/start/prerequisites/) (Microsoft C++ Build Tools and WebView2)

The Tauri CLI is installed with the project's dependencies, so there is nothing else to install.

### Dev

```sh
pnpm install
pnpm tauri dev
```

### Release

```sh
pnpm tauri build
```

The installers are written to `src-tauri/target/release/bundle/`.

### High-quality GIF (gifski)

gifski produces better color palettes using pngquant's cross-frame optimization, but is **AGPL-3.0**. It is opt-in so default builds stay MIT-clean:

```sh
pnpm tauri build --features glattice/gifski
# or from src-tauri/:
cargo build --release --features gifski
```

The UI surfaces "High quality" GIF encoding automatically when the feature is compiled in.

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Shell | Tauri v2 |
| Frontend | React 19 + TypeScript + Vite |
| Screen capture | [`xcap`](https://crates.io/crates/xcap) |
| GIF encode | [`gif`](https://crates.io/crates/gif) + optional [`gifski`](https://crates.io/crates/gifski) for recordings; a built-in encoder for edited exports |
| Video encode | [mediabunny](https://github.com/nicolo-ribaudo/mediabunny) (WebCodecs) |
| Audio capture | [`cpal`](https://crates.io/crates/cpal) + [`hound`](https://crates.io/crates/hound) |
| Sprite sheet | Custom Rust compositor (`image` crate) |

---

## Contributing

Bug reports and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) to get set up, and [SECURITY.md](SECURITY.md) to report a security problem privately.

---

## License

MIT — see [LICENSE](LICENSE). This covers the source and the official installers.

Building with `--features gifski` links AGPL-3.0 code, and a binary built that way is subject to the AGPL.

Glattice bundles the Roboto Mono font (SIL Open Font License 1.1) and is built on open-source libraries. They are listed with their licenses in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md), which is also installed alongside the app.
