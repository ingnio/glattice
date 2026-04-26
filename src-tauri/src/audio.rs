//! Microphone capture for video recordings.
//!
//! cpal provides a callback-driven input stream. We build the stream
//! on a dedicated thread, push samples into a shared buffer as they
//! arrive, and on stop hand the buffer back to the capture pipeline.
//! Samples are normalised to interleaved f32 regardless of the
//! device's native format so the WAV writer downstream stays simple.

use cpal::{
    traits::{DeviceTrait, HostTrait, StreamTrait},
    SampleFormat, StreamConfig,
};
use parking_lot::Mutex;
use std::path::Path;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::thread::JoinHandle;

use crate::error::{AppError, AppResult};

pub struct AudioCapture {
    pub sample_rate: u32,
    pub channels: u16,
    pub samples_f32: Vec<f32>,
}

pub struct AudioRecorder {
    stop_flag: Arc<AtomicBool>,
    thread: Option<JoinHandle<AppResult<AudioCapture>>>,
}

impl AudioRecorder {
    /// Start a microphone-capture thread on the OS default input device.
    /// Errors from the audio subsystem (no device, permission denied,
    /// stream-build failure) bubble up via `stop` so the caller can
    /// keep the video capture going if audio fails.
    pub fn start() -> AppResult<Self> {
        let stop_flag = Arc::new(AtomicBool::new(false));
        let stop_flag_thread = stop_flag.clone();
        let thread = std::thread::spawn(move || -> AppResult<AudioCapture> {
            let host = cpal::default_host();
            let device = host
                .default_input_device()
                .ok_or_else(|| AppError::Other("no default audio input device".into()))?;
            let supported = device
                .default_input_config()
                .map_err(|e| AppError::Other(format!("default_input_config: {e}")))?;
            let sample_format = supported.sample_format();
            let config: StreamConfig = supported.into();
            let sample_rate = config.sample_rate.0;
            let channels = config.channels;

            let buffer = Arc::new(Mutex::new(Vec::<f32>::new()));
            let err_holder: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));

            let stream = match sample_format {
                SampleFormat::F32 => {
                    let buf = buffer.clone();
                    let err_h = err_holder.clone();
                    device
                        .build_input_stream(
                            &config,
                            move |data: &[f32], _| {
                                buf.lock().extend_from_slice(data);
                            },
                            move |err| {
                                *err_h.lock() = Some(err.to_string());
                            },
                            None,
                        )
                        .map_err(|e| AppError::Other(format!("build_input_stream f32: {e}")))?
                }
                SampleFormat::I16 => {
                    let buf = buffer.clone();
                    let err_h = err_holder.clone();
                    device
                        .build_input_stream(
                            &config,
                            move |data: &[i16], _| {
                                let mut b = buf.lock();
                                b.reserve(data.len());
                                for &s in data {
                                    b.push(s as f32 / i16::MAX as f32);
                                }
                            },
                            move |err| {
                                *err_h.lock() = Some(err.to_string());
                            },
                            None,
                        )
                        .map_err(|e| AppError::Other(format!("build_input_stream i16: {e}")))?
                }
                SampleFormat::U16 => {
                    let buf = buffer.clone();
                    let err_h = err_holder.clone();
                    device
                        .build_input_stream(
                            &config,
                            move |data: &[u16], _| {
                                let mut b = buf.lock();
                                b.reserve(data.len());
                                for &s in data {
                                    b.push((s as f32 - 32768.0) / 32768.0);
                                }
                            },
                            move |err| {
                                *err_h.lock() = Some(err.to_string());
                            },
                            None,
                        )
                        .map_err(|e| AppError::Other(format!("build_input_stream u16: {e}")))?
                }
                other => {
                    return Err(AppError::Other(format!(
                        "unsupported audio sample format: {other:?}"
                    )));
                }
            };

            stream
                .play()
                .map_err(|e| AppError::Other(format!("audio stream.play: {e}")))?;

            // Idle the thread until stop fires, then return what we
            // captured. cpal owns the stream lifetime; keeping it on
            // the stack until we drop ensures the callback keeps
            // running.
            while !stop_flag_thread.load(Ordering::SeqCst) {
                std::thread::sleep(std::time::Duration::from_millis(20));
                if let Some(err) = err_holder.lock().take() {
                    return Err(AppError::Other(format!("audio stream error: {err}")));
                }
            }
            drop(stream);

            let samples_f32 = std::mem::take(&mut *buffer.lock());
            Ok(AudioCapture {
                sample_rate,
                channels,
                samples_f32,
            })
        });

        Ok(Self {
            stop_flag,
            thread: Some(thread),
        })
    }

    pub fn stop(mut self) -> AppResult<AudioCapture> {
        self.stop_flag.store(true, Ordering::SeqCst);
        match self.thread.take() {
            Some(handle) => handle
                .join()
                .map_err(|_| AppError::Other("audio thread panicked".into()))?,
            None => Err(AppError::Other("audio recorder already stopped".into())),
        }
    }
}

/// Persist a captured PCM buffer to a 16-bit stereo WAV file.
///
/// WAV files with more than 2 channels require the WAVE_FORMAT_EXTENSIBLE
/// header extension, which Web Audio (WebView2) often rejects with
/// "Unable to decode audio data". We always downmix to ≤2 channels
/// before writing so the file is standard PCM that every decoder handles.
///
/// Downmix strategy: average channel pairs into L/R outputs so no signal
/// is lost regardless of how the device maps its channels.
pub fn write_wav(path: &Path, capture: &AudioCapture) -> AppResult<()> {
    let src_ch = capture.channels as usize;
    let out_ch: u16 = if src_ch <= 2 { src_ch as u16 } else { 2 };
    let spec = hound::WavSpec {
        channels: out_ch,
        sample_rate: capture.sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(path, spec)
        .map_err(|e| AppError::Other(format!("WavWriter::create: {e}")))?;

    if src_ch <= 2 {
        // Fast path — no downmix needed.
        for s in &capture.samples_f32 {
            let v = (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
            writer
                .write_sample(v)
                .map_err(|e| AppError::Other(format!("write_sample: {e}")))?;
        }
    } else {
        // Downmix: interleaved src_ch samples per frame → 2 output samples.
        // out[0] = average of src channels 0, 2, 4, …  (left-ish group)
        // out[1] = average of src channels 1, 3, 5, …  (right-ish group)
        let frames = capture.samples_f32.len() / src_ch;
        for f in 0..frames {
            for out in 0..2usize {
                let mut sum = 0.0f32;
                let mut count = 0usize;
                let mut src = out;
                while src < src_ch {
                    sum += capture.samples_f32[f * src_ch + src];
                    count += 1;
                    src += 2;
                }
                let avg = if count > 0 { sum / count as f32 } else { 0.0 };
                let v = (avg.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
                writer
                    .write_sample(v)
                    .map_err(|e| AppError::Other(format!("write_sample: {e}")))?;
            }
        }
    }
    writer
        .finalize()
        .map_err(|e| AppError::Other(format!("WavWriter::finalize: {e}")))?;
    Ok(())
}
