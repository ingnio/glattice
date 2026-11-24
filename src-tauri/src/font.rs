//! Antialiased text drawing for sprite-sheet annotations.
//!
//! Uses an embedded Roboto Mono (monospace, OFL-1.1). Monospace keeps
//! frame numbers and timestamps visually aligned across cells, which
//! matches the "tabular data" feel of the annotation overlays.

use ab_glyph::{Font, FontRef, PxScale, ScaleFont};
use image::{Rgba, RgbaImage};

static FONT_BYTES: &[u8] = include_bytes!("../assets/RobotoMono-Regular.ttf");

fn font() -> FontRef<'static> {
    FontRef::try_from_slice(FONT_BYTES).expect("embedded font must parse")
}

/// Break `text` into lines that each fit within `max_width` source
/// pixels. Respects explicit newlines and keeps whitespace-separated
/// words intact. A single word wider than `max_width` stays on its own
/// line — callers that want hard wrapping mid-word can split upstream.
pub fn wrap_text(text: &str, max_width: f32, px_size: u32) -> Vec<String> {
    let f = font();
    let scaled = f.as_scaled(PxScale::from(px_size as f32));
    let measure = |s: &str| -> f32 {
        s.chars()
            .map(|c| scaled.h_advance(scaled.glyph_id(c)))
            .sum()
    };

    let mut out: Vec<String> = Vec::new();
    for para in text.split('\n') {
        if para.is_empty() {
            out.push(String::new());
            continue;
        }
        // Split keeping whitespace as its own tokens so we preserve
        // inter-word spacing on the same line.
        let mut tokens: Vec<String> = Vec::new();
        let mut cur = String::new();
        let mut in_ws: Option<bool> = None;
        for ch in para.chars() {
            let is_ws = ch.is_whitespace();
            match in_ws {
                Some(prev) if prev == is_ws => cur.push(ch),
                _ => {
                    if !cur.is_empty() {
                        tokens.push(std::mem::take(&mut cur));
                    }
                    cur.push(ch);
                    in_ws = Some(is_ws);
                }
            }
        }
        if !cur.is_empty() {
            tokens.push(cur);
        }

        let mut line = String::new();
        for tok in tokens {
            let candidate = format!("{line}{tok}");
            if measure(&candidate) > max_width && !line.is_empty() {
                out.push(line.trim_end().to_string());
                line = if tok.chars().all(|c| c.is_whitespace()) {
                    String::new()
                } else {
                    tok
                };
            } else {
                line = candidate;
            }
        }
        if !line.is_empty() {
            out.push(line);
        }
    }
    out
}

/// Whether the embedded font can draw `c` (rather than its "missing
/// glyph" box).
pub fn has_glyph(c: char) -> bool {
    font().glyph_id(c).0 != 0
}

/// Width/height occupied by `text` at the given pixel size. Returned
/// values are integers (ceiling-rounded) so callers positioning text
/// inside a cell don't need to worry about subpixels.
pub fn text_dimensions(text: &str, px_size: u32) -> (u32, u32) {
    let f = font();
    let scaled = f.as_scaled(PxScale::from(px_size as f32));
    let advance: f32 = text
        .chars()
        .map(|c| scaled.h_advance(scaled.glyph_id(c)))
        .sum();
    let height = scaled.ascent() - scaled.descent();
    (advance.ceil() as u32, height.ceil() as u32)
}

/// Render `text` into `img` with its top-left at (x, y). Supports
/// antialiasing — partial coverage blends into the destination RGBA
/// with over-compositing.
pub fn draw_text(img: &mut RgbaImage, x: i32, y: i32, text: &str, color: Rgba<u8>, px_size: u32) {
    let f = font();
    let scaled = f.as_scaled(PxScale::from(px_size as f32));
    let (img_w, img_h) = img.dimensions();
    let ascent = scaled.ascent();

    let mut cursor_x: f32 = x as f32;
    let baseline_y: f32 = y as f32 + ascent;

    for c in text.chars() {
        let glyph_id = scaled.glyph_id(c);
        let advance = scaled.h_advance(glyph_id);
        let glyph = glyph_id.with_scale_and_position(
            PxScale::from(px_size as f32),
            ab_glyph::point(cursor_x, baseline_y),
        );
        if let Some(outlined) = f.outline_glyph(glyph) {
            let bounds = outlined.px_bounds();
            outlined.draw(|gx, gy, coverage| {
                if coverage <= 0.0 {
                    return;
                }
                let px = bounds.min.x as i32 + gx as i32;
                let py = bounds.min.y as i32 + gy as i32;
                if px < 0 || py < 0 {
                    return;
                }
                let (upx, upy) = (px as u32, py as u32);
                if upx >= img_w || upy >= img_h {
                    return;
                }
                blend_over(img.get_pixel_mut(upx, upy), color, coverage);
            });
        }
        cursor_x += advance;
    }
}

/// Draw `text` with a thin outline underneath in `shadow` colour so
/// it stays readable over any background. The outline is drawn by
/// painting the text four times around the final centered glyph.
pub fn draw_text_shadowed(
    img: &mut RgbaImage,
    x: i32,
    y: i32,
    text: &str,
    color: Rgba<u8>,
    shadow: Rgba<u8>,
    px_size: u32,
) {
    let o = 1i32.max(px_size as i32 / 16);
    for (dx, dy) in [
        (-o, 0),
        (o, 0),
        (0, -o),
        (0, o),
        (-o, -o),
        (o, -o),
        (-o, o),
        (o, o),
    ] {
        draw_text(img, x + dx, y + dy, text, shadow, px_size);
    }
    draw_text(img, x, y, text, color, px_size);
}

fn blend_over(px: &mut Rgba<u8>, src: Rgba<u8>, coverage: f32) {
    let a = (src.0[3] as f32 / 255.0) * coverage.clamp(0.0, 1.0);
    if a <= 0.0 {
        return;
    }
    let dst_a = px.0[3] as f32 / 255.0;
    let out_a = a + dst_a * (1.0 - a);
    if out_a <= 0.0 {
        return;
    }
    let mix = |s: u8, d: u8| -> u8 {
        let sf = s as f32 / 255.0;
        let df = d as f32 / 255.0;
        let v = (sf * a + df * dst_a * (1.0 - a)) / out_a;
        (v * 255.0).round().clamp(0.0, 255.0) as u8
    };
    px.0[0] = mix(src.0[0], px.0[0]);
    px.0[1] = mix(src.0[1], px.0[1]);
    px.0[2] = mix(src.0[2], px.0[2]);
    px.0[3] = (out_a * 255.0).round().clamp(0.0, 255.0) as u8;
}
