//! Click rings and recent-key labels, drawn onto a frame for the sprite
//! sheet.
//!
//! This is a port of `drawClicks` / `drawKeys` in
//! `src/lib/paintEdits.ts`, which the Player, the Frames grid and the
//! GIF / video exports draw with. Keep the two in step: same lifetimes,
//! same sizes relative to the frame, same colours, same placement.

use image::{Rgba, RgbaImage};

use crate::{
    edits::{fill_disk, fill_rounded_rect, stroke_ellipse},
    font,
    input::{InputEvent, KeyModifiers, MouseButton},
};

/// How long an event stays visible after it fires.
const CLICK_LIFETIME_MS: f32 = 600.0;
const KEY_LIFETIME_MS: f32 = 1500.0;

/// The embedded font is sized by its full line height, where the canvas
/// font size the frontend uses is the em square. Scaling by this ratio
/// makes the glyphs come out the same size as in the Player.
const FONT_PX_PER_EM: f32 = 1.3;

/// Draw an expanding, fading ring for every click within
/// `CLICK_LIFETIME_MS` before `frame_ms`. Colour tells the button apart:
/// amber left, red right, purple middle.
pub fn draw_clicks(img: &mut RgbaImage, events: &[InputEvent], frame_ms: u32) {
    let (w, h) = img.dimensions();
    // Sized off the frame so the ring reads on small regions and on
    // full-monitor captures alike.
    let base_r = (w.min(h) as f32 * 0.012).max(6.0);
    let line_w = (base_r * 0.4).max(2.0);

    for event in events {
        let InputEvent::Click {
            timestamp_ms,
            x,
            y,
            button,
        } = event
        else {
            continue;
        };
        let age = frame_ms as f32 - *timestamp_ms as f32;
        if !(0.0..=CLICK_LIFETIME_MS).contains(&age) {
            continue;
        }
        if *x < 0 || *y < 0 || *x as u32 > w || *y as u32 > h {
            continue;
        }

        let t = age / CLICK_LIFETIME_MS;
        let radius = base_r + t * base_r * 4.0;
        let alpha = ((1.0 - t) * 255.0).round().clamp(0.0, 255.0) as u8;
        let [r, g, b] = match button {
            MouseButton::Right => [239, 68, 68],
            MouseButton::Middle => [168, 85, 247],
            MouseButton::Left => [250, 204, 21],
        };
        let color = [r, g, b, alpha];
        let (cx, cy) = (*x as f32, *y as f32);

        stroke_ellipse(
            img,
            cx - radius,
            cy - radius,
            radius * 2.0,
            radius * 2.0,
            line_w,
            color,
        );
        // A dot at the click point for the first part of the animation,
        // so the moment of impact is clear even once the ring has grown.
        if t < 0.4 {
            fill_disk(img, cx, cy, base_r * 0.5, color);
        }
    }
}

/// Draw the most recent key presses as a stack of labels in the
/// bottom-left corner, newest at the bottom, each fading out over
/// `KEY_LIFETIME_MS`. At most five are shown.
pub fn draw_keys(img: &mut RgbaImage, events: &[InputEvent], frame_ms: u32) {
    let visible: Vec<(String, f32)> = events
        .iter()
        .filter_map(|event| match event {
            InputEvent::Key {
                timestamp_ms,
                label,
                modifiers,
            } => {
                let age = frame_ms as f32 - *timestamp_ms as f32;
                (0.0..=KEY_LIFETIME_MS)
                    .contains(&age)
                    .then(|| (key_text(label, modifiers), age))
            }
            _ => None,
        })
        .collect();
    if visible.is_empty() {
        return;
    }
    let recent = &visible[visible.len().saturating_sub(5)..];

    let (w, h) = img.dimensions();
    let (wf, hf) = (w as f32, h as f32);
    let font_em = (wf.min(hf) * 0.022).round().max(14.0);
    let font_px = (font_em * FONT_PX_PER_EM).round().max(1.0) as u32;
    let pad_x = font_em * 0.65;
    let pad_y = font_em * 0.4;
    let gap = font_em * 0.45;
    let radius = font_em * 0.35;

    let base_x = (wf * 0.025).round();
    let mut bottom = (hf - hf * 0.04).round();

    for (text, age) in recent.iter().rev() {
        let alpha = (1.0 - age / KEY_LIFETIME_MS).clamp(0.0, 1.0);
        let (text_w, text_h) = font::text_dimensions(text, font_px);
        let box_w = text_w as f32 + pad_x * 2.0;
        let box_h = font_em + pad_y * 2.0;
        let x = base_x;
        let y = bottom - box_h;

        // A faint light rim keeps the label visible on dark UIs, then
        // the dark pill itself.
        fill_rounded_rect(
            img,
            x - 1.0,
            y - 1.0,
            box_w + 2.0,
            box_h + 2.0,
            radius + 1.0,
            [255, 255, 255, (0.18 * alpha * 255.0).round() as u8],
        );
        fill_rounded_rect(
            img,
            x,
            y,
            box_w,
            box_h,
            radius,
            [15, 17, 21, (0.78 * alpha * 255.0).round() as u8],
        );
        font::draw_text(
            img,
            (x + pad_x).round() as i32,
            (y + (box_h - text_h as f32) / 2.0).round() as i32,
            text,
            Rgba([245, 247, 252, (alpha * 255.0).round() as u8]),
            font_px,
        );

        bottom = y - gap;
    }
}

/// One key press as a readable token, e.g. "Ctrl+S".
fn key_text(label: &str, modifiers: &KeyModifiers) -> String {
    let mut parts: Vec<&str> = Vec::new();
    if modifiers.ctrl {
        parts.push("Ctrl");
    }
    if modifiers.alt {
        parts.push("Alt");
    }
    if modifiers.shift {
        parts.push("Shift");
    }
    if modifiers.meta {
        parts.push("Win");
    }
    parts.push(printable_label(label));
    parts.join("+")
}

/// The recorder labels the arrow keys with arrow characters. If the
/// embedded font has no glyph for one, spell the key out rather than
/// draw an empty box.
fn printable_label(label: &str) -> &str {
    let mut chars = label.chars();
    match (chars.next(), chars.next()) {
        (Some(c), None) if !font::has_glyph(c) => match c {
            '←' => "Left",
            '→' => "Right",
            '↑' => "Up",
            '↓' => "Down",
            _ => label,
        },
        _ => label,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const BG: [u8; 4] = [244, 246, 250, 255];

    fn blank() -> RgbaImage {
        RgbaImage::from_pixel(960, 540, Rgba(BG))
    }

    fn click(timestamp_ms: u32, x: i32, y: i32, button: MouseButton) -> InputEvent {
        InputEvent::Click {
            timestamp_ms,
            x,
            y,
            button,
        }
    }

    fn key(timestamp_ms: u32, label: &str, ctrl: bool) -> InputEvent {
        InputEvent::Key {
            timestamp_ms,
            label: label.into(),
            modifiers: KeyModifiers {
                ctrl,
                ..Default::default()
            },
        }
    }

    /// Set GLATTICE_OVERLAY_PNG to a path to also save what was drawn.
    fn save_if_asked(img: &RgbaImage) {
        if let Ok(path) = std::env::var("GLATTICE_OVERLAY_PNG") {
            img.save(path).expect("write overlay preview");
        }
    }

    #[test]
    fn a_recent_click_gets_a_ring_and_a_dot_in_its_button_colour() {
        let mut img = blank();
        // 100 ms old: early in its 600 ms life, so the centre dot shows.
        draw_clicks(&mut img, &[click(900, 300, 200, MouseButton::Left)], 1000);

        let dot = img.get_pixel(300, 200).0;
        assert!(
            dot[0] > 240 && dot[1] > 180 && dot[2] < 120,
            "amber dot, got {dot:?}"
        );

        // Base radius 6.48 px, grown by a sixth of its 4x travel: ~10.8 px.
        let ring = img.get_pixel(311, 200).0;
        assert_ne!(ring, BG, "ring should be drawn about 11 px from the click");
        assert!(ring[2] < ring[0], "ring is amber, got {ring:?}");

        // Well outside the ring nothing changes.
        assert_eq!(img.get_pixel(340, 200).0, BG);
    }

    #[test]
    fn clicks_outside_their_lifetime_or_the_frame_are_not_drawn() {
        let mut img = blank();
        let events = [
            click(300, 300, 200, MouseButton::Left),  // 700 ms old: expired
            click(1200, 500, 200, MouseButton::Left), // in the future
            click(950, -20, 200, MouseButton::Left),  // off the frame
        ];
        draw_clicks(&mut img, &events, 1000);
        assert!(img.pixels().all(|p| p.0 == BG));
    }

    #[test]
    fn right_and_middle_clicks_use_their_own_colours() {
        let mut img = blank();
        let events = [
            click(950, 200, 200, MouseButton::Right),
            click(950, 600, 200, MouseButton::Middle),
        ];
        draw_clicks(&mut img, &events, 1000);
        let right = img.get_pixel(200, 200).0;
        let middle = img.get_pixel(600, 200).0;
        assert!(
            right[0] > 200 && right[1] < 110 && right[2] < 110,
            "red, got {right:?}"
        );
        assert!(middle[2] > 200 && middle[1] < 140, "purple, got {middle:?}");
    }

    #[test]
    fn recent_keys_stack_in_the_bottom_left_corner() {
        let mut img = blank();
        let events = [
            key(400, "S", true),
            key(800, "←", false),
            key(950, "Enter", false),
            click(900, 300, 200, MouseButton::Left),
            click(700, 600, 260, MouseButton::Right),
        ];
        draw_clicks(&mut img, &events, 1000);
        draw_keys(&mut img, &events, 1000);
        save_if_asked(&img);

        // The newest label sits lowest: a dark pill whose bottom edge is
        // 4% up from the bottom (y = 518), starting 2.5% in (x = 24).
        let newest = img.get_pixel(27, 505).0;
        assert!(
            newest[0] < 110,
            "dark pill behind the newest key, got {newest:?}"
        );
        // Older labels are stacked above it, fainter as they age.
        let middle = img.get_pixel(27, 474).0;
        let oldest = img.get_pixel(27, 443).0;
        assert!(middle[0] < 200, "second pill, got {middle:?}");
        assert!(
            oldest[0] > middle[0] && oldest != BG,
            "oldest pill is the faintest, got {oldest:?}"
        );
        // The label text is light on the dark pill.
        let lit = (24..140).any(|x| (495..515).any(|y| img.get_pixel(x, y).0[0] > 180));
        assert!(lit, "the newest pill should have light text on it");
        // Nothing is drawn on the right-hand side of the frame.
        assert_eq!(img.get_pixel(900, 505).0, BG);
    }

    #[test]
    fn expired_keys_are_not_drawn() {
        let mut img = blank();
        draw_keys(&mut img, &[key(100, "A", false)], 2000);
        assert!(img.pixels().all(|p| p.0 == BG));
    }

    #[test]
    fn key_text_names_modifiers_in_the_same_order_as_the_frontend() {
        let mods = KeyModifiers {
            ctrl: true,
            shift: true,
            alt: true,
            meta: true,
        };
        assert_eq!(key_text("S", &mods), "Ctrl+Alt+Shift+Win+S");
        assert_eq!(key_text("Enter", &KeyModifiers::default()), "Enter");
    }
}
