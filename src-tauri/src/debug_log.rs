//! Tiny file-based logger so diagnostic traces survive even when
//! stdout/stderr are lost (Tauri dev wrapping, Windows console subsystem
//! quirks). Log file lives next to the recordings at
//! `$APPCACHE/recordings/debug.log` once the app handle is available,
//! and falls back to the temp dir before the handle exists.

use std::{
    fs::OpenOptions,
    io::Write,
    path::PathBuf,
    sync::{Mutex, OnceLock},
    time::SystemTime,
};

static LOG_PATH: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();

fn path_slot() -> &'static Mutex<Option<PathBuf>> {
    LOG_PATH.get_or_init(|| Mutex::new(None))
}

pub fn set_path(p: PathBuf) {
    let mut guard = path_slot().lock().unwrap();
    *guard = Some(p);
}

fn resolve_path() -> PathBuf {
    if let Some(p) = path_slot().lock().unwrap().as_ref() {
        return p.clone();
    }
    std::env::temp_dir().join("glattice-debug.log")
}

fn ts() -> String {
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0);
    format!("{now:.3}")
}

pub fn log(line: &str) {
    let path = resolve_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "[{}] {}", ts(), line);
        let _ = f.flush();
    }
    eprintln!("[{}] {}", ts(), line);
}

#[macro_export]
macro_rules! dlog {
    ($($arg:tt)*) => {
        $crate::debug_log::log(&format!($($arg)*))
    };
}
