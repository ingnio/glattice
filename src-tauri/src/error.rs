use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("screen capture is not supported on this platform")]
    CaptureUnsupported,

    #[error("screen recording permission was not granted")]
    PermissionDenied,

    #[error("a recording is already in progress")]
    AlreadyRecording,

    #[error("no recording is in progress")]
    NotRecording,

    #[error("no frames were captured")]
    NoFrames,

    #[error("no GIF is loaded")]
    NoGifLoaded,

    #[error("invalid configuration: {0}")]
    InvalidConfig(String),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("gif error: {0}")]
    Gif(#[from] gif::EncodingError),

    #[error("gif decode error: {0}")]
    GifDecode(#[from] gif::DecodingError),

    #[error("image error: {0}")]
    Image(#[from] image::ImageError),

    #[error("{0}")]
    Other(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, s: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        s.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
