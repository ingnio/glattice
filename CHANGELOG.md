# Changelog

## [Unreleased]

### Scrolling screenshot
- New **Scrolling screenshot** mode on the Record button's chevron: pick the area that scrolls, scroll it, and press **Done** to get one tall picture of everything that passed through
- A header or footer that stays put while the page scrolls is kept once, at the top and bottom
- The strip shows how tall the picture has become; it opens in the editor, which shows tall pictures at full width and scrolls
- Glattice says so if part of the page went by too fast to join up, or if the picture reached its size limit (20,000 pixels tall)

## [0.2.0] — 2026-11-24

### Screenshots
- The Record button has a chevron that switches it between **Record** and **Screenshot**; the choice lasts until changed or the app restarts
- A screenshot is one picture of the screen or the selected region, opened straight in the editor to mark up, copy or export
- `Ctrl+Shift+R` does whichever the button is set to

### Steps
- New **Steps** tab turns a recording into a numbered, step-by-step guide
- Steps come from your recorded clicks, or from numbers placed with the Step number tool
- Each step is a close-up of the frame around the point, with a caption you can edit; steps can be reordered or removed
- Export the guide as one image, a self-contained web page, or Markdown with pictures, or copy it as an image
- Quick clicks and touchpad taps that fell between two checks of the mouse are no longer missed

### Recording
- While recording, Glattice becomes a small always-on-top strip with a timer, Stop and Discard, and stays out of the recording
- The countdown is shown on screen where the recording will happen
- Glattice hides while you select a region, then offers Record, Change region or Reset
- Escape cancels drawing a region and clears a selected one

### Export
- GIF export now includes edits, trim, frame order, click rings, key labels and the cursor
- Exports show progress, then a confirmation with **Show in folder**; errors are explained in plain language
- MP4 and WebM no longer fail or play at the wrong speed after frames are reordered
- Sprite sheets now draw the cursor, click rings and key labels, as the Player does

### Trim
- The trim follows its frames when frames are deleted, restored, inserted or reordered
- A frame dragged past a trim mark drops out of the clip; one dragged between the marks joins it
- Trimmed-off frames are dimmed and tagged in Frames, and can't be opened in the editor

### Frames
- Right-click a frame and choose **Copy image** to put it on the clipboard, with its edits and overlays
- `Ctrl+C` copies the selected frame in Frames, or the current frame in the editor
- The editor has a right-click menu on the frame: Copy image, Export frame, Delete frame
- The editor's frame bar keeps the stepper centred and groups Copy, Export and Delete on the right
- Toolbar buttons are round icon buttons throughout, including Export in the Player and Sheet layout in Frames
- The browser's own right-click menu no longer appears

### Editor
- Box tools (rectangle, ellipse, blur, simplify) move and resize their own boxes without switching to Select
- New **Step number** tool (`N`): each click drops the next numbered marker (1, 2, 3…) for pointing out steps in order
- With the Step tool active, drag an existing number to move it
- Colour, size and blur strength carry forward: restyling an edit sets the style for the next one, across frames and visits to the editor
- Letter keys pick tools; redo added (`Ctrl+Y`)
- An options strip names the active tool and says how to use it

### Interface
- Keyboard shortcut list on `?`
- Home is simpler: the window fits its content, Compact and Settings are icon buttons, and Recent rows show file names
- The Player has a labelled Export menu and a Spotlight switch per recording
- Frames explains its gestures and shows selection clearly; Sheet layout controls are labelled
- Settings are grouped and reworded; the theme switch moved there
- The theme follows your system setting by default, instead of starting in Light
- The window no longer flashes blank at launch
- Home always fits its window: a long Recent list scrolls inside its own card
- In the Player, `Esc` closes an open menu instead of jumping back to Home

### Project
- The installer shows the MIT license; the separate EULA is gone
- Third-party licenses are listed in `THIRD-PARTY-NOTICES.md` and installed with the app
- Added contributor guide, code of conduct, security policy, and automated builds
- The app now runs under a content security policy that only allows its own code and local files

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
