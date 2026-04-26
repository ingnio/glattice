# FrameSheet — Product Spec

**Version:** 0.1 draft
**Date:** 2026-04-23

---

## What it is

A lightweight desktop app for capturing screen recordings and converting them (or existing animated GIFs) into annotated sprite sheets / contact sheets. Primary use case: creating single-image bug reproduction artifacts for issue trackers.

## Why it exists

Videos in bug reports don't get watched. A sprite sheet — numbered frames on a grid, each showing one step — gives reviewers the full reproduction at a glance. Paste it into a GitHub issue and it's immediately useful without clicking play.

---

## Core capabilities (verified)

### 1. Screen recording → animated GIF

**Verdict: ✅ Feasible**

The `scap` crate (MIT, by Cap Software) provides high-performance, cross-platform screen capture for Windows, macOS, and Linux. It supports configurable FPS, cursor capture, target selection (specific window or display), and region cropping via a `source_rect` / `crop_area` parameter. Frames arrive as raw BGRA byte arrays at the requested frame rate.

For GIF encoding, the `gif` crate (part of the `image-rs` ecosystem) handles encoding RGBA frames into animated GIFs with configurable frame delays. For higher-quality output (better color palettes, temporal dithering), `gifski` is available — it produces animated GIFs using pngquant's cross-frame palette optimization. Either can be driven from the Rust backend.

**Implementation path:** `scap` captures raw frames → frames are buffered in memory → on stop, encode with `gif` or `gifski` → save to disk → display in UI.

**Platform note:** macOS requires Screen Recording permission (scap handles the permission request flow). Windows requires no special permissions. Linux support covers X11; Wayland global shortcuts are not yet supported by `tauri-plugin-global-shortcut`.

### 2. Configurable frame rate

**Verdict: ✅ Feasible — trivial**

`scap::Options` accepts an `fps` field directly:

```rust
let options = Options {
    fps: 10, // user-configurable
    show_cursor: true,
    // ...
};
```

For the sprite sheet use case, useful presets would be 2 FPS (slow walkthroughs), 5 FPS (default — good balance of detail and file size), 10 FPS (fast interactions), and a custom numeric input. The FPS setting also determines the GIF frame delay (1000ms / fps = delay per frame).

### 3. Region selection

**Verdict: ✅ Feasible, with a design choice**

`scap` supports region cropping via `crop_area`:

```rust
source_rect: Some(Area {
    origin: Point { x: 100.0, y: 200.0 },
    size: Size { width: 800.0, height: 600.0 },
}),
```

`xcap` (the library behind `tauri-plugin-screenshots`) also supports `capture_region(x, y, width, height)` for single-frame captures.

**The design choice is how the user selects the region.** Two approaches:

**Option A — Transparent overlay window.** On hotkey press, spawn a fullscreen transparent Tauri window. User clicks and drags to draw a selection rectangle. Coordinates are sent to the Rust backend. The overlay closes and recording begins. This is how tools like ShareX and Flameshot work.

**Option B — Predefined region via numeric inputs.** User types x, y, width, height in the settings panel, or picks a preset (e.g., "top half," "left monitor," "1920×1080 centered"). Less intuitive but simpler to implement.

**Recommendation:** Start with Option A. Tauri supports transparent, frameless windows, so the overlay approach is achievable. The coordinates from the drag selection feed directly into `scap`'s `crop_area`.

### 4. GIF → sprite sheet (in-house or imported)

**Verdict: ✅ Feasible**

The `gif` crate's `Decoder` iterates through all frames of an animated GIF, returning each as an RGBA buffer with dimensions and delay metadata. The `image` crate can then compose these onto a single output canvas:

- Decode all frames from the GIF
- Calculate grid layout: columns (user-configurable or auto-fit), rows = ceil(frame_count / columns)
- Create an output `ImageBuffer` of size (frame_width × columns + padding, frame_height × rows + padding)
- Paste each frame into its grid cell
- Optionally overlay frame numbers, timestamps, or annotations using a font renderer (`imageproc` + `rusttype` or `ab_glyph`)
- Encode the final composite as PNG

This works identically whether the GIF was just recorded by the app or imported from disk. The app treats its own recordings the same as any external GIF — it's always a file on disk by the time the sprite sheet is generated.

### 5. Drag and drop GIF files

**Verdict: ✅ Feasible, with a minor quirk**

Tauri 2 has native drag-and-drop events: `tauri://drag-enter`, `tauri://drag-over`, `tauri://drag-drop`, and `tauri://drag-leave`. On drop, the event payload includes the file path(s). Dropped files are automatically scoped for filesystem access (no extra permissions needed).

The minor quirk: Tauri's drag-drop events are window-level, not element-level. The standard HTML5 drag events don't fire in the webview. The workaround (well-documented) is to listen for `tauri://drag-drop` at the window level and use `mouseenter`/`mouseleave` on your drop-zone element to determine whether the drop landed in the right area.

In practice this works fine — there are complete working examples (e.g., `QuietJoon/Tauri_Drag_and_Drop_Example`) that demonstrate the pattern with Tauri 2 + React.

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| App framework | Tauri 2 | ~5MB binary, Rust backend, web frontend, cross-platform |
| Frontend | React + TypeScript | Familiar stack, good Tauri ecosystem support |
| Screen capture | `scap` | High-performance, configurable FPS/region/target, MIT |
| Screenshots (backup) | `xcap` via `tauri-plugin-screenshots` | Region capture, used by the overlay selection if needed |
| GIF encoding | `gif` crate (standard) or `gifski` (high-quality) | Pure Rust, no native deps |
| GIF decoding | `gif` crate | Frame-by-frame iteration with delay metadata |
| Image composition | `image` + `imageproc` | Canvas creation, frame pasting, text overlay |
| Font rendering | `ab_glyph` | For frame number / timestamp annotations |
| Global shortcuts | `tauri-plugin-global-shortcut` | System-wide hotkeys for start/stop recording |
| File system | `tauri-plugin-fs` | Read dropped files, save outputs |

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  React Frontend                  │
│                                                  │
│  ┌──────────┐ ┌───────────┐ ┌────────────────┐  │
│  │ Recorder │ │ GIF       │ │ Sprite Sheet   │  │
│  │ Controls │ │ Preview   │ │ Composer       │  │
│  └────┬─────┘ └─────┬─────┘ └───────┬────────┘  │
│       │             │               │            │
│       ▼             ▼               ▼            │
│  ─── Tauri IPC (invoke / events) ───────────── │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│                  Rust Backend                    │
│                                                  │
│  ┌──────────┐ ┌───────────┐ ┌────────────────┐  │
│  │ scap     │ │ gif crate │ │ image crate    │  │
│  │ capture  │ │ en/decode │ │ compose sheet  │  │
│  └──────────┘ └───────────┘ └────────────────┘  │
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │ tauri-plugin-global-shortcut             │    │
│  │ tauri-plugin-fs                          │    │
│  │ tauri-plugin-screenshots (optional)      │    │
│  └──────────────────────────────────────────┘    │
└──────────────────────────────────────────────────┘
```

---

## User flows

### Flow A: Record screen → sprite sheet

1. User presses global hotkey (e.g., `Ctrl+Shift+R`)
2. App shows transparent overlay — user drags to select region
3. Overlay closes, recording begins (indicator in system tray or small floating badge)
4. User presses hotkey again to stop
5. App encodes frames to GIF and displays the recording in the preview panel
6. User adjusts sprite sheet settings (columns, frame interval / skip, annotations)
7. User clicks "Generate" — app composes the sprite sheet as PNG
8. User copies to clipboard or saves to disk

### Flow B: Drag and drop GIF → sprite sheet

1. User drags an animated GIF onto the app window (or the dock icon)
2. App decodes the GIF and displays frames in the preview panel
3. User configures grid layout, selects/deselects frames, adds annotations
4. User clicks "Generate" — same output as Flow A

### Flow C: Record → GIF only (no sprite sheet)

1. Same as Flow A steps 1–5
2. User saves the GIF directly — no sprite sheet needed

---

## Sprite sheet configuration

- **Columns:** auto-fit (sqrt of frame count, rounded) or manual (1–20)
- **Frame selection:** include all, every Nth, or manual pick/deselect
- **Annotations per frame:** frame number (on/off), timestamp (on/off), custom text label
- **Padding:** spacing between frames in pixels (0–20, default 4)
- **Background:** white, black, transparent, or custom color
- **Border:** optional 1px border around each frame
- **Output format:** PNG (default), JPEG, WebP
- **Max output width:** auto or constrained (useful for paste-into-issue-tracker sizing)

---

## Platform considerations

| Platform | Screen capture | Global shortcuts | Drag & drop | Notes |
|---|---|---|---|---|
| Windows 10/11 | ✅ | ✅ | ✅ | No special permissions needed; don't run app as admin or drag-drop breaks |
| macOS | ✅ | ✅ | ✅ | Requires Screen Recording permission grant on first use |
| Linux (X11) | ✅ | ✅ | ✅ | Full support |
| Linux (Wayland) | ⚠️ | ❌ | ✅ | scap supports Wayland via PipeWire; global shortcuts not yet supported by the Tauri plugin |

---

## Risks and mitigations

**Performance with high FPS + large regions.** Full-screen 60 FPS capture produces ~7.5 GB/min of raw BGRA data at 1080p. Mitigation: default to 5 FPS for the bug-reproduction use case; cap at 30 FPS; stream frames to a temp directory instead of holding in memory.

**GIF file size.** Long recordings at high resolution produce enormous GIFs. Mitigation: auto-warn when estimated file size exceeds 10MB; suggest reducing FPS, resolution, or duration; offer to trim before encoding.

**Wayland global shortcuts.** The `tauri-plugin-global-shortcut` doesn't support Wayland yet. Mitigation: fall back to an in-app button for start/stop; document the limitation.

**Color quantization.** GIF is limited to 256 colors per frame. Screen recordings of colorful UIs can look bad. Mitigation: use `gifski` which does cross-frame palette optimization; for the sprite sheet output (PNG), use the raw captured frames instead of re-extracting from the GIF.

---

## Out of scope (v1)

- Video export (MP4, WebM) — GIF-only for now
- Audio capture
- Annotation drawing tools (arrows, circles on frames) — text labels only in v1
- Cloud upload / sharing links
- Multi-monitor simultaneous capture
- Webcam overlay

---

## Build phases

### Phase 1: Core capture + sprite sheet (2–3 weeks)

- Tauri 2 project scaffolding with React frontend
- Implement `scap`-based screen capture with start/stop via Tauri commands
- GIF encoding with `gif` crate
- GIF decoding + sprite sheet composition with `image` crate
- Basic UI: record button, FPS selector, preview, grid configuration, export
- Drag-and-drop GIF import

### Phase 2: Region selection + polish (1–2 weeks)

- Transparent overlay window for region selection
- Global shortcut registration (start/stop/new recording)
- Frame number and timestamp annotations on sprite sheet
- Copy-to-clipboard support
- System tray recording indicator

### Phase 3: Quality of life (1 week)

- Frame picker: deselect individual frames before generating the sheet
- Recording history: list of recent recordings with thumbnails
- Settings persistence (default FPS, grid columns, output format, hotkeys)
- `gifski` integration for higher-quality GIF output
- Auto-update via `tauri-plugin-updater`
