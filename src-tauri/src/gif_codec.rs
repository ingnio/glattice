use std::{fs::File, io::BufReader, path::Path};

use crate::{
    capture::{CapturedFrame, Recording},
    error::{AppError, AppResult},
};

pub struct DecodedFrame {
    pub width: u32,
    pub height: u32,
    /// Raw RGBA pixels, 4 bytes per pixel.
    pub rgba: Vec<u8>,
    /// Delay in centiseconds (GIF native unit).
    pub delay_cs: u16,
}

pub struct DecodedGif {
    pub width: u32,
    pub height: u32,
    pub frames: Vec<DecodedFrame>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Quality {
    Standard,
    High,
}

/// Whether this build includes the gifski high-quality encoder.
pub fn high_quality_available() -> bool {
    cfg!(feature = "gifski")
}

pub fn encode_recording<F>(
    recording: &Recording,
    path: &Path,
    quality: Quality,
    mut on_progress: F,
) -> AppResult<()>
where
    F: FnMut(u32, u32),
{
    match quality {
        Quality::Standard => encode_recording_standard(recording, path, &mut on_progress),
        Quality::High => encode_recording_high(recording, path, &mut on_progress),
    }
}

#[cfg(feature = "gifski")]
fn encode_recording_high<F: FnMut(u32, u32)>(
    recording: &Recording,
    path: &Path,
    on_progress: &mut F,
) -> AppResult<()> {
    use rgb::FromSlice;

    let first = recording.frames.first().ok_or(AppError::NoFrames)?;
    let width = first.width;
    let height = first.height;

    let settings = gifski::Settings {
        width: None,
        height: None,
        quality: 90,
        fast: false,
        repeat: gif::Repeat::Infinite,
    };
    let (collector, writer) =
        gifski::new(settings).map_err(|e| AppError::Other(format!("gifski::new: {e}")))?;

    let file = File::create(path)?;
    let writer_thread = std::thread::spawn(move || {
        struct NoReport;
        impl gifski::progress::ProgressReporter for NoReport {
            fn increase(&mut self) -> bool {
                true
            }
            fn done(&mut self, _msg: &str) {}
        }
        writer
            .write(file, &mut NoReport)
            .map_err(|e| format!("gifski writer: {e}"))
    });

    let total = recording.frames.len() as u32;
    for (i, frame) in recording.frames.iter().enumerate() {
        if frame.width != width || frame.height != height {
            continue;
        }
        let pixels: Vec<rgb::RGBA8> = frame.rgba.as_rgba().to_vec();
        let img = imgref::ImgVec::new(pixels, frame.width as usize, frame.height as usize);
        let pts = frame.elapsed_ms as f64 / 1000.0;
        collector
            .add_frame_rgba(i, img, pts)
            .map_err(|e| AppError::Other(format!("gifski add_frame: {e}")))?;
        on_progress(i as u32 + 1, total);
    }
    drop(collector);

    writer_thread
        .join()
        .map_err(|_| AppError::Other("gifski writer thread panicked".into()))?
        .map_err(AppError::Other)?;
    Ok(())
}

#[cfg(not(feature = "gifski"))]
fn encode_recording_high<F: FnMut(u32, u32)>(
    _recording: &Recording,
    _path: &Path,
    _on_progress: &mut F,
) -> AppResult<()> {
    Err(AppError::InvalidConfig(
        "high-quality encoding not available: rebuild with --features gifski (note: AGPL-3.0-or-later)".into(),
    ))
}

/// Encode a recording as an animated GIF using the MIT `gif` crate.
///
/// Per-frame color-palette quantization in `from_rgba_speed` is the hot
/// spot here (~3s/frame at 2560×1600 in debug builds). Quantization is
/// independent per frame, so we fan out with rayon; only the final
/// sequential write into the `gif::Encoder` is ordered.
fn encode_recording_standard<F: FnMut(u32, u32)>(
    recording: &Recording,
    path: &Path,
    on_progress: &mut F,
) -> AppResult<()> {
    use rayon::prelude::*;

    let first = recording.frames.first().ok_or(AppError::NoFrames)?;
    let width = first.width as u16;
    let height = first.height as u16;

    let delay_cs = ((100.0 / recording.fps as f32).round() as u16).max(2);

    struct QuantizedFrame {
        palette: Option<Vec<u8>>,
        buffer: Vec<u8>,
        transparent: Option<u8>,
    }

    let total = recording.frames.len() as u32;
    let quantized: Vec<QuantizedFrame> = recording
        .frames
        .par_iter()
        .filter(|f| f.width as u16 == width && f.height as u16 == height)
        .map(|frame| {
            let mut rgba = frame.rgba.clone();
            let q = gif::Frame::from_rgba_speed(width, height, &mut rgba, 10);
            QuantizedFrame {
                palette: q.palette.clone(),
                buffer: q.buffer.into_owned(),
                transparent: q.transparent,
            }
        })
        .collect();

    let file = File::create(path)?;
    let mut encoder = gif::Encoder::new(file, width, height, &[])?;
    encoder.set_repeat(gif::Repeat::Infinite)?;

    for (i, q) in quantized.into_iter().enumerate() {
        let gif_frame = gif::Frame {
            delay: delay_cs,
            dispose: gif::DisposalMethod::Keep,
            transparent: q.transparent,
            needs_user_input: false,
            top: 0,
            left: 0,
            width,
            height,
            interlaced: false,
            palette: q.palette,
            buffer: std::borrow::Cow::Owned(q.buffer),
        };
        encoder.write_frame(&gif_frame)?;
        on_progress(i as u32 + 1, total);
    }

    Ok(())
}

/// Decode an animated GIF from disk into its full RGBA frame list.
pub fn decode_gif_from_path(path: &Path) -> AppResult<DecodedGif> {
    let file = File::open(path)?;
    let reader = BufReader::new(file);
    let mut opts = gif::DecodeOptions::new();
    opts.set_color_output(gif::ColorOutput::RGBA);
    let mut decoder = opts.read_info(reader)?;

    let width = decoder.width() as u32;
    let height = decoder.height() as u32;

    // The frame buffer returned from read_next_frame can be smaller than
    // the canvas (GIFs support per-frame sub-rectangles with disposal).
    // We composite onto a canvas so every DecodedFrame is full-canvas.
    let mut canvas: Vec<u8> = vec![0u8; (width * height * 4) as usize];
    let mut prev_canvas: Option<Vec<u8>> = None;
    let mut frames: Vec<DecodedFrame> = Vec::new();

    while let Some(frame) = decoder.read_next_frame()? {
        let fx = frame.left as u32;
        let fy = frame.top as u32;
        let fw = frame.width as u32;
        let fh = frame.height as u32;
        let fbuf: &[u8] = frame.buffer.as_ref();

        // Snapshot the canvas for RestorePrevious if requested.
        if matches!(frame.dispose, gif::DisposalMethod::Previous) {
            prev_canvas = Some(canvas.clone());
        }

        // Paint this frame's sub-rectangle onto the canvas.
        for row in 0..fh {
            let canvas_y = fy + row;
            if canvas_y >= height {
                break;
            }
            let canvas_row_start = ((canvas_y * width + fx) * 4) as usize;
            let frame_row_start = (row * fw * 4) as usize;
            let copy_w = std::cmp::min(fw, width.saturating_sub(fx)) as usize;
            let dst = &mut canvas
                [canvas_row_start..canvas_row_start + copy_w * 4];
            let src = &fbuf[frame_row_start..frame_row_start + copy_w * 4];
            // Preserve alpha=0 pixels from existing canvas contents.
            for (d, s) in dst.chunks_exact_mut(4).zip(src.chunks_exact(4)) {
                if s[3] != 0 {
                    d.copy_from_slice(s);
                }
            }
        }

        frames.push(DecodedFrame {
            width,
            height,
            rgba: canvas.clone(),
            delay_cs: frame.delay,
        });

        // Apply disposal for the NEXT frame.
        match frame.dispose {
            gif::DisposalMethod::Background => {
                for row in 0..fh {
                    let canvas_y = fy + row;
                    if canvas_y >= height {
                        break;
                    }
                    let start = ((canvas_y * width + fx) * 4) as usize;
                    let copy_w = std::cmp::min(fw, width.saturating_sub(fx)) as usize;
                    for px in canvas[start..start + copy_w * 4].chunks_exact_mut(4) {
                        px.copy_from_slice(&[0, 0, 0, 0]);
                    }
                }
            }
            gif::DisposalMethod::Previous => {
                if let Some(snap) = prev_canvas.take() {
                    canvas = snap;
                }
            }
            _ => {}
        }
    }

    Ok(DecodedGif {
        width,
        height,
        frames,
    })
}

/// Convert a DecodedGif's frames into a Recording so the sprite-sheet
/// composer can treat live and imported sources identically.
pub fn recording_from_decoded_gif(decoded: DecodedGif) -> Recording {
    let frames: Vec<CapturedFrame> = decoded
        .frames
        .into_iter()
        .scan(0u32, |acc_ms, f| {
            let elapsed = *acc_ms;
            *acc_ms = acc_ms.saturating_add(f.delay_cs as u32 * 10);
            Some(CapturedFrame {
                width: f.width,
                height: f.height,
                rgba: f.rgba,
                elapsed_ms: elapsed,
                cursor: None,
            })
        })
        .collect();

    let inferred_fps = {
        let total_ms: u32 = frames
            .windows(2)
            .map(|w| w[1].elapsed_ms - w[0].elapsed_ms)
            .sum();
        if frames.len() > 1 && total_ms > 0 {
            let avg_ms = total_ms as f32 / (frames.len() as f32 - 1.0);
            (1000.0 / avg_ms).round().clamp(1.0, 60.0) as u32
        } else {
            10
        }
    };

    Recording {
        fps: inferred_fps,
        frames,
        input_events: Vec::new(),
        audio: None,
        cursor_baked: false,
    }
}

