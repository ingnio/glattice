use std::path::Path;

use image::{
    codecs::png::PngEncoder, imageops::FilterType, ColorType, ImageEncoder, RgbaImage,
};
use rayon::prelude::*;

use crate::{
    capture::{CapturedFrame, Recording},
    error::{AppError, AppResult},
};

/// Maximum thumbnail width. Height derived from aspect ratio.
/// Sized so that HiDPI grid cells (~140px CSS × 2 DPR) render crisply
/// without upscaling; full-resolution playback lives in `player_frames`.
const THUMB_MAX_W: u32 = 320;

/// Write one PNG thumbnail per frame into `dir`. Files are named
/// `{index:04}.png` so callers can reconstruct paths from indices
/// without keeping a return list in memory. Removes any files already
/// present in `dir`. Resize + encode runs across the rayon thread pool.
pub fn generate_thumbs<F>(recording: &Recording, dir: &Path, mut on_progress: F) -> AppResult<()>
where
    F: FnMut(u32, u32),
{
    if dir.exists() {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    } else {
        std::fs::create_dir_all(dir)?;
    }

    use std::sync::atomic::{AtomicU32, Ordering};
    let total = recording.frames.len() as u32;
    let done = AtomicU32::new(0);

    // rayon's par_iter doesn't let us thread through FnMut cheaply, so
    // we collect errors and progress via shared state and report them
    // sequentially after the parallel stage completes.
    let results: Vec<AppResult<()>> = recording
        .frames
        .par_iter()
        .enumerate()
        .map(|(i, frame)| -> AppResult<()> {
            render_one_thumb(i, frame, dir)?;
            done.fetch_add(1, Ordering::Relaxed);
            Ok(())
        })
        .collect();

    for r in results {
        r?;
    }

    // Emit one progress event at the end so callers have a consistent
    // total. Fine-grained updates would require a callback into rayon's
    // worker threads (&dyn Sync Fn), which the current AppHandle::emit
    // signature satisfies — but we keep this simple for now.
    on_progress(total, total);
    let _ = &done; // kept for potential future fine-grained progress
    Ok(())
}

fn render_one_thumb(i: usize, frame: &CapturedFrame, dir: &Path) -> AppResult<()> {
    if frame.width == 0 || frame.height == 0 {
        return Ok(());
    }
    let src = RgbaImage::from_raw(frame.width, frame.height, frame.rgba.clone())
        .ok_or_else(|| AppError::InvalidConfig("frame buffer size mismatch".into()))?;

    let (tw, th) = if frame.width <= THUMB_MAX_W {
        (frame.width, frame.height)
    } else {
        let scale = THUMB_MAX_W as f32 / frame.width as f32;
        let tw = THUMB_MAX_W;
        let th = ((frame.height as f32) * scale).round().max(1.0) as u32;
        (tw, th)
    };

    let thumb = if tw == frame.width && th == frame.height {
        src
    } else {
        // Lanczos3 preserves text/UI edges much better than Triangle;
        // the thumbs are small so the extra cost is negligible.
        image::imageops::resize(&src, tw, th, FilterType::Lanczos3)
    };

    let path = dir.join(format!("{i:04}.png"));
    let file = std::fs::File::create(&path)?;
    PngEncoder::new(file).write_image(thumb.as_raw(), tw, th, ColorType::Rgba8.into())?;
    Ok(())
}

/// Write each captured frame as a full-resolution PNG. Used by the
/// player/zoom view which needs crisp pixels at arbitrary display
/// sizes. Much more disk use than thumbs, but only one per source
/// lives on disk at a time (previous source's files are cleared).
pub fn generate_player_frames(recording: &Recording, dir: &Path) -> AppResult<()> {
    if dir.exists() {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    } else {
        std::fs::create_dir_all(dir)?;
    }

    let results: Vec<AppResult<()>> = recording
        .frames
        .par_iter()
        .enumerate()
        .map(|(i, frame)| -> AppResult<()> {
            if frame.width == 0 || frame.height == 0 {
                return Ok(());
            }
            let path = dir.join(format!("{i:04}.png"));
            let file = std::fs::File::create(&path)?;
            PngEncoder::new(file).write_image(
                &frame.rgba,
                frame.width,
                frame.height,
                ColorType::Rgba8.into(),
            )?;
            Ok(())
        })
        .collect();

    for r in results {
        r?;
    }
    Ok(())
}
