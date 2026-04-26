mod audio;
mod capture;
mod cursor;
mod debug_log;
mod edits;
mod error;
mod font;
mod gif_codec;
mod input;
mod rect_detect;
mod sprite;
mod thumbs;

use std::{
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

use serde::{Deserialize, Serialize};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::{
    capture::{CaptureState, Region},
    error::{AppError, AppResult},
};

pub struct AppState {
    pub capture: CaptureState,
    pub imported_gif: parking_lot::Mutex<Option<capture::Recording>>,
    pub region: parking_lot::Mutex<Option<Region>>,
    pub counter: AtomicU64,
    pub last_fps: parking_lot::Mutex<u32>,
    pub current_source_id: parking_lot::Mutex<Option<u64>>,
    pub overlay_bg_path: parking_lot::Mutex<Option<PathBuf>>,
    /// The region the indicator webview should currently draw.
    pub indicator_region: parking_lot::Mutex<Option<IndicatorRegion>>,
    /// True while the indicator is supposed to be on-screen. Read by a
    /// watchdog thread that keeps forcing the indicator window back to
    /// the top of Windows' topmost group — otherwise another
    /// always-on-top window (IDE, Claude desktop, etc.) can obscure it.
    pub indicator_visible: std::sync::Arc<std::sync::atomic::AtomicBool>,
    pub pending_file: parking_lot::Mutex<Option<String>>,
    /// Index into `xcap::Monitor::all()` of the monitor currently
    /// selected for capture / region selection / indicator placement.
    /// `None` means "use the OS-reported primary monitor".
    pub monitor_index: parking_lot::Mutex<Option<usize>>,
    /// When the last precapture completed and which monitor it captured.
    /// `enter_region_overlay` reuses this if it's < 15 s old so the
    /// hover pre-capture eliminates the slow screenshot phase on click.
    pub overlay_bg_captured_at: parking_lot::Mutex<Option<std::time::Instant>>,
    pub precapture_monitor_idx: parking_lot::Mutex<Option<usize>>,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndicatorRegion {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale: f32,
}

impl AppState {
    fn new() -> Self {
        Self {
            capture: CaptureState::new(),
            imported_gif: parking_lot::Mutex::new(None),
            region: parking_lot::Mutex::new(None),
            counter: AtomicU64::new(0),
            last_fps: parking_lot::Mutex::new(5),
            current_source_id: parking_lot::Mutex::new(None),
            overlay_bg_path: parking_lot::Mutex::new(None),
            indicator_region: parking_lot::Mutex::new(None),
            indicator_visible: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(
                false,
            )),
            pending_file: parking_lot::Mutex::new(None),
            monitor_index: parking_lot::Mutex::new(None),
            overlay_bg_captured_at: parking_lot::Mutex::new(None),
            precapture_monitor_idx: parking_lot::Mutex::new(None),
        }
    }

    fn next_id(&self) -> u64 {
        self.counter.fetch_add(1, Ordering::SeqCst)
    }
}

fn ensure_dir(path: &Path) -> AppResult<()> {
    if !path.exists() {
        std::fs::create_dir_all(path)?;
    }
    Ok(())
}

fn workdir(app: &tauri::AppHandle) -> AppResult<PathBuf> {
    let base = app
        .path()
        .app_cache_dir()
        .map_err(|e| AppError::Other(format!("app cache dir unavailable: {e}")))?;
    let dir = base.join("recordings");
    ensure_dir(&dir)?;
    Ok(dir)
}

fn thumb_dir(app: &tauri::AppHandle, source_id: u64) -> AppResult<PathBuf> {
    let dir = workdir(app)?.join("thumbs").join(format!("{source_id}"));
    ensure_dir(&dir)?;
    Ok(dir)
}

fn player_dir(app: &tauri::AppHandle, source_id: u64) -> AppResult<PathBuf> {
    let dir = workdir(app)?.join("player").join(format!("{source_id}"));
    ensure_dir(&dir)?;
    Ok(dir)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecordingInfo {
    path: String,
    frame_count: u32,
    width: u32,
    height: u32,
    fps: u32,
    duration_ms: u32,
    source_id: u64,
    /// Path to the captured-audio WAV file alongside the GIF when the
    /// session was started with audio recording enabled. `None` when
    /// audio was disabled or capture failed silently.
    audio_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FrameThumb {
    index: u32,
    path: String,
    elapsed_ms: u32,
    /// Cursor hotspot in source-frame pixels, when the recording
    /// captured the cursor. The frontend redraws this on top of any
    /// per-frame edits so simplify pills can't bury it.
    cursor: Option<CursorPoint>,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
struct CursorPoint {
    x: i32,
    y: i32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GifInfo {
    path: String,
    frame_count: u32,
    width: u32,
    height: u32,
    duration_ms: u32,
    inferred_fps: u32,
    source_id: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SheetInfo {
    path: String,
    width: u32,
    height: u32,
    columns: u32,
    rows: u32,
    frame_count: u32,
    byte_size: u32,
    mime: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegionInput {
    x: u32,
    y: u32,
    width: u32,
    height: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MonitorGeometry {
    width: u32,
    height: u32,
    x: i32,
    y: i32,
    scale_factor: f32,
}

#[tauri::command]
fn platform_check() -> serde_json::Value {
    let supported = xcap::Monitor::all()
        .map(|m| !m.is_empty())
        .unwrap_or(false);
    serde_json::json!({
        "supported": supported,
        "hasPermission": supported,
        "highQualityAvailable": gif_codec::high_quality_available(),
    })
}

#[tauri::command]
fn is_recording(state: State<'_, AppState>) -> bool {
    state.capture.is_recording()
}

#[tauri::command]
fn get_region(state: State<'_, AppState>) -> AppResult<Option<RegionInput>> {
    Ok(state.region.lock().map(|r| RegionInput {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
    }))
}

#[tauri::command]
fn set_region(region: RegionInput, state: State<'_, AppState>) -> AppResult<()> {
    if region.width == 0 || region.height == 0 {
        return Err(AppError::InvalidConfig("region has zero dimension".into()));
    }
    *state.region.lock() = Some(Region {
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height,
    });
    Ok(())
}

#[tauri::command]
fn clear_region(state: State<'_, AppState>) {
    *state.region.lock() = None;
}

#[tauri::command]
fn primary_monitor(state: State<'_, AppState>) -> AppResult<MonitorGeometry> {
    let idx = *state.monitor_index.lock();
    let (w, h, x, y, scale) = capture::monitor_geometry(idx)?;
    Ok(MonitorGeometry {
        width: w,
        height: h,
        x,
        y,
        scale_factor: scale,
    })
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MonitorInfo {
    index: usize,
    name: String,
    width: u32,
    height: u32,
    x: i32,
    y: i32,
    scale_factor: f32,
    is_primary: bool,
    is_selected: bool,
}

#[tauri::command]
fn list_monitors(state: State<'_, AppState>) -> AppResult<Vec<MonitorInfo>> {
    let monitors = capture::list_monitors()?;
    let selected = *state.monitor_index.lock();
    let mut out: Vec<MonitorInfo> = Vec::with_capacity(monitors.len());
    for (i, m) in monitors.iter().enumerate() {
        let width = m.width().unwrap_or(0);
        let height = m.height().unwrap_or(0);
        let x = m.x().unwrap_or(0);
        let y = m.y().unwrap_or(0);
        let scale_factor = m.scale_factor().unwrap_or(1.0);
        let is_primary = m.is_primary().unwrap_or(false);
        let name = m
            .name()
            .ok()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| format!("Display {}", i + 1));
        // "Selected" reflects the user's pick. With monitor_index=None
        // we treat the OS primary as selected.
        let is_selected = match selected {
            Some(s) => s == i,
            None => is_primary,
        };
        out.push(MonitorInfo {
            index: i,
            name,
            width,
            height,
            x,
            y,
            scale_factor,
            is_primary,
            is_selected,
        });
    }
    // If no monitor is flagged primary AND nothing else picked, mark
    // index 0 as selected so the UI always shows one.
    if !out.iter().any(|m| m.is_selected) {
        if let Some(first) = out.first_mut() {
            first.is_selected = true;
        }
    }
    Ok(out)
}

#[tauri::command]
fn set_monitor(index: Option<usize>, state: State<'_, AppState>) -> AppResult<()> {
    let monitors = capture::list_monitors()?;
    if let Some(i) = index {
        if i >= monitors.len() {
            return Err(AppError::InvalidConfig(format!(
                "monitor index {i} out of range ({} available)",
                monitors.len()
            )));
        }
    }
    *state.monitor_index.lock() = index;
    // Picking a different monitor invalidates the existing region —
    // it was selected against a different coordinate space.
    *state.region.lock() = None;
    Ok(())
}

/// Initiate an OS-level drag-out from the main window with `path` as
/// the dragged file. Once the drag starts the OS handles the rest —
/// the user can drop the file into Slack, a file manager, an email,
/// any app that accepts file drops. Fire-and-forget; the callback
/// inside the drag crate runs on the drag-thread.
#[tauri::command]
fn start_file_drag(path: String, window: tauri::WebviewWindow) -> AppResult<()> {
    let path_buf = std::path::PathBuf::from(&path);
    if !path_buf.exists() {
        return Err(AppError::Other(format!(
            "drag source not found: {path}"
        )));
    }
    drag::start_drag(
        &window,
        drag::DragItem::Files(vec![path_buf]),
        // Empty raw image -> the OS uses the file's own icon as the
        // drag preview. Good enough for v1.
        drag::Image::Raw(Vec::new()),
        |result, _cursor| {
            dlog!("[start_file_drag] result {:?}", result);
        },
        drag::Options::default(),
    )
    .map_err(|e| AppError::Other(format!("drag::start_drag: {e}")))?;
    Ok(())
}

#[tauri::command]
fn start_recording(
    fps: u32,
    cursor_mode: Option<String>,
    record_clicks: Option<bool>,
    record_keys: Option<bool>,
    record_audio: Option<bool>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let t0 = std::time::Instant::now();
    let region = *state.region.lock();
    if region.is_none() {
        if let Ok(Some(idx)) = capture::cursor_monitor() {
            *state.monitor_index.lock() = Some(idx);
        }
    }
    let monitor_index = *state.monitor_index.lock();
    let mode = match cursor_mode.as_deref() {
        Some("baked") => capture::CursorMode::Baked,
        Some("overlay") => capture::CursorMode::Overlay,
        _ => capture::CursorMode::Off,
    };
    let record_clicks = record_clicks.unwrap_or(false);
    let record_keys = record_keys.unwrap_or(false);
    let record_audio = record_audio.unwrap_or(false);
    dlog!(
        "[start_recording] fps={fps} region={region:?} cursor={mode:?} monitor={monitor_index:?} clicks={record_clicks} keys={record_keys} audio={record_audio}"
    );
    *state.last_fps.lock() = fps;
    let result = state.capture.start(
        fps,
        region,
        mode,
        monitor_index,
        record_clicks,
        record_keys,
        record_audio,
    );
    dlog!("[start_recording] returned in {:?} ok={}", t0.elapsed(), result.is_ok());
    result
}

/// Return all input events captured during the current recording. Used
/// by the Player + Zoom views to render click rings and recent-keys
/// overlays on top of any frame edits.
#[tauri::command]
fn list_input_events(state: State<'_, AppState>) -> AppResult<Vec<input::InputEvent>> {
    let guard = state.imported_gif.lock();
    let rec = guard.as_ref().ok_or(AppError::NoGifLoaded)?;
    Ok(rec.input_events.clone())
}

/// Stop capture and hand off encode+thumbs to a background thread.
///
/// Returns immediately once the capture thread has joined and we have
/// the frames in hand, so the webview never blocks on IPC for the slow
/// quantization + thumbnail work. The background task emits:
///   - `encode-progress` { done, total } per frame during quantization
///   - `recording-ready` { ...RecordingInfo } once the GIF + thumbs are
///     written and `imported_gif` / `current_source_id` are populated
///   - `recording-error` { message } on failure
#[tauri::command]
fn stop_recording(
    app: tauri::AppHandle,
    high_quality: Option<bool>,
    state: State<'_, AppState>,
) -> AppResult<u64> {
    let t0 = std::time::Instant::now();
    dlog!("[stop_recording] begin");

    let recording = state.capture.stop()?;
    dlog!(
        "[stop_recording] captured {} frames {}x{} @ {} fps in {:?}",
        recording.frames.len(),
        recording.frames.first().map(|f| f.width).unwrap_or(0),
        recording.frames.first().map(|f| f.height).unwrap_or(0),
        recording.fps,
        t0.elapsed()
    );

    let id = state.next_id();
    let quality = if high_quality.unwrap_or(false) {
        gif_codec::Quality::High
    } else {
        gif_codec::Quality::Standard
    };

    // Spawn the encode + thumbs work on rayon so it runs off any Tauri
    // runtime thread, and so we can hold the whole Recording by value.
    let app_bg = app.clone();
    let state_handle: tauri::State<'_, AppState> = state;
    let _ = state_handle; // we don't capture the state; we re-fetch in the task
    rayon::spawn(move || {
        let t_task = std::time::Instant::now();
        let result = (|| -> AppResult<RecordingInfo> {
            let first = recording.frames.first().ok_or(AppError::NoFrames)?;
            let width = first.width;
            let height = first.height;
            let frame_count = recording.frames.len() as u32;
            let fps = recording.fps;
            let duration_ms = recording
                .frames
                .last()
                .map(|f| f.elapsed_ms)
                .unwrap_or(0);

            let dir = workdir(&app_bg)?;
            let path = dir.join(format!("recording-{id}.gif"));

            let t_enc = std::time::Instant::now();
            let app_for_progress = app_bg.clone();
            gif_codec::encode_recording(&recording, &path, quality, move |done, total| {
                let _ = app_for_progress.emit(
                    "encode-progress",
                    serde_json::json!({ "done": done, "total": total }),
                );
            })?;
            dlog!("[stop_recording bg] encoded gif in {:?}", t_enc.elapsed());

            let t_thumbs = std::time::Instant::now();
            let thumbs_path = thumb_dir(&app_bg, id)?;
            let app_for_thumb_progress = app_bg.clone();
            thumbs::generate_thumbs(&recording, &thumbs_path, move |done, total| {
                let _ = app_for_thumb_progress.emit(
                    "thumb-progress",
                    serde_json::json!({ "done": done, "total": total }),
                );
            })?;
            dlog!(
                "[stop_recording bg] generated thumbs in {:?}",
                t_thumbs.elapsed()
            );

            let t_player = std::time::Instant::now();
            let players_path = player_dir(&app_bg, id)?;
            thumbs::generate_player_frames(&recording, &players_path)?;
            dlog!(
                "[stop_recording bg] wrote player frames in {:?}",
                t_player.elapsed()
            );

            // Persist captured PCM as a WAV next to the GIF. The
            // frontend fetches it via the asset protocol and decodes
            // it with Web Audio for inclusion in MP4 / WebM exports.
            let audio_path = if let Some(cap) = recording.audio.as_ref() {
                let wav_path = dir.join(format!("recording-{id}.wav"));
                match audio::write_wav(&wav_path, cap) {
                    Ok(()) => {
                        dlog!(
                            "[stop_recording bg] wrote audio wav ({} samples @ {} Hz × {} ch)",
                            cap.samples_f32.len(),
                            cap.sample_rate,
                            cap.channels
                        );
                        Some(wav_path.to_string_lossy().into_owned())
                    }
                    Err(e) => {
                        dlog!("[stop_recording bg] audio wav write failed: {e}");
                        None
                    }
                }
            } else {
                None
            };

            let state = app_bg.state::<AppState>();
            *state.imported_gif.lock() = Some(recording);
            *state.current_source_id.lock() = Some(id);

            Ok(RecordingInfo {
                path: path.to_string_lossy().into_owned(),
                frame_count,
                width,
                height,
                fps,
                duration_ms,
                source_id: id,
                audio_path,
            })
        })();

        match result {
            Ok(info) => {
                dlog!("[stop_recording bg] done in {:?}", t_task.elapsed());
                let _ = app_bg.emit("recording-ready", info);
            }
            Err(e) => {
                dlog!("[stop_recording bg] failed: {e}");
                let _ = app_bg.emit(
                    "recording-error",
                    serde_json::json!({ "message": e.to_string() }),
                );
            }
        }
    });

    dlog!(
        "[stop_recording] returned handle id={id} in {:?}",
        t0.elapsed()
    );
    Ok(id)
}

/// Fire-and-forget GIF decode. Returns the allocated source id
/// immediately; the heavy decode + thumb + player-frame work runs on
/// rayon. Emits `gif-ready` (with `GifInfo`) or `gif-error` when done.
#[tauri::command]
fn load_gif(
    app: tauri::AppHandle,
    path: String,
    state: State<'_, AppState>,
) -> AppResult<u64> {
    dlog!("[load_gif] begin path={path}");
    let id = state.next_id();
    let app_bg = app.clone();

    rayon::spawn(move || {
        let t0 = std::time::Instant::now();
        let result = (|| -> AppResult<GifInfo> {
            let pb = PathBuf::from(&path);
            let decoded = gif_codec::decode_gif_from_path(&pb)?;
            let width = decoded.width;
            let height = decoded.height;
            let frame_count = decoded.frames.len() as u32;
            let total_cs: u32 = decoded.frames.iter().map(|f| f.delay_cs as u32).sum();
            let duration_ms = total_cs * 10;

            let recording = gif_codec::recording_from_decoded_gif(decoded);
            let inferred_fps = recording.fps;

            let thumbs_path = thumb_dir(&app_bg, id)?;
            thumbs::generate_thumbs(&recording, &thumbs_path, |_d, _t| {})?;
            let players_path = player_dir(&app_bg, id)?;
            thumbs::generate_player_frames(&recording, &players_path)?;

            let state = app_bg.state::<AppState>();
            *state.imported_gif.lock() = Some(recording);
            *state.current_source_id.lock() = Some(id);

            Ok(GifInfo {
                path,
                frame_count,
                width,
                height,
                duration_ms,
                inferred_fps,
                source_id: id,
            })
        })();

        match result {
            Ok(info) => {
                dlog!("[load_gif bg] ok in {:?}", t0.elapsed());
                let _ = app_bg.emit("gif-ready", info);
            }
            Err(e) => {
                dlog!("[load_gif bg] failed: {e}");
                let _ = app_bg.emit(
                    "gif-error",
                    serde_json::json!({ "message": e.to_string() }),
                );
            }
        }
    });

    Ok(id)
}

#[tauri::command]
fn list_frame_thumbs(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Vec<FrameThumb>> {
    let source_id = (*state.current_source_id.lock()).ok_or(AppError::NoGifLoaded)?;
    let guard = state.imported_gif.lock();
    let recording = guard.as_ref().ok_or(AppError::NoGifLoaded)?;
    let dir = thumb_dir(&app, source_id)?;

    let mut out = Vec::with_capacity(recording.frames.len());
    for (i, frame) in recording.frames.iter().enumerate() {
        let path = dir.join(format!("{i:04}.png"));
        if path.exists() {
            out.push(FrameThumb {
                index: i as u32,
                path: path.to_string_lossy().into_owned(),
                elapsed_ms: frame.elapsed_ms,
                cursor: frame.cursor.map(|(x, y)| CursorPoint { x, y }),
            });
        }
    }
    Ok(out)
}

#[tauri::command]
fn list_player_frames(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Vec<FrameThumb>> {
    let source_id = (*state.current_source_id.lock()).ok_or(AppError::NoGifLoaded)?;
    let guard = state.imported_gif.lock();
    let recording = guard.as_ref().ok_or(AppError::NoGifLoaded)?;
    let dir = player_dir(&app, source_id)?;

    let mut out = Vec::with_capacity(recording.frames.len());
    for (i, frame) in recording.frames.iter().enumerate() {
        let path = dir.join(format!("{i:04}.png"));
        if path.exists() {
            out.push(FrameThumb {
                index: i as u32,
                path: path.to_string_lossy().into_owned(),
                elapsed_ms: frame.elapsed_ms,
                cursor: frame.cursor.map(|(x, y)| CursorPoint { x, y }),
            });
        }
    }
    Ok(out)
}

/// Fire-and-forget sheet composition. Returns immediately; the actual
/// work runs on a rayon thread pool. Emits `sheet-ready` (with
/// `SheetInfo`) on success or `sheet-error` (with a message) on failure.
#[tauri::command]
fn generate_sprite_sheet(
    app: tauri::AppHandle,
    config: sprite::SheetConfig,
    state: State<'_, AppState>,
) -> AppResult<()> {
    dlog!("[generate_sprite_sheet] begin");

    // Clone the recording so the rayon task owns it — avoids holding
    // the AppState mutex for the whole compose.
    let recording = {
        let guard = state.imported_gif.lock();
        let rec = guard.as_ref().ok_or(AppError::NoGifLoaded)?;
        capture::Recording {
            fps: rec.fps,
            frames: rec
                .frames
                .iter()
                .map(|f| capture::CapturedFrame {
                    width: f.width,
                    height: f.height,
                    rgba: f.rgba.clone(),
                    elapsed_ms: f.elapsed_ms,
                    cursor: f.cursor,
                })
                .collect(),
            input_events: rec.input_events.clone(),
            // Sprite sheets never need audio — clone leaves it out.
            audio: None,
        }
    };

    let id = state.next_id();
    let app_bg = app.clone();
    rayon::spawn(move || {
        let t0 = std::time::Instant::now();
        let result = (|| -> AppResult<SheetInfo> {
            let out = sprite::compose(&recording, &config)?;
            let dir = workdir(&app_bg)?;
            let path = dir.join(format!("sheet-{id}.{}", out.ext));
            std::fs::write(&path, &out.bytes)?;
            Ok(SheetInfo {
                path: path.to_string_lossy().into_owned(),
                width: out.width,
                height: out.height,
                columns: out.columns,
                rows: out.rows,
                frame_count: out.frame_count,
                byte_size: out.bytes.len() as u32,
                mime: out.mime.to_string(),
            })
        })();

        match result {
            Ok(info) => {
                dlog!("[generate_sprite_sheet] ok in {:?}", t0.elapsed());
                let _ = app_bg.emit("sheet-ready", info);
            }
            Err(e) => {
                dlog!("[generate_sprite_sheet] failed: {e}");
                let _ = app_bg.emit(
                    "sheet-error",
                    serde_json::json!({ "message": e.to_string() }),
                );
            }
        }
    });

    Ok(())
}

/// Snapshot the monitor under the cursor and cache it as the overlay
/// backdrop — intended to be called on hover of "Select region" so the
/// screenshot is ready by the time the user clicks and there is no
/// capture delay in `enter_region_overlay`.
///
/// Fire-and-forget: returns immediately. If a fresh capture (< 15 s)
/// already exists this is a no-op so rapid hover/unhover doesn't
/// stack up duplicate capture tasks.
#[tauri::command]
fn precapture_overlay_bg(app: tauri::AppHandle) -> AppResult<()> {
    let state = app.state::<AppState>();

    // Don't bother if a sufficiently fresh capture already exists.
    if let Some(t) = *state.overlay_bg_captured_at.lock() {
        if t.elapsed() < std::time::Duration::from_secs(15) {
            dlog!("[precapture_overlay_bg] cache still fresh, skipping");
            return Ok(());
        }
    }

    let app_bg = app.clone();
    rayon::spawn(move || {
        let t0 = std::time::Instant::now();
        let state = app_bg.state::<AppState>();
        let bg_path = match workdir(&app_bg) {
            Ok(d) => d.join("overlay-bg.jpg"),
            Err(e) => {
                dlog!("[precapture_overlay_bg] workdir failed: {e}");
                return;
            }
        };
        let monitor_idx = capture::cursor_monitor()
            .ok()
            .flatten()
            .or_else(|| *state.monitor_index.lock());
        let monitor = match capture::pick_monitor(monitor_idx) {
            Ok(m) => m,
            Err(e) => {
                dlog!("[precapture_overlay_bg] pick_monitor failed: {e}");
                return;
            }
        };
        let shot = match monitor.capture_image() {
            Ok(s) => s,
            Err(e) => {
                dlog!("[precapture_overlay_bg] capture_image failed: {e}");
                return;
            }
        };
        let rgb = image::DynamicImage::ImageRgba8(shot).into_rgb8();
        if let Err(e) = rgb.save(&bg_path) {
            dlog!("[precapture_overlay_bg] save failed: {e}");
            return;
        }
        *state.overlay_bg_path.lock() = Some(bg_path);
        *state.overlay_bg_captured_at.lock() = Some(std::time::Instant::now());
        *state.precapture_monitor_idx.lock() = monitor_idx;
        dlog!(
            "[precapture_overlay_bg] done monitor={monitor_idx:?} in {:?}",
            t0.elapsed()
        );
    });
    Ok(())
}

/// Fire-and-forget region-overlay setup. Returns immediately; the
/// screenshot capture and window repurpose run on a rayon thread.
/// The frontend listens for `overlay-ready` which carries the
/// `PrevWindow` geometry the user needs to restore on exit.
///
/// To mask the slow window-resize + WebView2 repaint window with
/// useful feedback, we drive the indicator window into a "prep mode"
/// for the duration: a fullscreen transparent overlay with a centered
/// spinner card that floats over the user's desktop while the main
/// window is hidden / catching up. The card is shown *after* the
/// screenshot so it doesn't bleed into the captured backdrop.
#[tauri::command]
fn enter_region_overlay(app: tauri::AppHandle) -> AppResult<()> {
    dlog!("[enter_region_overlay] begin");
    let app_bg = app.clone();

    rayon::spawn(move || {
        let t0 = std::time::Instant::now();
        // JPEG instead of PNG — same backdrop quality at a fraction of
        // the encode cost (PNG of a 4K screenshot is the dominant cost
        // here, often >500 ms; JPEG drops it to ~50 ms).
        let bg_path = workdir(&app_bg)
            .ok()
            .map(|d| d.join("overlay-bg.jpg"))
            .unwrap_or_else(|| std::path::PathBuf::from("overlay-bg.jpg"));
        let result = (|| -> AppResult<serde_json::Value> {
            let state = app_bg.state::<AppState>();

            // Use the hover pre-capture if it's still fresh (< 15 s).
            // This eliminates the slow capture_image phase on click —
            // the screenshot was already taken while the user was
            // hovering, so we can show the prep spinner immediately
            // without it bleeding into the backdrop.
            let cache_age = state
                .overlay_bg_captured_at
                .lock()
                .map(|t| t.elapsed());
            let use_cache = cache_age
                .as_ref()
                .map(|d| *d < std::time::Duration::from_secs(15))
                .unwrap_or(false);

            let monitor_idx = if use_cache {
                dlog!("[enter_region_overlay bg] using pre-captured backdrop (age {:?})", cache_age.unwrap());
                // Preserve the monitor index from when the capture
                // was taken — the overlay must use the same screen.
                let idx = *state.precapture_monitor_idx.lock();
                *state.monitor_index.lock() = idx;
                idx
            } else {
                let t_cap = std::time::Instant::now();
                // No fresh cache — fall back to capturing now. The
                // spinner may end up in the screenshot (same as the
                // old behaviour), but at least the window transition
                // is masked.
                let monitor_idx = capture::cursor_monitor()?
                    .or_else(|| *state.monitor_index.lock());
                *state.monitor_index.lock() = monitor_idx;
                let monitor = capture::pick_monitor(monitor_idx)?;
                let shot = monitor
                    .capture_image()
                    .map_err(|e| AppError::Other(format!("capture_image: {e}")))?;
                let rgb = image::DynamicImage::ImageRgba8(shot).into_rgb8();
                rgb.save(&bg_path)
                    .map_err(|e| AppError::Other(format!("save overlay bg: {e}")))?;
                dlog!(
                    "[enter_region_overlay bg] fallback screenshot in {:?}",
                    t_cap.elapsed()
                );
                *state.overlay_bg_path.lock() = Some(bg_path.clone());
                monitor_idx
            };

            // Spinner goes up after the screenshot is secured so it
            // never bleeds into the backdrop image.
            let _ = show_prep_indicator_inner(&app_bg, monitor_idx);

            let (mw, mh, mx, my, scale) = capture::monitor_geometry(monitor_idx)?;
            let scale_f64 = if scale > 0.0 { scale as f64 } else { 1.0 };
            let logical_w = mw as f64 / scale_f64;
            let logical_h = mh as f64 / scale_f64;
            let logical_x = mx as f64 / scale_f64;
            let logical_y = my as f64 / scale_f64;

            let win = app_bg
                .get_webview_window("main")
                .ok_or_else(|| AppError::Other("main window missing".into()))?;

            let prev_outer = win
                .outer_position()
                .map_err(|e| AppError::Other(format!("outer_position: {e}")))?;
            let prev_inner = win
                .inner_size()
                .map_err(|e| AppError::Other(format!("inner_size: {e}")))?;
            let prev_decorated = win
                .is_decorated()
                .map_err(|e| AppError::Other(format!("is_decorated: {e}")))?;

            // Hide the window before mutating its geometry so the
            // user doesn't see the native frame repaint black while
            // WebView2 catches up with the new size. The prep
            // indicator we just lit up keeps the screen non-blank
            // through this whole transition.
            let _ = win.hide();

            win.set_decorations(false)
                .map_err(|e| AppError::Other(format!("set_decorations: {e}")))?;
            win.set_always_on_top(true)
                .map_err(|e| AppError::Other(format!("set_always_on_top: {e}")))?;
            win.set_resizable(false)
                .map_err(|e| AppError::Other(format!("set_resizable: {e}")))?;
            win.set_size(tauri::LogicalSize::new(logical_w, logical_h))
                .map_err(|e| AppError::Other(format!("set_size: {e}")))?;
            win.set_position(tauri::LogicalPosition::new(logical_x, logical_y))
                .map_err(|e| AppError::Other(format!("set_position: {e}")))?;
            let _ = win.show();
            let _ = win.set_focus();

            Ok(serde_json::json!({
                "prevX": prev_outer.x,
                "prevY": prev_outer.y,
                "prevWidth": prev_inner.width,
                "prevHeight": prev_inner.height,
                "prevDecorated": prev_decorated,
            }))
        })();

        // Always tear down the prep indicator before handing control
        // back, even on the error path — leaving a fullscreen spinner
        // up after a failure would be worse than the failure itself.
        let _ = hide_prep_indicator_inner(&app_bg);

        match result {
            Ok(prev) => {
                dlog!("[enter_region_overlay bg] done in {:?}", t0.elapsed());
                let _ = app_bg.emit("overlay-ready", prev);
            }
            Err(e) => {
                dlog!("[enter_region_overlay bg] failed: {e}");
                let _ = app_bg.emit(
                    "overlay-error",
                    serde_json::json!({ "message": e.to_string() }),
                );
            }
        }
    });

    Ok(())
}

/// Position the indicator window fullscreen on the active monitor and
/// flip it into "preparing" mode — a centered spinner card floating
/// over the desktop. Used both directly by App.tsx (so the spinner
/// appears the *instant* the user clicks "Select region", before the
/// rayon screenshot starts) and inside the overlay-setup task to
/// keep the screen non-blank through the window resize.
fn show_prep_indicator_inner(
    app: &tauri::AppHandle,
    monitor_idx: Option<usize>,
) -> AppResult<()> {
    let win = app
        .get_webview_window("indicator")
        .ok_or_else(|| AppError::Other("indicator window missing".into()))?;

    let (mw, mh, mx, my, scale) = capture::monitor_geometry(monitor_idx)?;
    let scale_f = if scale > 0.0 { scale } else { 1.0 };
    let scale = scale_f as f64;

    let mon_lx = mx as f64 / scale;
    let mon_ly = my as f64 / scale;
    let mon_lw = mw as f64 / scale;
    let mon_lh = mh as f64 / scale;

    win.set_size(tauri::LogicalSize::new(mon_lw, mon_lh))
        .map_err(|e| AppError::Other(format!("indicator set_size: {e}")))?;
    win.set_position(tauri::LogicalPosition::new(mon_lx, mon_ly))
        .map_err(|e| AppError::Other(format!("indicator set_position: {e}")))?;
    win.show()
        .map_err(|e| AppError::Other(format!("indicator show: {e}")))?;
    let _ = win.set_always_on_top(true);
    let _ = win.set_ignore_cursor_events(true);

    // Region-marquee state has nothing to do with prep — clear it so
    // the indicator doesn't render a stale rectangle alongside the
    // spinner.
    let state = app.state::<AppState>();
    *state.indicator_region.lock() = None;
    state
        .indicator_visible
        .store(true, std::sync::atomic::Ordering::SeqCst);
    raise_indicator_now(app);

    let _ = win.emit("indicator-prep", true);
    Ok(())
}

fn hide_prep_indicator_inner(app: &tauri::AppHandle) -> AppResult<()> {
    if let Some(win) = app.get_webview_window("indicator") {
        let _ = win.emit("indicator-prep", false);
        let _ = win.hide();
    }
    let state = app.state::<AppState>();
    state
        .indicator_visible
        .store(false, std::sync::atomic::Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
fn show_prep_indicator(app: tauri::AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    // Pick the monitor under the cursor so the spinner lands on the
    // same screen the region overlay is about to open on.
    let monitor_idx = capture::cursor_monitor()
        .ok()
        .flatten()
        .or_else(|| *state.monitor_index.lock());
    *state.monitor_index.lock() = monitor_idx;
    show_prep_indicator_inner(&app, monitor_idx)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrevWindow {
    prev_x: i32,
    prev_y: i32,
    prev_width: u32,
    prev_height: u32,
    prev_decorated: bool,
}

#[tauri::command]
fn leave_region_overlay(app: tauri::AppHandle, prev: PrevWindow) -> AppResult<()> {
    dlog!("[leave_region_overlay] restoring main window");
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| AppError::Other("main window missing".into()))?;

    win.set_always_on_top(false)
        .map_err(|e| AppError::Other(format!("set_always_on_top: {e}")))?;
    win.set_decorations(prev.prev_decorated)
        .map_err(|e| AppError::Other(format!("set_decorations: {e}")))?;
    win.set_resizable(true)
        .map_err(|e| AppError::Other(format!("set_resizable: {e}")))?;
    win.set_size(tauri::PhysicalSize::new(prev.prev_width, prev.prev_height))
        .map_err(|e| AppError::Other(format!("set_size: {e}")))?;
    win.set_position(tauri::PhysicalPosition::new(prev.prev_x, prev.prev_y))
        .map_err(|e| AppError::Other(format!("set_position: {e}")))?;
    Ok(())
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowRect {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    title: String,
}

/// List visible windows on the primary monitor for window-snapping in
/// the region-select overlay. `level` controls how aggressively we
/// search: `"low"` = only top-level windows with a title (chunky),
/// `"medium"` = all top-level visible windows (default),
/// `"high"` = top-level plus child windows one level deep (picks up
/// panels, toolbars, and editor regions inside host apps).
///
/// Returned in Z-order, topmost first. Children always come right
/// after their parent so the frontend's "first match wins" iteration
/// prefers the more specific sub-panel when the cursor is over it.
#[cfg(target_os = "windows")]
#[tauri::command]
fn list_visible_windows(
    app: tauri::AppHandle,
    level: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<Vec<WindowRect>> {
    use std::os::windows::ffi::OsStringExt;
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM, RECT};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumChildWindows, EnumWindows, GetWindowRect, GetWindowTextLengthW,
        GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
    };

    let level = level.as_deref().unwrap_or("medium");
    // min_size is the smallest window dimension we'll surface. Going
    // too small creates visual noise (tooltips, 1-px separators) but
    // too large hides useful panels. "high" goes aggressive enough to
    // pick up toolbar buttons and sidebar panes.
    let (min_size, include_children, require_title): (i32, bool, bool) = match level {
        "low" => (120, false, true),
        "high" => (8, true, false),
        _ => (40, false, false),
    };

    let monitor_idx = *state.monitor_index.lock();
    let (mon_w, mon_h, mon_x, mon_y, _scale) = capture::monitor_geometry(monitor_idx)?;
    let mon_x2 = mon_x + mon_w as i32;
    let mon_y2 = mon_y + mon_h as i32;

    extern "system" fn cb_top(hwnd: HWND, lparam: LPARAM) -> BOOL {
        unsafe {
            let out = &mut *(lparam.0 as *mut Vec<(HWND, RECT, String)>);
            if !IsWindowVisible(hwnd).as_bool() {
                return BOOL(1);
            }
            if IsIconic(hwnd).as_bool() {
                return BOOL(1);
            }
            let mut rect = RECT::default();
            if GetWindowRect(hwnd, &mut rect).is_err() {
                return BOOL(1);
            }
            let title_len = GetWindowTextLengthW(hwnd);
            let title = if title_len > 0 {
                let mut buf = vec![0u16; title_len as usize + 1];
                let n = GetWindowTextW(hwnd, &mut buf);
                let os = std::ffi::OsString::from_wide(&buf[..n as usize]);
                os.to_string_lossy().into_owned()
            } else {
                String::new()
            };
            out.push((hwnd, rect, title));
            BOOL(1)
        }
    }

    // Recursive descent: Windows sometimes only yields immediate
    // children. We re-invoke EnumChildWindows for each child so we
    // reliably reach the innermost leaf windows (editor areas inside
    // panels inside frames inside the host app).
    unsafe extern "system" fn cb_child(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let out = &mut *(lparam.0 as *mut Vec<(HWND, RECT)>);
        if !IsWindowVisible(hwnd).as_bool() {
            return BOOL(1);
        }
        let mut rect = RECT::default();
        if GetWindowRect(hwnd, &mut rect).is_ok() {
            out.push((hwnd, rect));
        }
        // Recurse into this child's own children.
        let _ = EnumChildWindows(Some(hwnd), Some(cb_child), lparam);
        BOOL(1)
    }

    let mut top_level: Vec<(HWND, RECT, String)> = Vec::new();
    unsafe {
        let _ = EnumWindows(Some(cb_top), LPARAM(&mut top_level as *mut _ as isize));
    }
    dlog!(
        "[list_visible_windows] level={level} top_level={} min={min_size}",
        top_level.len()
    );

    let self_pid = std::process::id();
    let mut out: Vec<WindowRect> = Vec::new();

    let push_if_valid =
        |out: &mut Vec<WindowRect>, rect: RECT, title: String, min_size: i32| {
            let x = rect.left.max(mon_x);
            let y = rect.top.max(mon_y);
            let x2 = rect.right.min(mon_x2);
            let y2 = rect.bottom.min(mon_y2);
            let w = (x2 - x).max(0);
            let h = (y2 - y).max(0);
            if w < min_size || h < min_size {
                return;
            }
            out.push(WindowRect {
                x,
                y,
                width: w as u32,
                height: h as u32,
                title,
            });
        };

    for (hwnd, rect, title) in top_level {
        let mut pid: u32 = 0;
        unsafe {
            let _ = GetWindowThreadProcessId(hwnd, Some(&mut pid));
        }
        if pid == self_pid {
            continue;
        }
        if require_title && title.trim().is_empty() {
            continue;
        }

        let raw_w = rect.right - rect.left;
        let raw_h = rect.bottom - rect.top;
        if raw_w >= min_size && raw_h >= min_size {
            push_if_valid(&mut out, rect, title.clone(), min_size);
        }

        if include_children {
            let mut kids: Vec<(HWND, RECT)> = Vec::new();
            unsafe {
                let _ = EnumChildWindows(
                    Some(hwnd),
                    Some(cb_child),
                    LPARAM(&mut kids as *mut _ as isize),
                );
            }
            dlog!(
                "[list_visible_windows] parent '{}' has {} raw children",
                title,
                kids.len()
            );
            // Children should appear BEFORE their parent in the
            // first-match-wins iteration so the more-specific sub-
            // panel snaps instead of the host window. The simplest
            // way: push children, then find the parent's entry in the
            // current out (last pushed above) and swap it to the end
            // of the segment. Equivalent, simpler: just push children
            // first, then re-push the parent. But we've already
            // pushed the parent. Swap.
            let parent_idx = out.len().checked_sub(1);
            let insert_at = out.len();
            for (_, r) in kids {
                push_if_valid(&mut out, r, String::new(), min_size);
            }
            if let Some(pi) = parent_idx {
                if out.len() > insert_at && pi == insert_at - 1 {
                    // Move the parent entry to after its children.
                    let parent_entry = out.remove(pi);
                    out.push(parent_entry);
                }
            }
        }
    }
    // Image-based rectangle detection, only at "high" aggressiveness.
    // OS window enumeration can't see sub-panels inside apps that
    // render their own UI (WebView2 / Electron / WPF / custom draws),
    // so for those we fall back to finding axis-aligned regions in
    // the overlay screenshot. Appended after OS windows — the
    // frontend picks the smallest matching rect under the cursor, so
    // image rects win when they're more specific than the host window.
    if level == "high" {
        let bg = {
            let state = app.state::<AppState>();
            let guard = state.overlay_bg_path.lock();
            guard.clone()
        };
        if let Some(path) = bg {
            let t = std::time::Instant::now();
            let detected = rect_detect::detect(&path, min_size as u32);
            dlog!(
                "[list_visible_windows] image detection found {} rects in {:?}",
                detected.len(),
                t.elapsed()
            );
            for r in detected {
                let x = r.x.max(mon_x);
                let y = r.y.max(mon_y);
                let x2 = (r.x + r.width as i32).min(mon_x2);
                let y2 = (r.y + r.height as i32).min(mon_y2);
                let w = (x2 - x).max(0);
                let h = (y2 - y).max(0);
                if w < min_size || h < min_size {
                    continue;
                }
                out.push(WindowRect {
                    x,
                    y,
                    width: w as u32,
                    height: h as u32,
                    title: String::new(),
                });
            }
        }
    }

    dlog!("[list_visible_windows] final count={}", out.len());
    Ok(out)
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn list_visible_windows(_level: Option<String>) -> AppResult<Vec<WindowRect>> {
    Ok(Vec::new())
}

#[tauri::command]
fn get_overlay_background(state: State<'_, AppState>) -> Option<String> {
    state
        .overlay_bg_path
        .lock()
        .as_ref()
        .map(|p| p.to_string_lossy().into_owned())
}

/// Position the pre-created indicator window to frame the given region
/// (physical pixels) and show it. Adds a small border margin so the
/// frame sits just outside the captured area — the red outline itself
/// won't be inside any region captures.
#[tauri::command]
fn show_recording_indicator(
    app: tauri::AppHandle,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    state: State<'_, AppState>,
) -> AppResult<()> {
    dlog!("[show_recording_indicator] region={x},{y} {width}x{height}");
    let win = app.get_webview_window("indicator").ok_or_else(|| {
        dlog!("[show_recording_indicator] indicator window missing");
        AppError::Other("indicator window missing".into())
    })?;

    let monitor_idx = *state.monitor_index.lock();
    let (mw, mh, mx, my, scale) = capture::monitor_geometry(monitor_idx)?;
    let scale_f = if scale > 0.0 { scale } else { 1.0 };
    let scale = scale_f as f64;

    let mon_lx = mx as f64 / scale;
    let mon_ly = my as f64 / scale;
    let mon_lw = mw as f64 / scale;
    let mon_lh = mh as f64 / scale;

    win.set_size(tauri::LogicalSize::new(mon_lw, mon_lh))
        .map_err(|e| AppError::Other(format!("indicator set_size: {e}")))?;
    win.set_position(tauri::LogicalPosition::new(mon_lx, mon_ly))
        .map_err(|e| AppError::Other(format!("indicator set_position: {e}")))?;
    win.show()
        .map_err(|e| AppError::Other(format!("indicator show: {e}")))?;
    let _ = win.set_always_on_top(true);
    let _ = win.set_ignore_cursor_events(true);

    let ir = IndicatorRegion {
        x,
        y,
        width,
        height,
        scale: scale_f,
    };
    *state.indicator_region.lock() = Some(ir);

    let _ = win.emit("indicator-region", ir);

    // Flip the watchdog flag so the background thread starts forcing
    // the indicator back to the top of Windows' topmost stack.
    state
        .indicator_visible
        .store(true, std::sync::atomic::Ordering::SeqCst);
    raise_indicator_now(&app);

    dlog!(
        "[show_recording_indicator] window fullscreen at ({mon_lx},{mon_ly}) {mon_lw}x{mon_lh}"
    );
    Ok(())
}

/// Re-raise the indicator window within the Windows topmost group
/// so other always-on-top windows don't obscure it. No-op on other
/// platforms — the layering behaviour doesn't have the same issue.
#[cfg(target_os = "windows")]
fn raise_indicator_now(app: &tauri::AppHandle) {
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    };
    if let Some(win) = app.get_webview_window("indicator") {
        if let Ok(hwnd) = win.hwnd() {
            unsafe {
                let _ = SetWindowPos(
                    hwnd,
                    Some(HWND_TOPMOST),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                );
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn raise_indicator_now(_app: &tauri::AppHandle) {}

#[tauri::command]
fn get_indicator_region(state: State<'_, AppState>) -> Option<IndicatorRegion> {
    *state.indicator_region.lock()
}

/// Read (and consume) any file path passed on the command line. The
/// frontend calls this on mount to auto-open a double-clicked GIF.
#[tauri::command]
fn take_pending_file(state: State<'_, AppState>) -> Option<String> {
    state.pending_file.lock().take()
}

/// Extract the first GIF path from a CLI arg list. The first element
/// is usually the exe path, so skip it.
fn find_gif_arg(args: &[String]) -> Option<String> {
    args.iter()
        .skip(1)
        .find(|a| a.to_ascii_lowercase().ends_with(".gif"))
        .filter(|a| std::path::Path::new(a).is_file())
        .cloned()
}

#[tauri::command]
fn hide_recording_indicator(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> AppResult<()> {
    dlog!("[hide_recording_indicator]");
    *state.indicator_region.lock() = None;
    state
        .indicator_visible
        .store(false, std::sync::atomic::Ordering::SeqCst);
    if let Some(win) = app.get_webview_window("indicator") {
        win.hide()
            .map_err(|e| AppError::Other(format!("indicator hide: {e}")))?;
    } else {
        dlog!("[hide_recording_indicator] indicator window missing");
    }
    Ok(())
}

#[tauri::command]
fn show_main_window(app: tauri::AppHandle) -> AppResult<()> {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
    Ok(())
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show Glattice", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let icon = app
        .default_window_icon()
        .cloned()
        .unwrap_or_else(|| Image::new_owned(vec![0; 4], 1, 1));

    TrayIconBuilder::with_id("glattice-tray")
        .icon(icon)
        .tooltip("Glattice")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { .. } = event {
                if let Some(w) = tray.app_handle().get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.unminimize();
                    let _ = w.set_focus();
                }
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.unminimize();
                    let _ = w.set_focus();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // We run under the Windows GUI subsystem so stdout/stderr are not
    // attached to a console. Route panic info into debug.log instead so
    // diagnostic output is never lost.
    std::panic::set_hook(Box::new(|info| {
        dlog!("PANIC {info}");
    }));

    let toggle_shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyR);

    tauri::Builder::default()
        // Must be registered first per the plugin's docs — intercepts a
        // second launch before window creation would normally spawn a
        // duplicate instance.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            dlog!("[single-instance] re-launched with args={args:?}");
            if let Some(gif) = find_gif_arg(&args) {
                let state = app.state::<AppState>();
                *state.pending_file.lock() = Some(gif);
                let _ = app.emit("open-file-requested", ());
            }
            // Focus the main window so the user knows something happened.
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed && shortcut == &toggle_shortcut {
                        let _ = app.emit("toggle-recording", ());
                    }
                })
                .build(),
        )
        .manage(AppState::new())
        .setup(move |app| {
            if let Ok(cache) = app.path().app_cache_dir() {
                let _ = std::fs::create_dir_all(cache.join("recordings"));
                debug_log::set_path(cache.join("recordings").join("debug.log"));
            }
            dlog!("[setup] begin");
            app.global_shortcut().register(toggle_shortcut)?;
            dlog!("[setup] global shortcut registered");
            build_tray(app.handle())?;
            dlog!("[setup] tray built");

            let args: Vec<String> = std::env::args().collect();
            if let Some(gif) = find_gif_arg(&args) {
                dlog!("[setup] initial gif arg: {gif}");
                let state = app.state::<AppState>();
                *state.pending_file.lock() = Some(gif);
            }

            // Watchdog: while the recording indicator is supposed to be
            // visible, periodically re-raise it to the top of Windows'
            // topmost group so no other always-on-top window occludes it.
            let watchdog_handle = app.handle().clone();
            let visible_flag = app
                .state::<AppState>()
                .indicator_visible
                .clone();
            std::thread::spawn(move || loop {
                if visible_flag.load(std::sync::atomic::Ordering::SeqCst) {
                    raise_indicator_now(&watchdog_handle);
                }
                std::thread::sleep(std::time::Duration::from_millis(400));
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            platform_check,
            is_recording,
            start_recording,
            stop_recording,
            load_gif,
            generate_sprite_sheet,
            get_region,
            set_region,
            clear_region,
            primary_monitor,
            list_monitors,
            set_monitor,
            list_input_events,
            start_file_drag,
            precapture_overlay_bg,
            enter_region_overlay,
            leave_region_overlay,
            show_prep_indicator,
            show_main_window,
            list_frame_thumbs,
            list_player_frames,
            list_visible_windows,
            get_overlay_background,
            show_recording_indicator,
            hide_recording_indicator,
            get_indicator_region,
            take_pending_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
