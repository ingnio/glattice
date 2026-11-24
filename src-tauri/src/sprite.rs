use image::{
    imageops::{self, FilterType},
    codecs::{jpeg::JpegEncoder, png::PngEncoder, webp::WebPEncoder},
    ColorType, ImageEncoder, Rgba, RgbaImage,
};
use rayon::prelude::*;
use serde::Deserialize;
use std::io::Cursor;

use std::collections::HashMap;

use crate::{
    capture::Recording,
    cursor,
    edits::Edit,
    error::{AppError, AppResult},
    font, overlays,
};

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SheetConfig {
    /// Explicit column count (1..=20). None -> auto (ceil(sqrt(n))).
    pub columns: Option<u32>,
    /// Include every Nth frame. 1 = all, 2 = every other, etc.
    #[serde(default = "default_stride")]
    pub frame_stride: u32,
    /// Pixels of padding between frames and around the edge.
    #[serde(default = "default_padding")]
    pub padding: u32,
    /// Background RGBA color.
    #[serde(default = "default_bg")]
    pub background: [u8; 4],
    /// Border width in source pixels. 0 = no border.
    #[serde(default)]
    pub border_width: u32,
    #[serde(default = "default_border_color")]
    pub border_color: [u8; 4],
    /// Output format: "png" | "jpeg" | "webp".
    #[serde(default = "default_format")]
    pub format: String,
    /// Constrain the total sprite-sheet width by scaling frames down.
    pub max_width: Option<u32>,
    /// Draw the frame number in a corner of each cell.
    #[serde(default)]
    pub show_frame_number: bool,
    /// Draw the elapsed-time stamp in a corner of each cell.
    #[serde(default)]
    pub show_timestamp: bool,
    /// Where annotations land within each cell.
    #[serde(default = "default_annotation_position")]
    pub annotation_position: String,
    /// Explicit list of frame indices to include. When set, overrides
    /// `frame_stride`.
    pub selected_indices: Option<Vec<u32>>,
    /// Per-frame edits keyed by original frame index. Baked onto each
    /// frame at full source resolution, before any downscaling.
    pub edits: Option<HashMap<u32, Vec<Edit>>>,
    /// Spotlight vignette. When present, frames without a cursor position
    /// are left unaffected; frames with a cursor get a dim overlay outside
    /// the given radius. Applied after edits + cursor, before resize.
    pub spotlight: Option<SpotlightConfig>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SpotlightConfig {
    pub radius: f32,
    pub dim_opacity: f32,
}

fn default_annotation_position() -> String {
    "top-left".into()
}

fn default_stride() -> u32 {
    1
}
fn default_padding() -> u32 {
    4
}
fn default_bg() -> [u8; 4] {
    [255, 255, 255, 255]
}
fn default_border_color() -> [u8; 4] {
    [200, 200, 200, 255]
}
fn default_format() -> String {
    "png".into()
}

pub struct SheetOutput {
    pub bytes: Vec<u8>,
    pub mime: &'static str,
    pub ext: &'static str,
    pub width: u32,
    pub height: u32,
    pub frame_count: u32,
    pub columns: u32,
    pub rows: u32,
}

pub fn compose(recording: &Recording, config: &SheetConfig) -> AppResult<SheetOutput> {
    if recording.frames.is_empty() {
        return Err(AppError::NoFrames);
    }
    let stride = config.frame_stride.max(1);

    // Frame selection: an explicit index list wins; otherwise apply
    // the stride. Indices that fall outside the recording are ignored.
    let (selected, original_indices): (Vec<&_>, Vec<u32>) =
        if let Some(indices) = &config.selected_indices {
            // Preserve the caller's order — this is what makes drag-to-reorder
            // work for sprite sheets. Deduplicate while keeping first occurrence.
            let mut seen = std::collections::HashSet::new();
            let pairs: Vec<(u32, &_)> = indices
                .iter()
                .filter_map(|&i| {
                    if seen.insert(i) {
                        recording.frames.get(i as usize).map(|f| (i, f))
                    } else {
                        None
                    }
                })
                .collect();
            let (idxs, frames): (Vec<_>, Vec<_>) =
                pairs.into_iter().map(|(i, f)| (i, f)).unzip();
            (frames, idxs)
        } else {
            let mut idxs = Vec::new();
            let mut frames = Vec::new();
            for (i, f) in recording.frames.iter().enumerate() {
                if i % stride as usize == 0 {
                    idxs.push(i as u32);
                    frames.push(f);
                }
            }
            (frames, idxs)
        };

    if selected.is_empty() {
        return Err(AppError::NoFrames);
    }

    let n = selected.len() as u32;
    let cols = match config.columns {
        Some(c) if (1..=20).contains(&c) => c,
        Some(c) => {
            return Err(AppError::InvalidConfig(format!(
                "columns must be between 1 and 20, got {c}"
            )));
        }
        None => ((n as f32).sqrt().ceil() as u32).max(1),
    };
    let rows = (n + cols - 1) / cols;

    let src_w = selected[0].width;
    let src_h = selected[0].height;
    if src_w == 0 || src_h == 0 {
        return Err(AppError::InvalidConfig("frames have zero dimension".into()));
    }

    let pad = config.padding;

    // If max_width is set, scale frames down proportionally so total
    // output width <= max_width. We never scale up.
    let (frame_w, frame_h) = match config.max_width {
        Some(max_w) if max_w > 0 => {
            let total_unscaled = cols * src_w + (cols + 1) * pad;
            if total_unscaled <= max_w {
                (src_w, src_h)
            } else {
                let available_per_frame =
                    (max_w.saturating_sub((cols + 1) * pad)) / cols;
                let scale = available_per_frame as f32 / src_w as f32;
                let fw = (src_w as f32 * scale).floor().max(1.0) as u32;
                let fh = (src_h as f32 * scale).floor().max(1.0) as u32;
                (fw, fh)
            }
        }
        _ => (src_w, src_h),
    };

    let out_w = cols * frame_w + (cols + 1) * pad;
    let out_h = rows * frame_h + (rows + 1) * pad;

    let bg = Rgba(config.background);
    let mut canvas = RgbaImage::from_pixel(out_w, out_h, bg);

    // Resize is the hot path (Lanczos3 on full-res frames). It's
    // per-frame independent, so fan out with rayon; the sequential
    // overlay/border/annotation pass afterward is cheap.
    //
    // Per-frame vector edits get baked in BEFORE the downscale so the
    // strokes stay crisp at the final sheet resolution. Coordinates
    // are in source-pixel space (same as the full-res frame).
    let edits_map = config.edits.as_ref();
    let input_events = &recording.input_events;
    let resized: Vec<AppResult<RgbaImage>> = selected
        .par_iter()
        .zip(original_indices.par_iter())
        .map(|(frame, &orig_idx)| -> AppResult<RgbaImage> {
            let mut img =
                RgbaImage::from_raw(frame.width, frame.height, frame.rgba.clone())
                    .ok_or_else(|| {
                        AppError::InvalidConfig("frame pixel buffer size mismatch".into())
                    })?;
            if let Some(list) = edits_map.and_then(|map| map.get(&orig_idx)) {
                if !list.is_empty() {
                    crate::edits::apply_edits(&mut img, list);
                }
            }
            // The cursor, click rings and key labels go on after the
            // edits, in the same order the Player and the Frames grid
            // draw them, so a sheet shows what those views show and no
            // edit (a simplify pill, a blur) can bury them. This runs
            // for every frame, edited or not: an "overlay" cursor only
            // exists as a position until something draws it. For
            // recordings with the cursor baked in, it repaints the same
            // pixels.
            if let Some((cx, cy)) = frame.cursor {
                cursor::draw(img.as_mut(), frame.width, frame.height, cx, cy);
            }
            if !input_events.is_empty() {
                overlays::draw_clicks(&mut img, input_events, frame.elapsed_ms);
                overlays::draw_keys(&mut img, input_events, frame.elapsed_ms);
            }
            // Spotlight is applied after all edits + cursor overlay so the
            // dim vignette sits on top of everything, just like the canvas
            // version. Only applied when the frame has cursor data.
            if let (Some(sp), Some((cx, cy))) = (&config.spotlight, frame.cursor) {
                apply_spotlight(&mut img, cx as f32, cy as f32, sp.radius, sp.dim_opacity);
            }
            Ok(if frame.width == frame_w && frame.height == frame_h {
                img
            } else {
                imageops::resize(&img, frame_w, frame_h, FilterType::Lanczos3)
            })
        })
        .collect();

    for (idx, sized_res) in resized.into_iter().enumerate() {
        let sized = sized_res?;
        let frame = selected[idx];
        let col = idx as u32 % cols;
        let row = idx as u32 / cols;
        let x = pad + col * (frame_w + pad);
        let y = pad + row * (frame_h + pad);

        imageops::overlay(&mut canvas, &sized, x as i64, y as i64);

        if config.border_width > 0 {
            draw_rect_border(&mut canvas, x, y, frame_w, frame_h, config.border_color, config.border_width);
        }

        if config.show_frame_number || config.show_timestamp {
            let original_index = original_indices[idx];
            let label = annotation_label(
                original_index,
                frame.elapsed_ms,
                config.show_frame_number,
                config.show_timestamp,
            );
            if !label.is_empty() {
                draw_cell_annotation(
                    &mut canvas,
                    x,
                    y,
                    frame_w,
                    frame_h,
                    &label,
                    &config.annotation_position,
                );
            }
        }
    }

    let (bytes, mime, ext) = encode(&canvas, &config.format)?;
    Ok(SheetOutput {
        bytes,
        mime,
        ext,
        width: out_w,
        height: out_h,
        frame_count: n,
        columns: cols,
        rows,
    })
}

/// Overlay a spotlight vignette centred at `(cx, cy)`. Pixels outside
/// the soft-edged circle are darkened by `dim_opacity`. The transition
/// is feathered over ±25 % of the radius for a smooth falloff.
fn apply_spotlight(img: &mut RgbaImage, cx: f32, cy: f32, radius: f32, dim_opacity: f32) {
    let feather = radius * 0.25;
    let inner_r = (radius - feather).max(0.0);
    let outer_r = radius + feather * 0.5;
    let inner_r2 = inner_r * inner_r;
    let outer_r2 = outer_r * outer_r;
    let range = outer_r - inner_r;

    for y in 0..img.height() {
        for x in 0..img.width() {
            let dx = x as f32 - cx;
            let dy = y as f32 - cy;
            let dist2 = dx * dx + dy * dy;
            if dist2 <= inner_r2 {
                continue; // fully inside the spotlight
            }
            let alpha = if dist2 >= outer_r2 {
                dim_opacity
            } else {
                let dist = dist2.sqrt();
                let t = (dist - inner_r) / range;
                dim_opacity * t
            };
            if alpha <= 0.0 {
                continue;
            }
            let px = img.get_pixel(x, y);
            let [r, g, b, a] = px.0;
            let keep = 1.0 - alpha;
            img.put_pixel(
                x,
                y,
                Rgba([
                    (r as f32 * keep).round() as u8,
                    (g as f32 * keep).round() as u8,
                    (b as f32 * keep).round() as u8,
                    a,
                ]),
            );
        }
    }
}

fn draw_rect_border(img: &mut RgbaImage, x: u32, y: u32, w: u32, h: u32, color: [u8; 4], width: u32) {
    if w == 0 || h == 0 || width == 0 {
        return;
    }
    let c = Rgba(color);
    let (iw, ih) = img.dimensions();
    let max_inset = (w / 2).min(h / 2);
    for i in 0..width.min(max_inset) {
        let bx = x + i;
        let by = y + i;
        let bw = w.saturating_sub(i * 2);
        let bh = h.saturating_sub(i * 2);
        if bw == 0 || bh == 0 { break; }
        for dx in 0..bw {
            if bx + dx < iw {
                if by < ih { img.put_pixel(bx + dx, by, c); }
                let yb = by + bh.saturating_sub(1);
                if yb < ih && yb != by { img.put_pixel(bx + dx, yb, c); }
            }
        }
        for dy in 1..bh.saturating_sub(1) {
            let py = by + dy;
            if py < ih {
                if bx < iw { img.put_pixel(bx, py, c); }
                let xr = bx + bw.saturating_sub(1);
                if xr < iw && xr != bx { img.put_pixel(xr, py, c); }
            }
        }
    }
}

fn encode(canvas: &RgbaImage, format: &str) -> AppResult<(Vec<u8>, &'static str, &'static str)> {
    let (w, h) = canvas.dimensions();
    let mut buf: Vec<u8> = Vec::new();

    match format.to_ascii_lowercase().as_str() {
        "png" => {
            PngEncoder::new(&mut buf).write_image(canvas.as_raw(), w, h, ColorType::Rgba8.into())?;
            Ok((buf, "image/png", "png"))
        }
        "jpeg" | "jpg" => {
            // JPEG has no alpha channel; composite onto solid white.
            let rgb = flatten_alpha_to_rgb(canvas, [255, 255, 255]);
            JpegEncoder::new_with_quality(&mut buf, 90)
                .write_image(&rgb, w, h, ColorType::Rgb8.into())?;
            Ok((buf, "image/jpeg", "jpg"))
        }
        "webp" => {
            let mut cursor = Cursor::new(&mut buf);
            WebPEncoder::new_lossless(&mut cursor).write_image(
                canvas.as_raw(),
                w,
                h,
                ColorType::Rgba8.into(),
            )?;
            Ok((buf, "image/webp", "webp"))
        }
        other => Err(AppError::InvalidConfig(format!(
            "unsupported output format '{other}' (expected png|jpeg|webp)"
        ))),
    }
}

fn annotation_label(index: u32, elapsed_ms: u32, show_num: bool, show_time: bool) -> String {
    let num_part = if show_num {
        format!("f{}", index + 1)
    } else {
        String::new()
    };
    let time_part = if show_time {
        let total_cs = elapsed_ms / 10;
        let seconds = total_cs / 100;
        let cs = total_cs % 100;
        format!("{seconds}.{cs:02}s")
    } else {
        String::new()
    };
    match (num_part.is_empty(), time_part.is_empty()) {
        (false, false) => format!("{num_part} {time_part}"),
        (false, true) => num_part,
        (true, false) => time_part,
        _ => String::new(),
    }
}

fn draw_cell_annotation(
    img: &mut RgbaImage,
    cell_x: u32,
    cell_y: u32,
    cell_w: u32,
    cell_h: u32,
    text: &str,
    position: &str,
) {
    let px_size = pick_annotation_px_size(cell_w);
    if px_size == 0 {
        return;
    }
    let (tw, th) = font::text_dimensions(text, px_size);
    let margin = (px_size / 4).max(3);
    let (tx, ty) = match position {
        "top-right" => (
            cell_x + cell_w.saturating_sub(tw + margin),
            cell_y + margin,
        ),
        "bottom-left" => (cell_x + margin, cell_y + cell_h.saturating_sub(th + margin)),
        "bottom-right" => (
            cell_x + cell_w.saturating_sub(tw + margin),
            cell_y + cell_h.saturating_sub(th + margin),
        ),
        _ => (cell_x + margin, cell_y + margin),
    };
    font::draw_text_shadowed(
        img,
        tx as i32,
        ty as i32,
        text,
        Rgba([255, 255, 255, 255]),
        Rgba([0, 0, 0, 210]),
        px_size,
    );
}

fn pick_annotation_px_size(cell_w: u32) -> u32 {
    // Font size in px at the cell's resolution. Scales with cell
    // width so small cells get a small label and big cells get big
    // readable text.
    if cell_w >= 800 {
        44
    } else if cell_w >= 500 {
        32
    } else if cell_w >= 300 {
        22
    } else if cell_w >= 160 {
        16
    } else if cell_w >= 80 {
        12
    } else {
        0
    }
}

fn flatten_alpha_to_rgb(img: &RgbaImage, bg: [u8; 3]) -> Vec<u8> {
    let mut out = Vec::with_capacity((img.width() * img.height() * 3) as usize);
    for px in img.pixels() {
        let [r, g, b, a] = px.0;
        let af = a as f32 / 255.0;
        let mix = |c: u8, bc: u8| -> u8 {
            (c as f32 * af + bc as f32 * (1.0 - af)).round().clamp(0.0, 255.0) as u8
        };
        out.push(mix(r, bg[0]));
        out.push(mix(g, bg[1]));
        out.push(mix(b, bg[2]));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capture::CapturedFrame;
    use crate::input::{InputEvent, KeyModifiers, MouseButton};

    const GREY: [u8; 4] = [120, 120, 120, 255];
    const CELL_W: u32 = 200;
    const CELL_H: u32 = 120;

    fn frame(elapsed_ms: u32, cursor: Option<(i32, i32)>) -> CapturedFrame {
        CapturedFrame {
            width: CELL_W,
            height: CELL_H,
            rgba: GREY.repeat((CELL_W * CELL_H) as usize),
            elapsed_ms,
            cursor,
        }
    }

    /// Compose the frames side by side with no padding and decode the
    /// sheet, so cell N covers x = N * 200 .. N * 200 + 200.
    ///
    /// Set GLATTICE_SHEET_DIR to a folder to also save each sheet there
    /// as `<name>.png`.
    fn compose_one_row(
        name: &str,
        frames: Vec<CapturedFrame>,
        input_events: Vec<InputEvent>,
    ) -> RgbaImage {
        let columns = frames.len();
        let recording = Recording {
            fps: 10,
            frames,
            input_events,
            audio: None,
            cursor_baked: false,
        };
        let config: SheetConfig =
            serde_json::from_str(&format!(r#"{{ "padding": 0, "columns": {columns} }}"#))
                .expect("sheet config");
        let sheet = compose(&recording, &config).expect("compose sheet");
        let img = image::load_from_memory(&sheet.bytes)
            .expect("decode sheet")
            .to_rgba8();
        if let Ok(dir) = std::env::var("GLATTICE_SHEET_DIR") {
            img.save(std::path::Path::new(&dir).join(format!("{name}.png")))
                .expect("write sheet preview");
        }
        img
    }

    #[test]
    fn the_overlay_cursor_is_drawn_on_frames_that_have_no_edits() {
        let sheet = compose_one_row(
            "sheet-cursor",
            vec![frame(0, Some((30, 40))), frame(100, None)],
            vec![],
        );

        // The arrow's hotspot is its white outline; its body is black.
        assert_eq!(sheet.get_pixel(30, 40).0, [255, 255, 255, 255]);
        assert_eq!(sheet.get_pixel(31, 42).0, [0, 0, 0, 255]);
        // A frame with no cursor position is left alone.
        assert_eq!(sheet.get_pixel(CELL_W + 30, 40).0, GREY);
        assert_eq!(sheet.get_pixel(CELL_W + 31, 42).0, GREY);
    }

    #[test]
    fn a_click_ring_shows_on_the_frames_just_after_the_click() {
        let click = InputEvent::Click {
            timestamp_ms: 50,
            x: 100,
            y: 60,
            button: MouseButton::Left,
        };
        let sheet = compose_one_row(
            "sheet-click",
            vec![frame(0, None), frame(100, None)],
            vec![click],
        );

        // The frame captured before the click has nothing on it.
        assert_eq!(sheet.get_pixel(100, 60).0, GREY);
        // The one 50 ms after it has the amber dot at the click point.
        let dot = sheet.get_pixel(CELL_W + 100, 60).0;
        assert!(
            dot[0] > 220 && dot[1] > 170 && dot[2] < 80,
            "amber dot, got {dot:?}"
        );
    }

    #[test]
    fn a_key_label_shows_on_the_frames_just_after_the_press() {
        let key = InputEvent::Key {
            timestamp_ms: 400,
            label: "S".into(),
            modifiers: KeyModifiers {
                ctrl: true,
                ..Default::default()
            },
        };
        let sheet = compose_one_row(
            "sheet-key",
            vec![frame(0, None), frame(500, None)],
            vec![key],
        );

        // The label is a dark pill in the bottom-left corner of the cell:
        // 5 px in from the left, its bottom edge 5 px up from the bottom.
        assert_eq!(sheet.get_pixel(8, 102).0, GREY, "pressed after this frame");
        let pill = sheet.get_pixel(CELL_W + 8, 102).0;
        assert!(pill[0] < 90, "dark pill on the next frame, got {pill:?}");
    }

    #[test]
    fn a_step_marker_is_a_filled_circle_with_its_number() {
        // Size 4 gives a radius of 20 px (8 + 4 * 3), centred at (100, 60).
        let step: Edit = serde_json::from_str(
            r#"{ "kind": "step", "x": 100, "y": 60, "n": 7,
                 "color": [239, 68, 68, 255], "thickness": 4 }"#,
        )
        .expect("step edit");
        let recording = Recording {
            fps: 10,
            frames: vec![frame(0, None)],
            input_events: vec![],
            audio: None,
            cursor_baked: false,
        };
        let mut config: SheetConfig =
            serde_json::from_str(r#"{ "padding": 0, "columns": 1 }"#).expect("sheet config");
        config.edits = Some(HashMap::from([(0, vec![step])]));
        let sheet = compose(&recording, &config).expect("compose sheet");
        let img = image::load_from_memory(&sheet.bytes)
            .expect("decode sheet")
            .to_rgba8();
        if let Ok(dir) = std::env::var("GLATTICE_SHEET_DIR") {
            img.save(std::path::Path::new(&dir).join("sheet-step.png"))
                .expect("write sheet preview");
        }

        // Inside the circle but clear of the digit: the fill colour.
        assert_eq!(img.get_pixel(100 - 15, 60).0, [239, 68, 68, 255]);
        assert_eq!(img.get_pixel(100, 60 + 16).0, [239, 68, 68, 255]);
        // Outside the circle the frame is untouched.
        assert_eq!(img.get_pixel(100 + 26, 60).0, GREY);
        // The number is drawn in white somewhere near the centre.
        let white = (88..112).any(|x| (48..72).any(|y| img.get_pixel(x, y).0 == [255, 255, 255, 255]));
        assert!(white, "the step's number should be drawn in white");
    }

    #[test]
    fn overlays_sit_on_top_of_a_frame_s_edits() {
        // A filled rectangle covering the whole frame would bury anything
        // drawn before it; the cursor and the click must still show.
        let cover: Edit = serde_json::from_str(
            r#"{ "kind": "rect", "x": 0, "y": 0, "w": 200, "h": 120,
                 "color": [37, 99, 235, 255], "thickness": 2, "fill": true }"#,
        )
        .expect("rect edit");
        let recording = Recording {
            fps: 10,
            frames: vec![frame(100, Some((30, 40)))],
            input_events: vec![InputEvent::Click {
                timestamp_ms: 50,
                x: 100,
                y: 60,
                button: MouseButton::Left,
            }],
            audio: None,
            cursor_baked: false,
        };
        let mut config: SheetConfig =
            serde_json::from_str(r#"{ "padding": 0, "columns": 1 }"#).expect("sheet config");
        config.edits = Some(HashMap::from([(0, vec![cover])]));

        let sheet = compose(&recording, &config).expect("compose sheet");
        let img = image::load_from_memory(&sheet.bytes)
            .expect("decode sheet")
            .to_rgba8();

        // The edit really did repaint the frame...
        assert_ne!(img.get_pixel(180, 20).0, GREY);
        // ...and the cursor and the click dot are on top of it.
        assert_eq!(img.get_pixel(30, 40).0, [255, 255, 255, 255]);
        let dot = img.get_pixel(100, 60).0;
        assert!(
            dot[0] > 220 && dot[1] > 170 && dot[2] < 80,
            "amber dot, got {dot:?}"
        );
    }
}
