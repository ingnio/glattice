//! Joins overlapping captures of a scrolling region into one tall picture.
//!
//! The region is captured over and over while the user scrolls. Each new
//! capture is compared with the last one to find how far the content
//! moved, and the rows that came into view are added to the picture.
//!
//! Matching works on small fingerprints rather than pixels: every row is
//! cut into `SEGMENTS` pieces and each piece is summed up as two numbers,
//! how bright it is and where along it the brightness sits. Comparing by
//! piece means something that doesn't scroll with the page, such as a
//! scrollbar thumb, a fixed side panel or a hover highlight, only spoils
//! the pieces it touches instead of whole rows. Comparing numbers with a
//! little slack, rather than exact pixels, means a faint animation (a
//! glow, a fading scrollbar, video noise) doesn't stop two views of the
//! same content from being recognised as the same.

use rayon::prelude::*;

/// Pieces each row is cut into for matching.
const SEGMENTS: usize = 16;
/// Tallest picture, in rows.
pub const MAX_HEIGHT: usize = 20_000;
/// Largest picture, in pixels (width × height).
pub const MAX_PIXELS: usize = 32_000_000;
/// Share of the compared pieces that must agree for an offset to count.
const MATCH_THRESHOLD: f32 = 0.8;
/// An offset this close to the best score is as good as the best.
const NEAR_BEST: f32 = 0.05;
/// Fewest non-blank pieces an offset must be judged on.
const MIN_INFORMATIVE: u32 = 24;
/// Share of all pieces that must be unchanged to call two captures the
/// same view (something on the page changed, but nothing scrolled).
const STILL_THRESHOLD: f32 = 0.9;
/// Captures in a row that couldn't be placed before the picture carries
/// on below a break.
const LOST_BEFORE_GAP: u32 = 4;

/// How far two pieces' numbers may differ and still count as the same,
/// in brightness levels (0 to 255).
const SAME_WITHIN: f32 = 1.5;
/// A piece whose pixels all lie within this many levels of each other is
/// blank: it says nothing about where the content is.
const FLAT_WITHIN: u32 = 2;

/// Per-row fingerprints of one capture.
struct Sig {
    segs: usize,
    /// `height * segs` pieces, row by row: mean brightness, and mean
    /// brightness weighted from -1 at the piece's left to +1 at its right.
    feat: Vec<[f32; 2]>,
    /// True where the piece is blank.
    flat: Vec<bool>,
}

impl Sig {
    /// Whether piece `a` of this capture shows the same as piece `b` of
    /// `other`.
    #[inline]
    fn same(&self, a: usize, other: &Sig, b: usize) -> bool {
        let (x, y) = (self.feat[a], other.feat[b]);
        (x[0] - y[0]).abs() <= SAME_WITHIN && (x[1] - y[1]).abs() <= SAME_WITHIN
    }
}

fn signature(rgba: &[u8], width: usize, height: usize) -> Sig {
    let segs = SEGMENTS.min(width.max(1));
    let mut feat = vec![[0f32; 2]; height * segs];
    let mut flat = vec![true; height * segs];
    feat.par_chunks_mut(segs)
        .zip(flat.par_chunks_mut(segs))
        .enumerate()
        .for_each(|(y, (frow, flrow))| {
            let row = &rgba[y * width * 4..(y + 1) * width * 4];
            for s in 0..segs {
                let a = s * width / segs;
                let b = (s + 1) * width / segs;
                let n = (b - a) as i64;
                let (mut sum, mut ramp) = (0i64, 0i64);
                let (mut lo, mut hi) = (u32::MAX, 0u32);
                for (i, c) in row[a * 4..b * 4].chunks_exact(4).enumerate() {
                    // Brightness, weighted towards green like the eye.
                    let v = (2 * c[0] as u32 + 5 * c[1] as u32 + c[2] as u32) / 8;
                    lo = lo.min(v);
                    hi = hi.max(v);
                    sum += v as i64;
                    // 2i - (n - 1) runs from -(n-1) to +(n-1) across the piece.
                    ramp += v as i64 * (2 * i as i64 - (n - 1));
                }
                frow[s] = [
                    sum as f32 / n as f32,
                    ramp as f32 / (n * n.max(2) - n) as f32 * 2.0,
                ];
                flrow[s] = hi - lo <= FLAT_WITHIN;
            }
        });
    Sig { segs, feat, flat }
}

/// What a capture did to the picture.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Step {
    /// The first capture: it is the picture so far.
    First,
    /// Identical to the last capture.
    Same,
    /// Same view with something changed in place (a hover, an image that
    /// finished loading). The picture was refreshed.
    Still,
    /// The content moved by this many rows; positive is scrolling down.
    Moved(i32),
    /// Couldn't be placed against the last capture. Nothing was added.
    Lost,
    /// Couldn't be placed for a while, so it was added below a break.
    Gap,
    /// The picture is as tall as it is allowed to get.
    Full,
}

pub struct Stitcher {
    width: usize,
    frame_h: usize,
    /// The picture so far: `rows * width * 4` bytes.
    canvas: Vec<u8>,
    /// Canvas row where the last placed capture's first row sits.
    top: usize,
    prev: Option<(Vec<u8>, Sig)>,
    /// Last capture that couldn't be placed, kept to tell when the view
    /// has stopped moving.
    pending: Option<Vec<u8>>,
    lost: u32,
    /// The two smallest heights seen, on pairs that scrolled, of the band
    /// at the top that stayed the same. `usize::MAX` until seen. See
    /// `fixed_top`.
    top_band: [usize; 2],
    pub gaps: u32,
    pub truncated: bool,
}

impl Stitcher {
    pub fn new() -> Self {
        Self {
            width: 0,
            frame_h: 0,
            canvas: Vec::new(),
            top: 0,
            prev: None,
            pending: None,
            lost: 0,
            top_band: [usize::MAX; 2],
            gaps: 0,
            truncated: false,
        }
    }

    pub fn width(&self) -> u32 {
        self.width as u32
    }

    pub fn height(&self) -> u32 {
        if self.width == 0 {
            0
        } else {
            (self.canvas.len() / (self.width * 4)) as u32
        }
    }

    fn rows(&self) -> usize {
        self.canvas.len() / (self.width * 4)
    }

    /// Height of the band at the top that doesn't scroll (a fixed header,
    /// or the edge of a toolbar caught in the region). It belongs at the
    /// top of the picture only, so captures placed further down are never
    /// written from above this row.
    ///
    /// It is the second smallest band seen rather than the smallest, so
    /// that one odd capture, such as the window's frame changing colour
    /// when it loses focus, doesn't make the band look shorter than it
    /// is. Guessing too tall is harmless when scrolling down, because the
    /// rows skipped were already written when they were lower in view;
    /// guessing too short stamps the header into the middle of the page.
    fn fixed_top(&self) -> usize {
        match self.top_band {
            [_, b] if b != usize::MAX => b,
            [a, _] if a != usize::MAX => a,
            _ => 0,
        }
    }

    fn note_top_band(&mut self, t: usize) {
        let [a, b] = self.top_band;
        if t < a {
            self.top_band = [t, a];
        } else if t < b {
            self.top_band[1] = t;
        }
    }

    fn max_rows(&self) -> usize {
        MAX_HEIGHT.min(MAX_PIXELS / self.width.max(1)).max(self.frame_h)
    }

    /// Add the next capture.
    pub fn push(&mut self, rgba: &[u8], width: u32, height: u32) -> Step {
        let (w, h) = (width as usize, height as usize);
        if w == 0 || h == 0 || rgba.len() != w * h * 4 {
            return Step::Lost;
        }
        let Some((prev_px, prev_sig)) = self.prev.as_ref() else {
            self.width = w;
            self.frame_h = h;
            self.canvas = rgba.to_vec();
            self.top = 0;
            self.prev = Some((rgba.to_vec(), signature(rgba, w, h)));
            return Step::First;
        };
        if w != self.width || h != self.frame_h {
            return Step::Lost;
        }
        if self.truncated {
            return Step::Full;
        }
        if prev_px.as_slice() == rgba {
            self.pending = None;
            self.lost = 0;
            return Step::Same;
        }

        let sig = signature(rgba, w, h);
        let segs = sig.segs;
        let row_eq = |y: usize| (0..segs).all(|s| sig.same(y * segs + s, prev_sig, y * segs + s));
        // Bands at the top and bottom that are the same in both captures:
        // a fixed header or footer, or just margin that looks alike.
        let t = (0..h).take_while(|&y| row_eq(y)).count();
        let b = (0..h - t).take_while(|&i| row_eq(h - 1 - i)).count();

        if let Some(d) = find_offset(prev_sig, &sig, t, h - b, h) {
            let new_top = self.top as i64 + d as i64;
            let step = if new_top < 0 {
                // Scrolled above where the capture started: make room at
                // the top and put the whole capture there.
                let add = (-new_top) as usize;
                if self.rows() + add > self.max_rows() {
                    self.truncated = true;
                    return Step::Full;
                }
                let mut grown = vec![0u8; add * w * 4];
                grown.extend_from_slice(&self.canvas);
                self.canvas = grown;
                self.top = 0;
                self.write_rows(rgba, 0, h);
                Step::Moved(d)
            } else {
                let new_top = new_top as usize;
                if new_top + h > self.max_rows() {
                    self.truncated = true;
                    return Step::Full;
                }
                self.top = new_top;
                // The fixed band at the top stays where the first capture
                // put it; everything under it is written at its new place.
                let from = if new_top == 0 { 0 } else { t.max(self.fixed_top()).min(h) };
                self.write_rows(rgba, from, h);
                Step::Moved(d)
            };
            self.note_top_band(t);
            self.prev = Some((rgba.to_vec(), sig));
            self.pending = None;
            self.lost = 0;
            return step;
        }

        // Nothing scrolled, but did the view stay the same otherwise?
        let total = (h * segs) as f32;
        let same = (0..h * segs).filter(|&i| sig.same(i, prev_sig, i)).count() as f32;
        if same / total >= STILL_THRESHOLD {
            // Further down the page, only below the fixed band at the top:
            // writing a header here would stamp it into the middle of the
            // picture.
            let from = if self.top == 0 { 0 } else { t.max(self.fixed_top()).min(h) };
            self.write_rows(rgba, from, h);
            self.prev = Some((rgba.to_vec(), sig));
            self.pending = None;
            self.lost = 0;
            return Step::Still;
        }

        // Lost track: scrolled too far between captures, or the content
        // changed. Wait for the view to settle, then carry on below.
        self.lost += 1;
        let settled = self.pending.as_deref() == Some(rgba);
        if settled && self.lost >= LOST_BEFORE_GAP {
            return self.append_gap(rgba, sig);
        }
        self.pending = Some(rgba.to_vec());
        Step::Lost
    }

    /// Put a capture that couldn't be matched straight under the picture.
    fn append_gap(&mut self, rgba: &[u8], sig: Sig) -> Step {
        let (w, h) = (self.width, self.frame_h);
        let skip = self.fixed_top().min(h - 1);
        let add = h - skip;
        if self.rows() + add > self.max_rows() {
            self.truncated = true;
            return Step::Full;
        }
        let rows = self.rows();
        // Place it so that its rows under the fixed band start exactly
        // where the picture ended.
        self.canvas.resize((rows + add) * w * 4, 0);
        // `top` may be "above" row 0 only by the skipped band, which is
        // never written, so clamp for the bookkeeping.
        self.top = rows.saturating_sub(skip);
        let base = rows * w * 4;
        self.canvas[base..base + add * w * 4].copy_from_slice(&rgba[skip * w * 4..h * w * 4]);
        // Keep later placements consistent with where the rows went.
        if rows < skip {
            self.top = 0;
        }
        self.gaps += 1;
        self.prev = Some((rgba.to_vec(), sig));
        self.pending = None;
        self.lost = 0;
        Step::Gap
    }

    /// Copy capture rows `from..to` to where they belong, growing the
    /// picture as needed.
    fn write_rows(&mut self, rgba: &[u8], from: usize, to: usize) {
        let w4 = self.width * 4;
        let need = (self.top + to) * w4;
        if self.canvas.len() < need {
            self.canvas.resize(need, 0);
        }
        let dst = (self.top + from) * w4;
        self.canvas[dst..dst + (to - from) * w4].copy_from_slice(&rgba[from * w4..to * w4]);
    }

    /// The finished picture: RGBA bytes, width, height.
    pub fn finish(mut self) -> (Vec<u8>, u32, u32) {
        // Stopped while still lost: keep what was last on screen.
        if self.lost > 0 {
            if let Some(px) = self.pending.take() {
                let sig = signature(&px, self.width, self.frame_h);
                self.append_gap(&px, sig);
            }
        }
        let (w, h) = (self.width(), self.height());
        (self.canvas, w, h)
    }
}

/// How far the content moved between two captures, looking only at rows
/// `lo..hi` (the part between the fixed bands). Positive means the page
/// was scrolled down, so `cur[y]` shows what `prev[y + d]` showed.
fn find_offset(prev: &Sig, cur: &Sig, lo: usize, hi: usize, h: usize) -> Option<i32> {
    debug_assert!(hi <= h);
    if hi <= lo {
        return None;
    }
    let span = hi - lo;
    let segs = cur.segs;
    let min_overlap = 12.max(span / 16);
    if span <= min_overlap {
        return None;
    }

    // Columns that don't scroll with the rest (a fixed side panel) would
    // disagree at every offset, so leave them out of the comparison.
    let mut moving = vec![true; segs];
    for (s, m) in moving.iter_mut().enumerate() {
        let same = (lo..hi)
            .filter(|&y| cur.same(y * segs + s, prev, y * segs + s))
            .count();
        if same as f32 >= 0.95 * span as f32 {
            *m = false;
        }
    }
    if !moving.iter().any(|&m| m) {
        return None;
    }

    let max_d = (span - min_overlap) as i32;
    let score = |d: i32| -> (u32, u32) {
        let (ys, ye) = if d > 0 {
            (lo, hi - d as usize)
        } else {
            (lo + (-d) as usize, hi)
        };
        let mut informative = 0u32;
        let mut matched = 0u32;
        for y in ys..ye {
            let py = (y as i64 + d as i64) as usize;
            let c = y * segs;
            let p = py * segs;
            for s in 0..segs {
                if !moving[s] || (cur.flat[c + s] && prev.flat[p + s]) {
                    continue;
                }
                informative += 1;
                if cur.same(c + s, prev, p + s) {
                    matched += 1;
                }
            }
        }
        (informative, matched)
    };

    // Ordered by distance, nearest first, down before up.
    let candidates: Vec<i32> = (1..=max_d).flat_map(|d| [d, -d]).collect();
    let scored: Vec<(i32, f32)> = candidates
        .par_iter()
        .filter_map(|&d| {
            let (informative, matched) = score(d);
            if informative < MIN_INFORMATIVE {
                return None;
            }
            let ratio = matched as f32 / informative as f32;
            (ratio >= MATCH_THRESHOLD).then_some((d, ratio))
        })
        .collect();

    let best = scored.iter().map(|&(_, r)| r).fold(0.0f32, f32::max);
    // Repeating content matches at several offsets. Captures are taken
    // often, so the nearest good one is the right one.
    scored
        .iter()
        .find(|&&(_, r)| r >= best - NEAR_BEST)
        .map(|&(d, _)| d)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A made-up page: every row is different, with some blank rows and
    /// a block that repeats, like a real document.
    fn page(width: usize, rows: usize) -> Vec<u8> {
        let mut px = vec![255u8; width * rows * 4];
        let mut seed: u32 = 12345;
        let mut next = || {
            seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            (seed >> 24) as u8
        };
        for y in 0..rows {
            // Every eighth band of rows is blank, like paragraph spacing.
            if (y / 6) % 8 == 7 {
                continue;
            }
            for x in 0..width {
                let i = (y * width + x) * 4;
                // Text-like noise in the middle, blank margins at the sides.
                if x > width / 10 && x < width * 9 / 10 {
                    let v = next();
                    px[i] = v;
                    px[i + 1] = v.wrapping_mul(3);
                    px[i + 2] = v.wrapping_add(40);
                }
            }
        }
        px
    }

    /// What the region shows when the page is scrolled to `scroll`.
    fn view(page: &[u8], width: usize, scroll: usize, height: usize) -> Vec<u8> {
        page[scroll * width * 4..(scroll + height) * width * 4].to_vec()
    }

    fn paint(px: &mut [u8], width: usize, x0: usize, y0: usize, w: usize, h: usize, rgb: [u8; 3]) {
        for y in y0..y0 + h {
            for x in x0..x0 + w {
                let i = (y * width + x) * 4;
                px[i..i + 3].copy_from_slice(&rgb);
            }
        }
    }

    const W: usize = 320;
    const H: usize = 240;

    #[test]
    fn rebuilds_a_scrolled_page() {
        let doc = page(W, 1500);
        let mut st = Stitcher::new();
        let mut scroll = 0;
        for step in [0usize, 37, 120, 5, 200, 90, 151, 60, 197, 100, 100, 100] {
            scroll += step;
            st.push(&view(&doc, W, scroll, H), W as u32, H as u32);
        }
        let (out, w, h) = st.finish();
        assert_eq!(w as usize, W);
        assert_eq!(h as usize, scroll + H);
        assert!(out == doc[..(scroll + H) * W * 4]);
    }

    #[test]
    fn identical_captures_add_nothing() {
        let doc = page(W, 600);
        let mut st = Stitcher::new();
        assert_eq!(st.push(&view(&doc, W, 0, H), W as u32, H as u32), Step::First);
        assert_eq!(st.push(&view(&doc, W, 0, H), W as u32, H as u32), Step::Same);
        assert_eq!(st.push(&view(&doc, W, 50, H), W as u32, H as u32), Step::Moved(50));
        assert_eq!(st.height() as usize, H + 50);
    }

    #[test]
    fn keeps_a_fixed_header_and_footer_once() {
        let doc = page(W, 1200);
        let header = 30;
        let footer = 20;
        let shot = |scroll: usize| {
            let mut v = view(&doc, W, scroll, H);
            paint(&mut v, W, 0, 0, W, header, [20, 40, 160]);
            paint(&mut v, W, 40, 8, 100, 10, [250, 250, 250]);
            paint(&mut v, W, 0, H - footer, W, footer, [60, 60, 60]);
            v
        };
        let mut st = Stitcher::new();
        let mut scroll = 0;
        for step in [0usize, 60, 110, 45, 130, 80] {
            scroll += step;
            let s = st.push(&shot(scroll), W as u32, H as u32);
            if step > 0 {
                assert_eq!(s, Step::Moved(step as i32));
            }
        }
        let (out, _, h) = st.finish();
        let h = h as usize;
        assert_eq!(h, scroll + H);
        // Header on top, footer at the bottom, the page in between.
        let first = shot(0);
        let last = shot(scroll);
        assert!(out[..header * W * 4] == first[..header * W * 4]);
        assert!(out[(h - footer) * W * 4..] == last[(H - footer) * W * 4..]);
        assert!(out[header * W * 4..(h - footer) * W * 4] == doc[header * W * 4..(h - footer) * W * 4]);
    }

    #[test]
    fn ignores_a_scrollbar_and_a_fixed_side_panel() {
        let doc = page(W, 1200);
        let total = 1200usize;
        let shot = |scroll: usize| {
            let mut v = view(&doc, W, scroll, H);
            // Fixed panel on the left, about a fifth of the width.
            paint(&mut v, W, 0, 0, 70, H, [235, 235, 240]);
            paint(&mut v, W, 10, 20, 40, 8, [40, 40, 40]);
            paint(&mut v, W, 10, 60, 50, 8, [40, 40, 40]);
            // Scrollbar on the right whose thumb moves with the scroll.
            paint(&mut v, W, W - 10, 0, 10, H, [240, 240, 240]);
            let thumb = H * H / total;
            paint(&mut v, W, W - 9, scroll * H / total, 8, thumb, [120, 120, 120]);
            v
        };
        let mut st = Stitcher::new();
        let mut scroll = 0;
        for step in [0usize, 70, 95, 40, 150] {
            scroll += step;
            let s = st.push(&shot(scroll), W as u32, H as u32);
            if step > 0 {
                assert_eq!(s, Step::Moved(step as i32));
            }
        }
        assert_eq!(st.height() as usize, scroll + H);
    }

    #[test]
    fn a_faint_flicker_does_not_break_matching() {
        // A glow down one edge whose brightness wobbles by a level from
        // capture to capture, as an animated overlay or video noise would.
        let doc = page(W, 1200);
        let band = 45;
        let shot = |scroll: usize, phase: u8| {
            let mut v = view(&doc, W, scroll, H);
            for y in 0..H {
                for x in 0..band {
                    let i = (y * W + x) * 4;
                    let wobble = ((x as u8 / 7) + phase) % 2;
                    for c in 0..3 {
                        v[i + c] = v[i + c].saturating_sub(1).saturating_add(wobble);
                    }
                }
            }
            v
        };
        let mut st = Stitcher::new();
        let mut scroll = 0;
        for (n, step) in [0usize, 0, 54, 0, 109, 54, 0, 163, 40].into_iter().enumerate() {
            scroll += step;
            let s = st.push(&shot(scroll, n as u8), W as u32, H as u32);
            if n > 0 {
                let want = if step == 0 { Step::Still } else { Step::Moved(step as i32) };
                assert_eq!(s, want, "capture {n}");
            }
        }
        assert_eq!(st.height() as usize, scroll + H);
        assert_eq!(st.gaps, 0);
    }

    #[test]
    fn follows_scrolling_back_up() {
        let doc = page(W, 1200);
        let mut st = Stitcher::new();
        for scroll in [300usize, 380, 460, 400, 250, 180] {
            st.push(&view(&doc, W, scroll, H), W as u32, H as u32);
        }
        let (out, _, h) = st.finish();
        // Covers from the highest point reached to the lowest.
        assert_eq!(h as usize, 460 + H - 180);
        assert!(out == doc[180 * W * 4..(460 + H) * W * 4]);
    }

    #[test]
    fn a_change_in_place_is_not_a_scroll() {
        let doc = page(W, 600);
        let mut st = Stitcher::new();
        st.push(&view(&doc, W, 100, H), W as u32, H as u32);
        let mut hovered = view(&doc, W, 100, H);
        paint(&mut hovered, W, 40, 100, 120, 12, [255, 230, 120]);
        assert_eq!(st.push(&hovered, W as u32, H as u32), Step::Still);
        assert_eq!(st.height() as usize, H);
    }

    #[test]
    fn a_change_in_place_does_not_stamp_the_header_mid_page() {
        let doc = page(W, 1200);
        let header = 24;
        let shot = |scroll: usize, hovered: bool| {
            let mut v = view(&doc, W, scroll, H);
            paint(&mut v, W, 0, 0, W, header, [20, 40, 160]);
            if hovered {
                paint(&mut v, W, 40, 150, 120, 12, [255, 230, 120]);
            }
            v
        };
        let mut st = Stitcher::new();
        st.push(&shot(0, false), W as u32, H as u32);
        st.push(&shot(90, false), W as u32, H as u32);
        st.push(&shot(200, false), W as u32, H as u32);
        // Something changes in place once the page has been scrolled.
        assert_eq!(st.push(&shot(200, true), W as u32, H as u32), Step::Still);
        assert_eq!(st.push(&shot(200, false), W as u32, H as u32), Step::Still);
        let (out, _, h) = st.finish();
        assert_eq!(h as usize, 200 + H);
        // The header is at the very top and nowhere else.
        assert!(out[header * W * 4..] == doc[header * W * 4..(200 + H) * W * 4]);
    }

    #[test]
    fn a_header_that_changes_colour_is_not_stamped_mid_page() {
        // What happens when you click Done: the window being captured
        // loses focus and its toolbar changes colour, with nothing
        // scrolling.
        let doc = page(W, 1200);
        let header = 6;
        let shot = |scroll: usize, active: bool| {
            let mut v = view(&doc, W, scroll, H);
            let c = if active { [60, 60, 70] } else { [90, 90, 90] };
            paint(&mut v, W, 0, 0, W, header, c);
            v
        };
        let mut st = Stitcher::new();
        for scroll in [0usize, 70, 150, 260, 330] {
            st.push(&shot(scroll, true), W as u32, H as u32);
        }
        assert_eq!(st.push(&shot(330, false), W as u32, H as u32), Step::Still);
        let (out, _, h) = st.finish();
        assert_eq!(h as usize, 330 + H);
        assert!(out[header * W * 4..] == doc[header * W * 4..(330 + H) * W * 4]);
    }

    #[test]
    fn carries_on_below_a_break_when_it_loses_track() {
        let doc = page(W, 2000);
        let mut st = Stitcher::new();
        st.push(&view(&doc, W, 0, H), W as u32, H as u32);
        st.push(&view(&doc, W, 80, H), W as u32, H as u32);
        // A jump with nothing in common with the last capture.
        let far = view(&doc, W, 900, H);
        let mut last = Step::First;
        for _ in 0..6 {
            last = st.push(&far, W as u32, H as u32);
            if last == Step::Gap {
                break;
            }
        }
        assert_eq!(last, Step::Gap);
        assert_eq!(st.gaps, 1);
        // And scrolling keeps working afterwards.
        assert_eq!(st.push(&view(&doc, W, 960, H), W as u32, H as u32), Step::Moved(60));
        assert_eq!(st.height() as usize, 80 + H + H + 60);
    }

    #[test]
    fn stops_at_the_height_limit() {
        let rows = MAX_HEIGHT + 2000;
        let doc = page(64, rows);
        let mut st = Stitcher::new();
        let mut scroll = 0;
        let mut full = false;
        while scroll + 400 + 300 < rows {
            let s = st.push(&view(&doc, 64, scroll, 400), 64, 400);
            if s == Step::Full {
                full = true;
                break;
            }
            scroll += 300;
        }
        assert!(full);
        assert!(st.truncated);
        assert!(st.height() as usize <= MAX_HEIGHT);
    }
}
