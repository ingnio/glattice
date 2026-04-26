use parking_lot::Mutex;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};

use xcap::Monitor;

use crate::{
    audio::{AudioCapture, AudioRecorder},
    cursor,
    error::{AppError, AppResult},
    input::{CaptureContext, InputEvent, InputRecorder},
};

pub struct CapturedFrame {
    pub width: u32,
    pub height: u32,
    /// Raw RGBA pixels, 4 bytes per pixel.
    pub rgba: Vec<u8>,
    /// Milliseconds since the first captured frame.
    pub elapsed_ms: u32,
    /// Cursor's hotspot position within the frame's pixel grid, if the
    /// recording captured the cursor. `None` for cursor-less recordings
    /// or imported GIFs. Stored so downstream passes (e.g. simplify)
    /// can re-overlay the cursor on top of any edits.
    pub cursor: Option<(i32, i32)>,
}

pub struct Recording {
    pub fps: u32,
    pub frames: Vec<CapturedFrame>,
    /// Click + key-press events captured during the session, with
    /// millisecond timestamps relative to the first frame. Cursor
    /// click positions are absolute screen pixels (multi-monitor
    /// virtual coords).
    pub input_events: Vec<InputEvent>,
    /// Microphone capture, if the session was started with audio
    /// recording enabled. Persisted to disk as a WAV alongside the
    /// recording so the frontend can mux it into MP4 / WebM exports.
    pub audio: Option<AudioCapture>,
}

/// Region in physical monitor-local pixel coordinates, relative to the
/// primary monitor's origin. `None` means the entire primary monitor.
#[derive(Debug, Clone, Copy)]
pub struct Region {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

/// How the cursor should be handled in a recording.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CursorMode {
    /// Don't track or render the cursor at all.
    Off,
    /// Draw the cursor into each captured frame (legacy behaviour).
    Baked,
    /// Track cursor position per-frame but DON'T draw it into the
    /// source PNG. Preview + export overlay it on top of any edits so
    /// the cursor is unaffected by simplify / blur / etc.
    Overlay,
}

struct Session {
    stop_flag: Arc<AtomicBool>,
    thread: JoinHandle<AppResult<Vec<CapturedFrame>>>,
    fps: u32,
    input: Option<InputRecorder>,
    audio: Option<AudioRecorder>,
}

#[derive(Default)]
pub struct CaptureState {
    session: Mutex<Option<Session>>,
}

impl CaptureState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn start(
        &self,
        fps: u32,
        region: Option<Region>,
        cursor_mode: CursorMode,
        monitor_index: Option<usize>,
        record_clicks: bool,
        record_keys: bool,
        record_audio: bool,
    ) -> AppResult<()> {
        if fps == 0 || fps > 60 {
            return Err(AppError::InvalidConfig(format!(
                "fps must be between 1 and 60, got {fps}"
            )));
        }

        let mut guard = self.session.lock();
        if guard.is_some() {
            return Err(AppError::AlreadyRecording);
        }

        // Probe so we surface a clear error before spawning the thread.
        let probe = pick_monitor(monitor_index)?;
        let mon_origin = (
            probe.x().map_err(|e| AppError::Other(format!("monitor x: {e}")))?,
            probe.y().map_err(|e| AppError::Other(format!("monitor y: {e}")))?,
        );

        let stop_flag = Arc::new(AtomicBool::new(false));
        let stop_flag_thread = stop_flag.clone();
        let interval = Duration::from_micros(1_000_000 / fps as u64);

        // The input recorder uses the same start instant as the capture
        // thread so its event timestamps line up with `frame.elapsed_ms`.
        let session_start = Instant::now();
        let input = if record_clicks || record_keys {
            Some(InputRecorder::start(
                session_start,
                record_clicks,
                record_keys,
                CaptureContext {
                    monitor_origin: mon_origin,
                    region: region.map(|r| (r.x, r.y, r.width, r.height)),
                },
            ))
        } else {
            None
        };

        // Audio capture is opt-in. If the device is missing or the
        // stream fails to build we keep recording video — the user
        // sees the failure surfaced through the per-session error path
        // when they stop, but losing audio shouldn't kill the take.
        let audio = if record_audio {
            match AudioRecorder::start() {
                Ok(rec) => Some(rec),
                Err(e) => {
                    crate::dlog!("[capture] audio start failed: {e}");
                    None
                }
            }
        } else {
            None
        };

        let thread = std::thread::spawn(move || -> AppResult<Vec<CapturedFrame>> {
            let monitor = pick_monitor(monitor_index)?;
            let mut frames: Vec<CapturedFrame> = Vec::new();
            let start = session_start;
            let mut next_tick = Instant::now();

            while !stop_flag_thread.load(Ordering::SeqCst) {
                let capture_result = match region {
                    Some(r) => monitor.capture_region(r.x, r.y, r.width, r.height),
                    None => monitor.capture_image(),
                };

                let img = match capture_result {
                    Ok(img) => img,
                    Err(_) => {
                        next_tick += interval;
                        park_until(next_tick, &stop_flag_thread);
                        continue;
                    }
                };

                let width = img.width();
                let height = img.height();
                let mut rgba = img.into_raw();

                let mut cursor_pos: Option<(i32, i32)> = None;
                if cursor_mode != CursorMode::Off {
                    if let Some((cx, cy)) = cursor::position() {
                        // Cursor position is in absolute screen pixels.
                        // For multi-monitor we first re-base it into the
                        // recording monitor's local coord system, then
                        // subtract the region origin (also monitor-local).
                        let local_cx = cx - mon_origin.0;
                        let local_cy = cy - mon_origin.1;
                        let (fx, fy) = match region {
                            Some(r) => (local_cx - r.x as i32, local_cy - r.y as i32),
                            None => (local_cx, local_cy),
                        };
                        let in_frame = fx >= 0
                            && fy >= 0
                            && (fx as u32) < width
                            && (fy as u32) < height;
                        if in_frame {
                            // Only bake the cursor pixels for "baked"
                            // mode. "overlay" mode just stores the
                            // position so the renderer can draw the
                            // cursor on top of edits later.
                            if cursor_mode == CursorMode::Baked {
                                cursor::draw(&mut rgba, width, height, fx, fy);
                            }
                            cursor_pos = Some((fx, fy));
                        }
                    }
                }

                let elapsed_ms = start.elapsed().as_millis() as u32;
                frames.push(CapturedFrame {
                    width,
                    height,
                    rgba,
                    elapsed_ms,
                    cursor: cursor_pos,
                });

                next_tick += interval;
                park_until(next_tick, &stop_flag_thread);
            }

            Ok(frames)
        });

        *guard = Some(Session {
            stop_flag,
            thread,
            fps,
            input,
            audio,
        });
        Ok(())
    }

    pub fn stop(&self) -> AppResult<Recording> {
        let session = self
            .session
            .lock()
            .take()
            .ok_or(AppError::NotRecording)?;

        session.stop_flag.store(true, Ordering::SeqCst);
        let frames = session
            .thread
            .join()
            .map_err(|_| AppError::Other("capture thread panicked".into()))??;

        let input_events = session
            .input
            .map(|r| r.stop())
            .unwrap_or_default();

        // Drain audio capture before we bail on no-frames, otherwise
        // the recorder thread sits parked forever holding the cpal
        // stream open.
        let audio = match session.audio {
            Some(rec) => match rec.stop() {
                Ok(cap) => Some(cap),
                Err(e) => {
                    crate::dlog!("[capture] audio stop failed: {e}");
                    None
                }
            },
            None => None,
        };

        if frames.is_empty() {
            return Err(AppError::NoFrames);
        }

        Ok(Recording {
            fps: session.fps,
            frames,
            input_events,
            audio,
        })
    }

    pub fn is_recording(&self) -> bool {
        self.session.lock().is_some()
    }
}

/// Geometry of the monitor at `idx` in `Monitor::all()`. `None` falls
/// back to the OS-reported primary monitor (or the first available).
pub fn monitor_geometry(idx: Option<usize>) -> AppResult<(u32, u32, i32, i32, f32)> {
    let m = pick_monitor(idx)?;
    let w = m
        .width()
        .map_err(|e| AppError::Other(format!("monitor width: {e}")))?;
    let h = m
        .height()
        .map_err(|e| AppError::Other(format!("monitor height: {e}")))?;
    let x = m
        .x()
        .map_err(|e| AppError::Other(format!("monitor x: {e}")))?;
    let y = m
        .y()
        .map_err(|e| AppError::Other(format!("monitor y: {e}")))?;
    let scale = m
        .scale_factor()
        .map_err(|e| AppError::Other(format!("monitor scale_factor: {e}")))?;
    Ok((w, h, x, y, scale))
}

/// All connected monitors, in `xcap::Monitor::all()` order.
pub fn list_monitors() -> AppResult<Vec<Monitor>> {
    Monitor::all().map_err(|e| AppError::Other(format!("Monitor::all failed: {e}")))
}

/// Index of the monitor currently containing the OS cursor, if any.
/// Multi-monitor setups span a single virtual coordinate space, so a
/// pixel-in-rect test against each monitor's bounds gives us the
/// active display without having to ask the user.
pub fn cursor_monitor() -> AppResult<Option<usize>> {
    let Some((cx, cy)) = crate::cursor::position() else {
        return Ok(None);
    };
    let monitors = list_monitors()?;
    for (i, m) in monitors.iter().enumerate() {
        let mx = m.x().unwrap_or(0);
        let my = m.y().unwrap_or(0);
        let mw = m.width().unwrap_or(0) as i32;
        let mh = m.height().unwrap_or(0) as i32;
        if cx >= mx && cx < mx + mw && cy >= my && cy < my + mh {
            return Ok(Some(i));
        }
    }
    Ok(None)
}

/// Pick the monitor at the given index. `None` (or out-of-range) falls
/// back to the OS-reported primary monitor; if no primary is flagged,
/// returns the first monitor in the list.
pub fn pick_monitor(idx: Option<usize>) -> AppResult<Monitor> {
    let monitors = list_monitors()?;
    if monitors.is_empty() {
        return Err(AppError::CaptureUnsupported);
    }
    if let Some(i) = idx {
        if let Some(m) = monitors.get(i).cloned() {
            return Ok(m);
        }
    }
    if let Some(primary) = monitors
        .iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .cloned()
    {
        return Ok(primary);
    }
    Ok(monitors.into_iter().next().unwrap())
}

fn park_until(deadline: Instant, stop_flag: &AtomicBool) {
    let slice = Duration::from_millis(20);
    loop {
        if stop_flag.load(Ordering::SeqCst) {
            return;
        }
        let now = Instant::now();
        if now >= deadline {
            return;
        }
        let remaining = deadline - now;
        std::thread::sleep(if remaining > slice { slice } else { remaining });
    }
}
