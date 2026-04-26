# Changelog

## [0.1.0] — 2026-04-26

First public release.

### Recording
- Full-screen or region capture — drag to select any area, or snap to a detected window
- Configurable FPS with presets (2 / 5 / 10 / 15 / 30) and a custom input
- Optional microphone audio capture, muxed into MP4 and WebM exports
- Countdown timer (0–10 s) before capture starts
- Cursor overlay re-drawn on top of all edits so it stays sharp through export
- Click indicators — animated ripple rings baked into output (left = amber, right = red, middle = purple)
- Key press display — recent keystrokes shown as on-screen chips (e.g. `Ctrl+S`)

### Frame Editor
- Annotation tools: arrows, rectangles, ellipses, freehand lines, text labels
- Blur — drag a region to apply Gaussian blur (radius 2–40 px) for privacy redaction
- Simplify — detects text blocks and replaces them with solid rounded shapes; tunable block size, sensitivity, merge gap, and roundness
- Image upload — insert a PNG/JPG onto a frame; drag corners to resize, click and drag to reposition
- Blur and simplify operate on the fully composited frame (including image overlays), not just the raw source
- Undo (`Ctrl+Z`) removes the last edit on the current frame
- Copy-to-all-frames — apply the current frame's annotations to every frame at once
- Spotlight vignette — apply a focus circle to individual frames in the editor; radius and dim opacity are configurable

### Frames (Grid View)
- Thumbnail overview of all frames
- Multi-select with click, `Ctrl+click`, and `Shift+click`; `Delete` removes selected frames
- Double-click a thumbnail to jump to the frame editor
- Right-click context menu with **Properties** and **Delete** actions
- Per-frame hold time in Properties — add extra duration so one frame lingers longer in exports
- Ctrl+scroll to zoom the thumbnail grid
- Deleted frames are recoverable via **Restore**
- Insert blank frame with the **+** button
- Sheet settings toolbar: columns, padding, border width slider, background colour, and frame annotations (number / timestamp) — all update the live preview instantly
- Back button navigates to the Player

### Player
- Scrubber with drag-to-seek; handles non-contiguous frame indices correctly after deletions and insertions
- Loop / boomerang / play-once modes
- Speed control — 0.25× to 4× playback multiplier
- Loop, playback mode, and speed persist when navigating between views
- Trim — set in/out points with `I` / `O` keys or by dragging the scrubber handles

### Spotlight
- Soft vignette dim outside a configurable radius centred on the cursor
- Configurable radius (0–200 px) and dim opacity
- Baked into GIF, MP4, WebM, and sprite sheet exports

### Export
| Format | Notes |
|--------|-------|
| **Animated GIF** | Standard encoder; high-quality option via gifski (AGPL opt-in, see README) |
| **MP4** | H.264 + AAC via WebCodecs |
| **WebM** | VP9 + Opus via WebCodecs |
| **Sprite sheet** | PNG / JPEG / WebP; configurable columns, padding, borders, annotations |

- Per-frame hold time honoured in all video and GIF exports
- Drag exported GIF or sprite sheet directly into Slack, Discord, or a browser upload field
- Save dialog with configurable default output folder

### UI
- Light / dark / system theme
- Compact mode — small always-on-top window, toggleable from Settings
- Recent recordings panel — last 20 recordings and imported GIFs with thumbnails
- Global nav: Home → Player → Frames → Editor → Preview
- Windows 11-style context menu spacing and transitions
- Region selection indicator hidden before backdrop screenshots to prevent it appearing in captures
