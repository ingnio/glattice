//! Image-based rectangle detection for the region-select overlay.
//!
//! OS-level window enumeration only sees real top-level / child
//! windows, so UI rendered inside a single webview or custom-drawn
//! app (WebView2 / Electron / WPF / canvas) stays invisible. This
//! module finds axis-aligned regions directly from the captured
//! screenshot.
//!
//! Approach — color-quantization + connected components:
//!   1. Downsample to ~800 px wide for speed.
//!   2. Quantize each pixel to 4 bits per channel (4096 colors).
//!      Anti-aliased edges become their own intermediate colors, so
//!      a card's solid background stays crisply separated from the
//!      app's outer background — they become different components
//!      even across a soft 1-px border.
//!   3. Flood-fill connected regions of exactly the same quantized
//!      color. Text/icons on top of a card are different colors,
//!      so they punch holes in the card-bg component, but the
//!      component's BOUNDING BOX still spans the full card.
//!   4. Keep boxes that are big enough, not full-screen, and whose
//!      component fills a reasonable chunk of its bbox (filters out
//!      long thin stripes and ragged shapes).
//!   5. Dedupe near-duplicates so slight 1-px shifts don't produce
//!      multiple overlapping candidates.
//!
//! Works well for UI with distinct card/panel backgrounds — Lenovo
//! Vantage cards, Slack channel list, VS Code sidebars, Discord
//! server tiles, etc.

use std::path::Path;

use image::imageops::{self, FilterType};

pub struct DetectedRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

pub fn detect(img_path: &Path, min_physical: u32) -> Vec<DetectedRect> {
    let full = match image::open(img_path) {
        Ok(i) => i.to_rgba8(),
        Err(_) => return Vec::new(),
    };
    let (full_w, full_h) = full.dimensions();
    if full_w < 10 || full_h < 10 {
        return Vec::new();
    }

    let target_w = 800u32.min(full_w);
    let scale = full_w as f32 / target_w as f32;
    let target_h = ((full_h as f32) / scale).max(1.0) as u32;
    let small = imageops::resize(&full, target_w, target_h, FilterType::Triangle);

    let dw = target_w as usize;
    let dh = target_h as usize;
    let total = dw * dh;

    // Quantize: 4 bits per channel = 4096 total colors. Coarse
    // enough that a card's solid fill is one value even across
    // minor gradient / JPEG-style noise, fine enough that a 5%-
    // different neighbouring bg stays a separate bucket.
    let pixels = small.as_raw();
    let mut quant = vec![0u16; total];
    for i in 0..total {
        let base = i * 4;
        let r = (pixels[base] >> 4) as u16;
        let g = (pixels[base + 1] >> 4) as u16;
        let b = (pixels[base + 2] >> 4) as u16;
        quant[i] = (r << 8) | (g << 4) | b;
    }

    let min_side_small = ((min_physical as f32) / scale).max(4.0) as u32;
    let max_area_small =
        ((target_w as f32) * (target_h as f32) * 0.75) as u64;
    let mut visited = vec![false; total];
    let mut results: Vec<DetectedRect> = Vec::new();

    for start_idx in 0..total {
        if visited[start_idx] {
            continue;
        }
        let target_color = quant[start_idx];
        let start_x = start_idx % dw;
        let start_y = start_idx / dw;

        // Iterative flood-fill with a stack; same-quantized-colour
        // 4-neighbourhood.
        let mut stack: Vec<usize> = Vec::with_capacity(64);
        stack.push(start_idx);
        let (mut mnx, mut mny, mut mxx, mut mxy) =
            (start_x, start_y, start_x, start_y);
        let mut count: u64 = 0;

        while let Some(idx) = stack.pop() {
            if visited[idx] || quant[idx] != target_color {
                continue;
            }
            visited[idx] = true;
            count += 1;
            let x = idx % dw;
            let y = idx / dw;
            if x < mnx {
                mnx = x;
            }
            if x > mxx {
                mxx = x;
            }
            if y < mny {
                mny = y;
            }
            if y > mxy {
                mxy = y;
            }
            if x > 0 {
                stack.push(idx - 1);
            }
            if x + 1 < dw {
                stack.push(idx + 1);
            }
            if y > 0 {
                stack.push(idx - dw);
            }
            if y + 1 < dh {
                stack.push(idx + dw);
            }
        }

        let bw = (mxx - mnx + 1) as u32;
        let bh = (mxy - mny + 1) as u32;
        if bw < min_side_small || bh < min_side_small {
            continue;
        }
        let bbox_area = (bw as u64) * (bh as u64);
        if bbox_area == 0 || bbox_area > max_area_small {
            continue;
        }
        // At least 40% of the bbox should be this color. Allows
        // plenty of holes for text / icons while rejecting long
        // thin strips and scattered dot patterns.
        if count * 100 < bbox_area * 40 {
            continue;
        }
        // Throw out weirdly anisotropic boxes (single-line strips).
        let aspect = (bw as f32) / (bh as f32);
        if aspect < 0.05 || aspect > 20.0 {
            continue;
        }

        results.push(DetectedRect {
            x: ((mnx as f32) * scale) as i32,
            y: ((mny as f32) * scale) as i32,
            width: ((bw as f32) * scale) as u32,
            height: ((bh as f32) * scale) as u32,
        });
    }

    dedupe_rects(&mut results);
    // Sort smallest-first so the frontend's "smallest rect under
    // cursor" preference has locally-sorted input too.
    results.sort_by_key(|r| (r.width as u64) * (r.height as u64));
    results
}

fn dedupe_rects(rects: &mut Vec<DetectedRect>) {
    let tolerance = 6i32;
    let mut i = 0;
    while i < rects.len() {
        let ax = rects[i].x;
        let ay = rects[i].y;
        let aw = rects[i].width;
        let ah = rects[i].height;
        let mut j = i + 1;
        while j < rects.len() {
            let b = &rects[j];
            let similar = (ax - b.x).abs() <= tolerance
                && (ay - b.y).abs() <= tolerance
                && ((aw as i32) - (b.width as i32)).abs() <= tolerance
                && ((ah as i32) - (b.height as i32)).abs() <= tolerance;
            if similar {
                rects.remove(j);
            } else {
                j += 1;
            }
        }
        i += 1;
    }
}
