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
    font,
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
    /// Optional 1px border drawn around each frame (uses border_color).
    #[serde(default)]
    pub border: bool,
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
    let resized: Vec<AppResult<RgbaImage>> = selected
        .par_iter()
        .zip(original_indices.par_iter())
        .map(|(frame, &orig_idx)| -> AppResult<RgbaImage> {
            let mut img =
                RgbaImage::from_raw(frame.width, frame.height, frame.rgba.clone())
                    .ok_or_else(|| {
                        AppError::InvalidConfig("frame pixel buffer size mismatch".into())
                    })?;
            if let Some(map) = edits_map {
                if let Some(list) = map.get(&orig_idx) {
                    if !list.is_empty() {
                        crate::edits::apply_edits(&mut img, list);
                        // Re-overlay the cursor on top of any edits so
                        // simplify pills (or any other edit covering the
                        // cursor's pixels) can't bury it.
                        if let Some((cx, cy)) = frame.cursor {
                            cursor::draw(
                                img.as_mut(),
                                frame.width,
                                frame.height,
                                cx,
                                cy,
                            );
                        }
                    }
                }
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

        if config.border {
            draw_rect_border(&mut canvas, x, y, frame_w, frame_h, config.border_color);
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

fn draw_rect_border(img: &mut RgbaImage, x: u32, y: u32, w: u32, h: u32, color: [u8; 4]) {
    let c = Rgba(color);
    let (iw, ih) = img.dimensions();
    if w == 0 || h == 0 {
        return;
    }
    for dx in 0..w {
        let px = x + dx;
        if px < iw {
            if y < ih {
                img.put_pixel(px, y, c);
            }
            let yb = y + h.saturating_sub(1);
            if yb < ih {
                img.put_pixel(px, yb, c);
            }
        }
    }
    for dy in 0..h {
        let py = y + dy;
        if py < ih {
            if x < iw {
                img.put_pixel(x, py, c);
            }
            let xr = x + w.saturating_sub(1);
            if xr < iw {
                img.put_pixel(xr, py, c);
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
