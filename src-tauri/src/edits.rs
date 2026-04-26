//! Vector edit compositing for per-frame annotations. The frontend
//! draws these onto a canvas overlay for preview; at sprite-sheet
//! export we bake them into the full-res frame here.
//!
//! All coordinates + sizes are in SOURCE-image (frame) pixels.

use image::{imageops, Rgba, RgbaImage};
use serde::Deserialize;

use crate::font;

/// A single vector edit. Mirrors the TypeScript `Edit` union.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Edit {
    #[serde(rename_all = "camelCase")]
    Rect {
        x: f32,
        y: f32,
        w: f32,
        h: f32,
        color: [u8; 4],
        thickness: f32,
        fill: bool,
    },
    #[serde(rename_all = "camelCase")]
    Ellipse {
        x: f32,
        y: f32,
        w: f32,
        h: f32,
        color: [u8; 4],
        thickness: f32,
        fill: bool,
    },
    #[serde(rename_all = "camelCase")]
    Arrow {
        x1: f32,
        y1: f32,
        x2: f32,
        y2: f32,
        color: [u8; 4],
        thickness: f32,
    },
    #[serde(rename_all = "camelCase")]
    Freehand {
        points: Vec<[f32; 2]>,
        color: [u8; 4],
        thickness: f32,
    },
    #[serde(rename_all = "camelCase")]
    Text {
        x: f32,
        y: f32,
        w: f32,
        h: f32,
        text: String,
        color: [u8; 4],
        #[serde(rename = "sizePx")]
        size_px: f32,
    },
    #[serde(rename_all = "camelCase")]
    Blur {
        x: f32,
        y: f32,
        w: f32,
        h: f32,
        radius: f32,
    },
    #[serde(rename_all = "camelCase")]
    Simplify {
        x: f32,
        y: f32,
        w: f32,
        h: f32,
        #[serde(default)]
        block_size: Option<u32>,
        #[serde(default)]
        threshold: Option<u32>,
        #[serde(default)]
        merge: Option<u32>,
        #[serde(default)]
        padding: Option<f32>,
        #[serde(default)]
        roundness: Option<u32>,
    },
}

pub fn apply_edits(img: &mut RgbaImage, edits: &[Edit]) {
    for e in edits {
        apply_edit(img, e);
    }
}

fn apply_edit(img: &mut RgbaImage, edit: &Edit) {
    match edit {
        Edit::Rect {
            x,
            y,
            w,
            h,
            color,
            thickness,
            fill,
        } => {
            if *fill {
                fill_rect(img, *x, *y, *w, *h, *color);
            } else {
                stroke_rect(img, *x, *y, *w, *h, *thickness, *color);
            }
        }
        Edit::Ellipse {
            x,
            y,
            w,
            h,
            color,
            thickness,
            fill,
        } => {
            if *fill {
                fill_ellipse(img, *x, *y, *w, *h, *color);
            } else {
                stroke_ellipse(img, *x, *y, *w, *h, *thickness, *color);
            }
        }
        Edit::Arrow {
            x1,
            y1,
            x2,
            y2,
            color,
            thickness,
        } => {
            draw_arrow(img, *x1, *y1, *x2, *y2, *thickness, *color);
        }
        Edit::Freehand {
            points,
            color,
            thickness,
        } => {
            for pair in points.windows(2) {
                stroke_line(
                    img,
                    pair[0][0],
                    pair[0][1],
                    pair[1][0],
                    pair[1][1],
                    *thickness,
                    *color,
                );
            }
        }
        Edit::Text {
            x,
            y,
            w,
            h,
            text,
            color,
            size_px,
        } => {
            if text.is_empty() || *w <= 0.0 || *h <= 0.0 {
                return;
            }
            let size = size_px.round().max(6.0) as u32;
            let lines = font::wrap_text(text, *w, size);
            let line_h = (size as f32) * 1.2;
            let base_x = x.round() as i32;
            let base_y_start = y.round() as i32;
            let max_y = (*y + *h) as i32;
            let shadow = Rgba([0, 0, 0, (color[3] as f32 * 0.8) as u8]);
            for (i, line) in lines.iter().enumerate() {
                let ly = base_y_start + ((i as f32) * line_h).round() as i32;
                // Clip to the box — any line whose top passes the
                // bottom edge is off-screen for this edit.
                if ly >= max_y {
                    break;
                }
                font::draw_text_shadowed(
                    img,
                    base_x,
                    ly,
                    line,
                    Rgba(*color),
                    shadow,
                    size,
                );
            }
        }
        Edit::Blur { x, y, w, h, radius } => {
            blur_region(img, *x, *y, *w, *h, *radius);
        }
        Edit::Simplify {
            x,
            y,
            w,
            h,
            block_size,
            threshold,
            merge,
            padding,
            roundness,
        } => {
            simplify_region(
                img, *x, *y, *w, *h, *block_size, *threshold, *merge, *padding, *roundness,
            );
        }
    }
}

// ——— primitives ——————————————————————————————————————————————————

fn blend_pixel(img: &mut RgbaImage, x: i32, y: i32, color: [u8; 4], coverage: f32) {
    if coverage <= 0.0 {
        return;
    }
    let (w, h) = img.dimensions();
    if x < 0 || y < 0 || x as u32 >= w || y as u32 >= h {
        return;
    }
    let a = (color[3] as f32 / 255.0) * coverage.clamp(0.0, 1.0);
    if a <= 0.0 {
        return;
    }
    let ux = x as u32;
    let uy = y as u32;
    let dst = img.get_pixel_mut(ux, uy);
    let inv = 1.0 - a;
    dst.0[0] = (color[0] as f32 * a + dst.0[0] as f32 * inv).round() as u8;
    dst.0[1] = (color[1] as f32 * a + dst.0[1] as f32 * inv).round() as u8;
    dst.0[2] = (color[2] as f32 * a + dst.0[2] as f32 * inv).round() as u8;
    // Keep the destination alpha at max(dst_alpha, contribution) so we
    // don't make previously-solid pixels go translucent.
    let new_a = (dst.0[3] as f32).max(color[3] as f32 * coverage.clamp(0.0, 1.0));
    dst.0[3] = new_a.round().min(255.0) as u8;
}

fn fill_rect(img: &mut RgbaImage, x: f32, y: f32, w: f32, h: f32, color: [u8; 4]) {
    let (iw, ih) = img.dimensions();
    let x0 = x.max(0.0).floor() as u32;
    let y0 = y.max(0.0).floor() as u32;
    let x1 = (x + w).min(iw as f32).ceil() as u32;
    let y1 = (y + h).min(ih as f32).ceil() as u32;
    for py in y0..y1 {
        for px in x0..x1 {
            blend_pixel(img, px as i32, py as i32, color, 1.0);
        }
    }
}

fn stroke_rect(
    img: &mut RgbaImage,
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    thickness: f32,
    color: [u8; 4],
) {
    // Draw four line segments. Half-thickness overlap at corners is
    // fine — alpha blending handles it.
    stroke_line(img, x, y, x + w, y, thickness, color);
    stroke_line(img, x + w, y, x + w, y + h, thickness, color);
    stroke_line(img, x + w, y + h, x, y + h, thickness, color);
    stroke_line(img, x, y + h, x, y, thickness, color);
}

/// Signed-distance-based thick anti-aliased line segment.
fn stroke_line(
    img: &mut RgbaImage,
    x1: f32,
    y1: f32,
    x2: f32,
    y2: f32,
    thickness: f32,
    color: [u8; 4],
) {
    let r = (thickness * 0.5).max(0.5);
    let (iw, ih) = img.dimensions();
    let min_x = x1.min(x2) - r - 1.0;
    let min_y = y1.min(y2) - r - 1.0;
    let max_x = x1.max(x2) + r + 1.0;
    let max_y = y1.max(y2) + r + 1.0;
    let x0 = min_x.max(0.0) as i32;
    let y0 = min_y.max(0.0) as i32;
    let xe = (max_x.min(iw as f32 - 1.0)) as i32;
    let ye = (max_y.min(ih as f32 - 1.0)) as i32;

    let dx = x2 - x1;
    let dy = y2 - y1;
    let len2 = dx * dx + dy * dy;
    if len2 <= 0.0001 {
        // Degenerate segment → draw a filled disk.
        fill_disk(img, x1, y1, r, color);
        return;
    }

    for py in y0..=ye {
        for px in x0..=xe {
            let fx = px as f32 + 0.5;
            let fy = py as f32 + 0.5;
            let t = (((fx - x1) * dx + (fy - y1) * dy) / len2).clamp(0.0, 1.0);
            let nx = x1 + t * dx;
            let ny = y1 + t * dy;
            let d = ((fx - nx).powi(2) + (fy - ny).powi(2)).sqrt();
            let cov = (r + 0.5 - d).clamp(0.0, 1.0);
            if cov > 0.0 {
                blend_pixel(img, px, py, color, cov);
            }
        }
    }
}

fn fill_disk(img: &mut RgbaImage, cx: f32, cy: f32, r: f32, color: [u8; 4]) {
    let (iw, ih) = img.dimensions();
    let x0 = ((cx - r - 1.0).max(0.0)) as i32;
    let y0 = ((cy - r - 1.0).max(0.0)) as i32;
    let xe = ((cx + r + 1.0).min(iw as f32 - 1.0)) as i32;
    let ye = ((cy + r + 1.0).min(ih as f32 - 1.0)) as i32;
    for py in y0..=ye {
        for px in x0..=xe {
            let fx = px as f32 + 0.5;
            let fy = py as f32 + 0.5;
            let d = ((fx - cx).powi(2) + (fy - cy).powi(2)).sqrt();
            let cov = (r + 0.5 - d).clamp(0.0, 1.0);
            if cov > 0.0 {
                blend_pixel(img, px, py, color, cov);
            }
        }
    }
}

fn fill_ellipse(img: &mut RgbaImage, x: f32, y: f32, w: f32, h: f32, color: [u8; 4]) {
    if w <= 0.0 || h <= 0.0 {
        return;
    }
    let cx = x + w / 2.0;
    let cy = y + h / 2.0;
    let rx = w / 2.0;
    let ry = h / 2.0;
    let (iw, ih) = img.dimensions();
    let x0 = ((cx - rx).max(0.0)) as i32;
    let y0 = ((cy - ry).max(0.0)) as i32;
    let xe = ((cx + rx).min(iw as f32 - 1.0)) as i32;
    let ye = ((cy + ry).min(ih as f32 - 1.0)) as i32;
    for py in y0..=ye {
        for px in x0..=xe {
            let fx = px as f32 + 0.5;
            let fy = py as f32 + 0.5;
            let nx = (fx - cx) / rx;
            let ny = (fy - cy) / ry;
            let r2 = nx * nx + ny * ny;
            if r2 <= 1.0 {
                let edge = (1.0 - r2.sqrt()).clamp(0.0, 1.0);
                // Soft edge over ~1px.
                let cov = (edge * rx.min(ry) + 0.5).clamp(0.0, 1.0);
                blend_pixel(img, px, py, color, cov);
            }
        }
    }
}

fn stroke_ellipse(
    img: &mut RgbaImage,
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    thickness: f32,
    color: [u8; 4],
) {
    if w <= 0.0 || h <= 0.0 {
        return;
    }
    let cx = x + w / 2.0;
    let cy = y + h / 2.0;
    let rx = w / 2.0;
    let ry = h / 2.0;
    let t = thickness * 0.5;
    let outer_rx = rx + t;
    let outer_ry = ry + t;
    let (iw, ih) = img.dimensions();
    let x0 = ((cx - outer_rx - 1.0).max(0.0)) as i32;
    let y0 = ((cy - outer_ry - 1.0).max(0.0)) as i32;
    let xe = ((cx + outer_rx + 1.0).min(iw as f32 - 1.0)) as i32;
    let ye = ((cy + outer_ry + 1.0).min(ih as f32 - 1.0)) as i32;
    for py in y0..=ye {
        for px in x0..=xe {
            let fx = px as f32 + 0.5;
            let fy = py as f32 + 0.5;
            // Approximate distance to ellipse using gradient-normalized
            // implicit form. Exact ellipse distance is nontrivial; this
            // produces a smooth stroke that looks right at display sizes.
            let nx = (fx - cx) / rx;
            let ny = (fy - cy) / ry;
            let v = nx * nx + ny * ny;
            let grad = (((fx - cx) / (rx * rx)).powi(2)
                + ((fy - cy) / (ry * ry)).powi(2))
            .sqrt()
            .max(1e-6);
            let dist = (v - 1.0).abs() / (2.0 * grad);
            let cov = (t + 0.5 - dist).clamp(0.0, 1.0);
            if cov > 0.0 {
                blend_pixel(img, px, py, color, cov);
            }
        }
    }
}

fn draw_arrow(
    img: &mut RgbaImage,
    x1: f32,
    y1: f32,
    x2: f32,
    y2: f32,
    thickness: f32,
    color: [u8; 4],
) {
    let dx = x2 - x1;
    let dy = y2 - y1;
    let len = (dx * dx + dy * dy).sqrt();
    if len < 1.0 {
        fill_disk(img, x2, y2, thickness * 0.5, color);
        return;
    }
    let head_len = (thickness * 3.0).max(12.0);
    let ux = dx / len;
    let uy = dy / len;
    let shaft_end_x = x1 + ux * (len - head_len * 0.6).max(0.0);
    let shaft_end_y = y1 + uy * (len - head_len * 0.6).max(0.0);
    stroke_line(img, x1, y1, shaft_end_x, shaft_end_y, thickness, color);

    let ang = dy.atan2(dx);
    let a1 = ang - std::f32::consts::PI / 7.0;
    let a2 = ang + std::f32::consts::PI / 7.0;
    let tip = (x2, y2);
    let p1 = (x2 - a1.cos() * head_len, y2 - a1.sin() * head_len);
    let p2 = (x2 - a2.cos() * head_len, y2 - a2.sin() * head_len);
    fill_triangle(img, tip, p1, p2, color);
}

fn fill_triangle(
    img: &mut RgbaImage,
    a: (f32, f32),
    b: (f32, f32),
    c: (f32, f32),
    color: [u8; 4],
) {
    let (iw, ih) = img.dimensions();
    let min_x = a.0.min(b.0).min(c.0).max(0.0);
    let min_y = a.1.min(b.1).min(c.1).max(0.0);
    let max_x = a.0.max(b.0).max(c.0).min(iw as f32 - 1.0);
    let max_y = a.1.max(b.1).max(c.1).min(ih as f32 - 1.0);
    let x0 = min_x as i32;
    let y0 = min_y as i32;
    let xe = max_x as i32;
    let ye = max_y as i32;

    let edge = |p: (f32, f32), q: (f32, f32), r: (f32, f32)| -> f32 {
        (q.0 - p.0) * (r.1 - p.1) - (q.1 - p.1) * (r.0 - p.0)
    };
    let area = edge(a, b, c);
    if area.abs() < 1e-3 {
        return;
    }
    for py in y0..=ye {
        for px in x0..=xe {
            let fx = px as f32 + 0.5;
            let fy = py as f32 + 0.5;
            let w0 = edge(b, c, (fx, fy));
            let w1 = edge(c, a, (fx, fy));
            let w2 = edge(a, b, (fx, fy));
            let inside = if area > 0.0 {
                w0 >= 0.0 && w1 >= 0.0 && w2 >= 0.0
            } else {
                w0 <= 0.0 && w1 <= 0.0 && w2 <= 0.0
            };
            if inside {
                blend_pixel(img, px, py, color, 1.0);
            }
        }
    }
}

fn blur_region(img: &mut RgbaImage, x: f32, y: f32, w: f32, h: f32, radius: f32) {
    if w < 1.0 || h < 1.0 {
        return;
    }
    let (iw, ih) = img.dimensions();
    // Sample a slightly larger area so the blur doesn't pull in a dark
    // border from outside the region.
    let pad = radius.ceil() as i32;
    let sx = (x as i32 - pad).max(0) as u32;
    let sy = (y as i32 - pad).max(0) as u32;
    let ex = ((x + w) as i32 + pad).min(iw as i32 - 1).max(0) as u32;
    let ey = ((y + h) as i32 + pad).min(ih as i32 - 1).max(0) as u32;
    if ex <= sx || ey <= sy {
        return;
    }
    let crop_w = ex - sx;
    let crop_h = ey - sy;
    let crop =
        imageops::crop(img, sx, sy, crop_w, crop_h).to_image();
    let blurred = imageops::blur(&crop, radius);

    // Paste back only the pixels inside the user-visible region so the
    // padding we added to hide edge-fade stays off-screen.
    let rx0 = x.max(0.0) as u32;
    let ry0 = y.max(0.0) as u32;
    let rx1 = ((x + w) as u32).min(iw);
    let ry1 = ((y + h) as u32).min(ih);
    for py in ry0..ry1 {
        for px in rx0..rx1 {
            let bpx = px - sx;
            let bpy = py - sy;
            if bpx < blurred.width() && bpy < blurred.height() {
                let p = blurred.get_pixel(bpx, bpy);
                img.put_pixel(px, py, *p);
            }
        }
    }
}

/// Simplify heuristic: foreground mask + horizontal dilation +
/// connected components. Each component (text line, icon, image, etc.)
/// becomes a rounded pill in the average color of its foreground
/// pixels. Mirrors the JS pipeline in `paintEdits.ts`.
fn simplify_region(
    img: &mut RgbaImage,
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    block_size: Option<u32>,
    threshold: Option<u32>,
    merge: Option<u32>,
    padding: Option<f32>,
    roundness: Option<u32>,
) {
    if w < 4.0 || h < 4.0 {
        return;
    }
    let factor = block_size.unwrap_or(4).clamp(1, 16) as usize;
    let merge_r = merge.unwrap_or(4).clamp(0, 32) as usize;
    let pad = padding.unwrap_or(1.0).clamp(0.0, 8.0);
    let round_cap = roundness.unwrap_or(6).clamp(0, 64) as f32;
    // Sensitivity slider (4..50) → K cluster count (2..10), matching
    // the JS preview's mapping in `paintEdits.ts`.
    let t_param = threshold.unwrap_or(18).clamp(4, 50) as i32;
    let k_count = (2 + ((t_param - 4) + 3) / 6).clamp(2, 10) as usize;
    let (iw, ih) = img.dimensions();
    // Snap to integer pixel boundaries (floor / ceil) so we sample on
    // the same grid the JS preview uses. Otherwise large regions drift
    // because the float box's edges fall between pixels.
    let sx0 = (x.floor() as i32).max(0);
    let sy0 = (y.floor() as i32).max(0);
    let sx1 = ((x + w).ceil() as i32).min(iw as i32);
    let sy1 = ((y + h).ceil() as i32).min(ih as i32);
    if sx1 <= sx0 || sy1 <= sy0 {
        return;
    }
    let rw = (sx1 - sx0) as usize;
    let rh = (sy1 - sy0) as usize;

    // Snapshot RGB into local buffers so we can read pixel data without
    // tripping over later writes when we draw the pills.
    let mut r_buf = vec![0u8; rw * rh];
    let mut g_buf = vec![0u8; rw * rh];
    let mut b_buf = vec![0u8; rw * rh];
    for ry in 0..rh {
        for rx in 0..rw {
            let p = img.get_pixel((sx0 + rx as i32) as u32, (sy0 + ry as i32) as u32).0;
            let i = ry * rw + rx;
            r_buf[i] = p[0];
            g_buf[i] = p[1];
            b_buf[i] = p[2];
        }
    }

    // K-means clustering pipeline (mirrors the JS in `paintEdits.ts`):
    //   1. Downsample into fixed-size blocks (box average).
    //   2. K-means cluster the block colours into K palette colours.
    //   3. Most-populous cluster = background. For each remaining
    //      cluster, dilate horizontally and pull connected components.
    //   4. Each band fills with its cluster's centroid colour.
    let bw = rw.div_ceil(factor);
    let bh = rh.div_ceil(factor);

    let mut block_r = vec![0f32; bw * bh];
    let mut block_g = vec![0f32; bw * bh];
    let mut block_b = vec![0f32; bw * bh];
    for by in 0..bh {
        let y0 = by * factor;
        let y1 = (y0 + factor).min(rh);
        for bx in 0..bw {
            let x0 = bx * factor;
            let x1 = (x0 + factor).min(rw);
            let mut sr = 0f32;
            let mut sg = 0f32;
            let mut sb = 0f32;
            let mut n = 0f32;
            for py in y0..y1 {
                for px in x0..x1 {
                    let i = py * rw + px;
                    sr += r_buf[i] as f32;
                    sg += g_buf[i] as f32;
                    sb += b_buf[i] as f32;
                    n += 1.0;
                }
            }
            let bi = by * bw + bx;
            block_r[bi] = sr / n;
            block_g[bi] = sg / n;
            block_b[bi] = sb / n;
        }
    }

    let km = kmeans(&block_r, &block_g, &block_b, k_count);
    // Most-populous cluster = background.
    let mut bg_cluster = 0usize;
    for k in 1..k_count {
        if km.counts[k] > km.counts[bg_cluster] {
            bg_cluster = k;
        }
    }

    let min_w = (merge_r as f32 * 1.2).max(2.0) as i32;
    let min_h: i32 = 2;
    let pad_x: f32 = pad;
    let pad_y: f32 = pad;

    for k in 0..k_count {
        if k == bg_cluster {
            continue;
        }
        let mut mask = vec![0u8; bw * bh];
        let mut any = false;
        for i in 0..bw * bh {
            if km.labels[i] as usize == k {
                mask[i] = 1;
                any = true;
            }
        }
        if !any {
            continue;
        }
        let dilated = horizontal_dilate(&mask, bw, bh, merge_r);
        let components = connected_components(&dilated, bw, bh);
        let cluster_color = [
            km.cr[k].round().clamp(0.0, 255.0) as u8,
            km.cg[k].round().clamp(0.0, 255.0) as u8,
            km.cb[k].round().clamp(0.0, 255.0) as u8,
            255u8,
        ];
        for c in components {
            let mut tx0 = c.x1 + 1;
            let mut ty0 = c.y1 + 1;
            let mut tx1: i32 = -1;
            let mut ty1: i32 = -1;
            let mut cnt = 0u32;
            for y in c.y0..=c.y1 {
                for x in c.x0..=c.x1 {
                    let i = (y as usize) * bw + (x as usize);
                    if mask[i] == 0 {
                        continue;
                    }
                    if x < tx0 {
                        tx0 = x;
                    }
                    if x > tx1 {
                        tx1 = x;
                    }
                    if y < ty0 {
                        ty0 = y;
                    }
                    if y > ty1 {
                        ty1 = y;
                    }
                    cnt += 1;
                }
            }
            if tx1 < tx0 || ty1 < ty0 || cnt == 0 {
                continue;
            }
            let orig_w = (tx1 - tx0 + 1) as f32;
            let orig_h = (ty1 - ty0 + 1) as f32;
            if (orig_w as i32) < min_w || (orig_h as i32) < min_h {
                continue;
            }
            let aspect = orig_w / orig_h;
            let coverage = cnt as f32 / (orig_w * orig_h);
            let is_circle = aspect >= 0.7 && aspect <= 1.4 && coverage >= 0.55;
            // Pad is fractional in block units; do the arithmetic in
            // f32 so sub-block padding lands at fractional source-pixel
            // coordinates (matches the JS preview).
            let tx0_f = (tx0 as f32 - pad_x).max(0.0);
            let ty0_f = (ty0 as f32 - pad_y).max(0.0);
            let tx1_f = (tx1 as f32 + pad_x).min(bw as f32 - 1.0);
            let ty1_f = (ty1 as f32 + pad_y).min(bh as f32 - 1.0);
            let factor_f = factor as f32;
            let px0 = tx0_f * factor_f;
            let py0 = ty0_f * factor_f;
            let px1 = ((tx1_f + 1.0) * factor_f - 1.0).min(rw as f32 - 1.0);
            let py1 = ((ty1_f + 1.0) * factor_f - 1.0).min(rh as f32 - 1.0);
            let band_x = sx0 as f32 + px0;
            let band_y = sy0 as f32 + py0;
            let band_w = px1 - px0 + 1.0;
            let band_h = py1 - py0 + 1.0;
            if is_circle {
                fill_ellipse(img, band_x, band_y, band_w, band_h, cluster_color);
            } else {
                let radius = (band_h * 0.5).min(round_cap);
                fill_rounded_rect(
                    img,
                    band_x,
                    band_y,
                    band_w,
                    band_h,
                    radius,
                    cluster_color,
                );
            }
        }
    }
}

/// K-means on a flat list of RGB samples. Deterministic init: sort
/// inputs by luminance and pick K equally-spaced seeds, so the same
/// edit always produces the same labels. Mirrors `kmeans` in
/// `paintEdits.ts`.
struct KmeansResult {
    labels: Vec<u8>,
    cr: Vec<f32>,
    cg: Vec<f32>,
    cb: Vec<f32>,
    counts: Vec<u32>,
}

fn kmeans(rs: &[f32], gs: &[f32], bs: &[f32], k: usize) -> KmeansResult {
    let n = rs.len();
    let mut cr = vec![0f32; k];
    let mut cg = vec![0f32; k];
    let mut cb = vec![0f32; k];
    let mut lums = vec![0f32; n];
    for i in 0..n {
        lums[i] = 0.299 * rs[i] + 0.587 * gs[i] + 0.114 * bs[i];
    }
    let mut sorted: Vec<usize> = (0..n).collect();
    sorted.sort_by(|&a, &b| lums[a].partial_cmp(&lums[b]).unwrap_or(std::cmp::Ordering::Equal));
    for kk in 0..k {
        let pos = ((kk as f32 + 0.5) * n as f32 / k as f32) as usize;
        let idx = sorted[pos.min(n.saturating_sub(1))];
        cr[kk] = rs[idx];
        cg[kk] = gs[idx];
        cb[kk] = bs[idx];
    }

    let mut labels = vec![0u8; n];
    const ITERS: usize = 8;
    for _ in 0..ITERS {
        for i in 0..n {
            let mut best = 0usize;
            let mut best_d = f32::INFINITY;
            for kk in 0..k {
                let dr = rs[i] - cr[kk];
                let dg = gs[i] - cg[kk];
                let db = bs[i] - cb[kk];
                let d = dr * dr + dg * dg + db * db;
                if d < best_d {
                    best_d = d;
                    best = kk;
                }
            }
            labels[i] = best as u8;
        }
        let mut sum_r = vec![0f32; k];
        let mut sum_g = vec![0f32; k];
        let mut sum_b = vec![0f32; k];
        let mut counts = vec![0u32; k];
        for i in 0..n {
            let kk = labels[i] as usize;
            sum_r[kk] += rs[i];
            sum_g[kk] += gs[i];
            sum_b[kk] += bs[i];
            counts[kk] += 1;
        }
        for kk in 0..k {
            if counts[kk] > 0 {
                cr[kk] = sum_r[kk] / counts[kk] as f32;
                cg[kk] = sum_g[kk] / counts[kk] as f32;
                cb[kk] = sum_b[kk] / counts[kk] as f32;
            }
        }
    }

    let mut counts = vec![0u32; k];
    for &l in &labels {
        counts[l as usize] += 1;
    }
    KmeansResult { labels, cr, cg, cb, counts }
}

fn horizontal_dilate(mask: &[u8], w: usize, h: usize, r: usize) -> Vec<u8> {
    let mut out = vec![0u8; w * h];
    for y in 0..h {
        let row = y * w;
        let mut count: i32 = 0;
        let prime_end = (r + 1).min(w);
        for x in 0..prime_end {
            count += mask[row + x] as i32;
        }
        for x in 0..w {
            out[row + x] = if count > 0 { 1 } else { 0 };
            let adding = x + r + 1;
            if adding < w {
                count += mask[row + adding] as i32;
            }
            if x >= r {
                count -= mask[row + x - r] as i32;
            }
        }
    }
    out
}


#[derive(Clone, Copy)]
struct Component {
    x0: i32,
    y0: i32,
    x1: i32,
    y1: i32,
}

fn connected_components(mask: &[u8], w: usize, h: usize) -> Vec<Component> {
    let mut visited = vec![0u8; w * h];
    let mut out: Vec<Component> = Vec::new();
    let mut stack: Vec<usize> = Vec::with_capacity(64);
    for y in 0..h {
        for x in 0..w {
            let start = y * w + x;
            if visited[start] != 0 || mask[start] == 0 {
                continue;
            }
            let mut x0 = x as i32;
            let mut y0 = y as i32;
            let mut x1 = x as i32;
            let mut y1 = y as i32;
            stack.clear();
            stack.push(start);
            while let Some(i) = stack.pop() {
                if visited[i] != 0 || mask[i] == 0 {
                    continue;
                }
                visited[i] = 1;
                let cx = (i % w) as i32;
                let cy = (i / w) as i32;
                if cx < x0 {
                    x0 = cx;
                }
                if cx > x1 {
                    x1 = cx;
                }
                if cy < y0 {
                    y0 = cy;
                }
                if cy > y1 {
                    y1 = cy;
                }
                if cx > 0 {
                    stack.push(i - 1);
                }
                if (cx as usize) < w - 1 {
                    stack.push(i + 1);
                }
                if cy > 0 {
                    stack.push(i - w);
                }
                if (cy as usize) < h - 1 {
                    stack.push(i + w);
                }
            }
            out.push(Component { x0, y0, x1, y1 });
        }
    }
    out
}

fn fill_rounded_rect(
    img: &mut RgbaImage,
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    radius: f32,
    color: [u8; 4],
) {
    if w <= 0.0 || h <= 0.0 {
        return;
    }
    let r = radius.clamp(0.0, (w.min(h)) * 0.5);
    let (iw, ih) = img.dimensions();
    let x0 = (x.max(0.0) as i32).min(iw as i32);
    let y0 = (y.max(0.0) as i32).min(ih as i32);
    let x1 = ((x + w).min(iw as f32) as i32).max(x0);
    let y1 = ((y + h).min(ih as f32) as i32).max(y0);
    // Corner arc centers — shift them in by r so a pixel right at the
    // outer edge sits at distance r from the nearest center.
    let cx_l = x + r;
    let cx_r = x + w - r;
    let cy_t = y + r;
    let cy_b = y + h - r;
    for py in y0..y1 {
        for px in x0..x1 {
            let fx = px as f32 + 0.5;
            let fy = py as f32 + 0.5;
            let cx = fx.max(cx_l).min(cx_r);
            let cy = fy.max(cy_t).min(cy_b);
            let d = ((fx - cx).powi(2) + (fy - cy).powi(2)).sqrt();
            let cov = (r + 0.5 - d).clamp(0.0, 1.0);
            if cov > 0.0 {
                blend_pixel(img, px, py, color, cov);
            }
        }
    }
}
