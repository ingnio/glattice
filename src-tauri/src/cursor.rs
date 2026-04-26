//! Draws a classic-style mouse-cursor arrow onto an RGBA frame buffer.
//!
//! xcap's Windows backend disables native cursor capture by default, so
//! when the user wants the cursor visible in their recording we render
//! our own stylized pointer at the current cursor location.
//!
//! The bitmap is 11×16. A value of `0` is transparent, `1` is the white
//! outline, and `2` is the black body — classic Windows arrow.

const W: usize = 11;
const H: usize = 16;

const GLYPH: [[u8; W]; H] = [
    [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [1, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0],
    [1, 2, 2, 1, 0, 0, 0, 0, 0, 0, 0],
    [1, 2, 2, 2, 1, 0, 0, 0, 0, 0, 0],
    [1, 2, 2, 2, 2, 1, 0, 0, 0, 0, 0],
    [1, 2, 2, 2, 2, 2, 1, 0, 0, 0, 0],
    [1, 2, 2, 2, 2, 2, 2, 1, 0, 0, 0],
    [1, 2, 2, 2, 2, 2, 2, 2, 1, 0, 0],
    [1, 2, 2, 2, 2, 2, 2, 2, 2, 1, 0],
    [1, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1],
    [1, 2, 2, 1, 2, 2, 2, 1, 0, 0, 0],
    [1, 2, 1, 0, 1, 2, 2, 1, 0, 0, 0],
    [1, 1, 0, 0, 1, 2, 2, 1, 0, 0, 0],
    [1, 0, 0, 0, 0, 1, 2, 2, 1, 0, 0],
    [0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0],
];

/// Paint the cursor glyph into an RGBA buffer so its hotspot (0,0)
/// sits at the given pixel coordinates. Pixels outside the frame are
/// silently ignored.
pub fn draw(
    rgba: &mut [u8],
    frame_w: u32,
    frame_h: u32,
    cursor_x: i32,
    cursor_y: i32,
) {
    for (row_idx, row) in GLYPH.iter().enumerate() {
        let py = cursor_y + row_idx as i32;
        if py < 0 || py as u32 >= frame_h {
            continue;
        }
        for (col_idx, &cell) in row.iter().enumerate() {
            if cell == 0 {
                continue;
            }
            let px = cursor_x + col_idx as i32;
            if px < 0 || px as u32 >= frame_w {
                continue;
            }
            let i = ((py as u32 * frame_w + px as u32) * 4) as usize;
            if i + 3 >= rgba.len() {
                continue;
            }
            let (r, g, b) = if cell == 1 {
                (255u8, 255u8, 255u8) // outline
            } else {
                (0u8, 0u8, 0u8) // body
            };
            rgba[i] = r;
            rgba[i + 1] = g;
            rgba[i + 2] = b;
            rgba[i + 3] = 255;
        }
    }
}

/// Current cursor position in physical screen pixels.
#[cfg(target_os = "windows")]
pub fn position() -> Option<(i32, i32)> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    let mut pt = POINT::default();
    unsafe {
        if GetCursorPos(&mut pt).is_ok() {
            Some((pt.x, pt.y))
        } else {
            None
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub fn position() -> Option<(i32, i32)> {
    None
}
