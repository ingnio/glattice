//! Global input recorder — clicks + key presses.
//!
//! While the capture session is running, a polling thread samples the
//! mouse-button state and a curated list of keyboard VKs at ~125 Hz.
//! On a rising edge we record an `InputEvent` with a millisecond
//! timestamp relative to the recording start. The Player + Zoom views
//! and the sprite-sheet export use that list to overlay click rings
//! and recent-keys text on top of any per-frame edits — exactly like
//! the cursor overlay, so simplify / blur etc. never interact with
//! these affordances.

use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MouseButton {
    Left,
    Right,
    Middle,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyModifiers {
    pub ctrl: bool,
    pub shift: bool,
    pub alt: bool,
    pub meta: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum InputEvent {
    Click {
        #[serde(rename = "timestampMs")]
        timestamp_ms: u32,
        x: i32,
        y: i32,
        button: MouseButton,
    },
    Key {
        #[serde(rename = "timestampMs")]
        timestamp_ms: u32,
        label: String,
        modifiers: KeyModifiers,
    },
}

pub struct InputRecorder {
    stop_flag: Arc<AtomicBool>,
    thread: Option<JoinHandle<Vec<InputEvent>>>,
}

/// Geometry context passed to the recorder so click positions can be
/// stored in frame-local coordinates (matching `CapturedFrame.cursor`).
pub struct CaptureContext {
    /// Recording monitor's top-left in absolute screen pixels.
    pub monitor_origin: (i32, i32),
    /// Optional region (monitor-local) being captured. `None` = full
    /// monitor, in which case frame coords == monitor-local coords.
    pub region: Option<(u32, u32, u32, u32)>,
}

impl InputRecorder {
    /// Start a new input-capture thread. `start` is the reference
    /// instant that all event timestamps are measured against (usually
    /// the capture session start). Either `record_clicks` or
    /// `record_keys` (or both) must be true; if both are false, the
    /// thread spins doing nothing useful, but it stays cheap.
    pub fn start(
        start: Instant,
        record_clicks: bool,
        record_keys: bool,
        ctx: CaptureContext,
    ) -> Self {
        let stop_flag = Arc::new(AtomicBool::new(false));
        let stop_flag_thread = stop_flag.clone();
        let thread = std::thread::spawn(move || {
            poll_loop(start, stop_flag_thread, record_clicks, record_keys, ctx)
        });
        Self {
            stop_flag,
            thread: Some(thread),
        }
    }

    /// Stop the capture thread and return all collected events.
    pub fn stop(mut self) -> Vec<InputEvent> {
        self.stop_flag.store(true, Ordering::SeqCst);
        match self.thread.take() {
            Some(handle) => handle.join().unwrap_or_default(),
            None => Vec::new(),
        }
    }
}

#[cfg(target_os = "windows")]
fn poll_loop(
    start: Instant,
    stop_flag: Arc<AtomicBool>,
    record_clicks: bool,
    record_keys: bool,
    ctx: CaptureContext,
) -> Vec<InputEvent> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, VIRTUAL_KEY, VK_BACK, VK_CAPITAL, VK_CONTROL,
        VK_DELETE, VK_DOWN, VK_END, VK_ESCAPE, VK_F1, VK_F10, VK_F11,
        VK_F12, VK_F2, VK_F3, VK_F4, VK_F5, VK_F6, VK_F7, VK_F8, VK_F9,
        VK_HOME, VK_INSERT, VK_LBUTTON, VK_LEFT, VK_LWIN, VK_MBUTTON,
        VK_MENU, VK_NEXT, VK_OEM_1, VK_OEM_2, VK_OEM_3, VK_OEM_4,
        VK_OEM_5, VK_OEM_6, VK_OEM_7, VK_OEM_COMMA, VK_OEM_MINUS,
        VK_OEM_PERIOD, VK_OEM_PLUS, VK_PRIOR, VK_RBUTTON, VK_RETURN,
        VK_RIGHT, VK_RWIN, VK_SHIFT, VK_SPACE, VK_TAB, VK_UP,
    };

    // Vks we treat as "regular" keys. Letters / digits / common
    // punctuation / arrows / function keys / Enter, Tab, Esc, Space.
    let mut tracked_keys: Vec<(VIRTUAL_KEY, &'static str)> = Vec::new();
    for c in b'A'..=b'Z' {
        let label: &'static str = match c {
            b'A' => "A", b'B' => "B", b'C' => "C", b'D' => "D",
            b'E' => "E", b'F' => "F", b'G' => "G", b'H' => "H",
            b'I' => "I", b'J' => "J", b'K' => "K", b'L' => "L",
            b'M' => "M", b'N' => "N", b'O' => "O", b'P' => "P",
            b'Q' => "Q", b'R' => "R", b'S' => "S", b'T' => "T",
            b'U' => "U", b'V' => "V", b'W' => "W", b'X' => "X",
            b'Y' => "Y", b'Z' => "Z",
            _ => "",
        };
        tracked_keys.push((VIRTUAL_KEY(c as u16), label));
    }
    for c in b'0'..=b'9' {
        let label: &'static str = match c {
            b'0' => "0", b'1' => "1", b'2' => "2", b'3' => "3",
            b'4' => "4", b'5' => "5", b'6' => "6", b'7' => "7",
            b'8' => "8", b'9' => "9",
            _ => "",
        };
        tracked_keys.push((VIRTUAL_KEY(c as u16), label));
    }
    let named: &[(VIRTUAL_KEY, &'static str)] = &[
        (VK_RETURN, "Enter"),
        (VK_ESCAPE, "Esc"),
        (VK_TAB, "Tab"),
        (VK_BACK, "Backspace"),
        (VK_SPACE, "Space"),
        (VK_DELETE, "Delete"),
        (VK_INSERT, "Insert"),
        (VK_HOME, "Home"),
        (VK_END, "End"),
        (VK_PRIOR, "PgUp"),
        (VK_NEXT, "PgDn"),
        (VK_LEFT, "←"),
        (VK_RIGHT, "→"),
        (VK_UP, "↑"),
        (VK_DOWN, "↓"),
        (VK_CAPITAL, "Caps"),
        (VK_F1, "F1"), (VK_F2, "F2"), (VK_F3, "F3"), (VK_F4, "F4"),
        (VK_F5, "F5"), (VK_F6, "F6"), (VK_F7, "F7"), (VK_F8, "F8"),
        (VK_F9, "F9"), (VK_F10, "F10"), (VK_F11, "F11"), (VK_F12, "F12"),
        (VK_OEM_1, ";"), (VK_OEM_2, "/"), (VK_OEM_3, "`"),
        (VK_OEM_4, "["), (VK_OEM_5, "\\"), (VK_OEM_6, "]"),
        (VK_OEM_7, "'"), (VK_OEM_PLUS, "="), (VK_OEM_MINUS, "-"),
        (VK_OEM_COMMA, ","), (VK_OEM_PERIOD, "."),
    ];
    for (vk, label) in named {
        tracked_keys.push((*vk, label));
    }

    // Previous-state slots for edge detection. Keyed by raw VK u16.
    let mut prev_down: std::collections::HashMap<u16, bool> =
        std::collections::HashMap::new();
    let buttons: &[(VIRTUAL_KEY, MouseButton)] = &[
        (VK_LBUTTON, MouseButton::Left),
        (VK_RBUTTON, MouseButton::Right),
        (VK_MBUTTON, MouseButton::Middle),
    ];

    let mut out: Vec<InputEvent> = Vec::new();
    let interval = Duration::from_millis(8); // ~125 Hz polling
    while !stop_flag.load(Ordering::SeqCst) {
        let now_ms = start.elapsed().as_millis() as u32;
        let down = |vk: VIRTUAL_KEY| -> bool {
            // GetAsyncKeyState returns a SHORT; high bit = currently down.
            let state = unsafe { GetAsyncKeyState(vk.0 as i32) };
            (state as u16) & 0x8000 != 0
        };

        // Modifier snapshot (also used as "is this an edge worth
        // emitting standalone?" — pure modifier keys we skip; they're
        // conveyed via the modifier field on the next regular key).
        let modifiers = KeyModifiers {
            ctrl: down(VK_CONTROL),
            shift: down(VK_SHIFT),
            alt: down(VK_MENU),
            meta: down(VK_LWIN) || down(VK_RWIN),
        };

        if record_clicks {
            for (vk, button) in buttons {
                // High bit: the button is down right now. Low bit: it was
                // pressed at some point since the last time anyone asked.
                // The low bit catches a click that went down and up
                // between two polls (a touchpad tap, or a click sent by
                // automation), which the high bit alone would miss.
                let state = unsafe { GetAsyncKeyState(vk.0 as i32) } as u16;
                let is_down = state & 0x8000 != 0;
                let tapped = state & 0x0001 != 0;
                let was_down = prev_down.get(&vk.0).copied().unwrap_or(false);
                if !was_down && (is_down || tapped) {
                    if let Some((cx, cy)) = crate::cursor::position() {
                        // Convert absolute screen pixels into frame-local
                        // coords so the JS renderer can plot directly.
                        let local_cx = cx - ctx.monitor_origin.0;
                        let local_cy = cy - ctx.monitor_origin.1;
                        let (fx, fy, w, h) = match ctx.region {
                            Some((rx, ry, rw, rh)) => (
                                local_cx - rx as i32,
                                local_cy - ry as i32,
                                rw as i32,
                                rh as i32,
                            ),
                            None => (local_cx, local_cy, i32::MAX, i32::MAX),
                        };
                        if fx >= 0 && fy >= 0 && fx < w && fy < h {
                            out.push(InputEvent::Click {
                                timestamp_ms: now_ms,
                                x: fx,
                                y: fy,
                                button: *button,
                            });
                        }
                    }
                }
                prev_down.insert(vk.0, is_down);
            }
        }

        if record_keys {
            for (vk, label) in &tracked_keys {
                let is_down = down(*vk);
                let was_down = prev_down.get(&vk.0).copied().unwrap_or(false);
                if is_down && !was_down {
                    out.push(InputEvent::Key {
                        timestamp_ms: now_ms,
                        label: (*label).to_string(),
                        modifiers: modifiers.clone(),
                    });
                }
                prev_down.insert(vk.0, is_down);
            }

            // Also emit standalone events for the modifier keys
            // themselves on rising edge — otherwise pressing Ctrl or
            // Shift on its own (or holding it before the next regular
            // key arrives) is invisible in the recent-keys overlay.
            // We strip the matching modifier from the `modifiers`
            // field so it doesn't render as "Ctrl+Ctrl" / "Shift+Shift".
            let modifier_vks: &[(VIRTUAL_KEY, &'static str)] = &[
                (VK_CONTROL, "Ctrl"),
                (VK_SHIFT, "Shift"),
                (VK_MENU, "Alt"),
            ];
            for (vk, label) in modifier_vks {
                let is_down = down(*vk);
                let was_down = prev_down.get(&vk.0).copied().unwrap_or(false);
                if is_down && !was_down {
                    let mut mods = modifiers.clone();
                    match *label {
                        "Ctrl" => mods.ctrl = false,
                        "Shift" => mods.shift = false,
                        "Alt" => mods.alt = false,
                        _ => {}
                    }
                    out.push(InputEvent::Key {
                        timestamp_ms: now_ms,
                        label: (*label).to_string(),
                        modifiers: mods,
                    });
                }
                prev_down.insert(vk.0, is_down);
            }
        }

        std::thread::sleep(interval);
    }
    out
}

#[cfg(not(target_os = "windows"))]
fn poll_loop(
    _start: Instant,
    stop_flag: Arc<AtomicBool>,
    _record_clicks: bool,
    _record_keys: bool,
    _ctx: CaptureContext,
) -> Vec<InputEvent> {
    while !stop_flag.load(Ordering::SeqCst) {
        std::thread::sleep(Duration::from_millis(50));
    }
    Vec::new()
}

