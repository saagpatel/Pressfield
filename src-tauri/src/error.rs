//! Typed backend errors. Tauri commands return these directly — the manual
//! `Serialize` impl renders them as a string for the webview.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("required environment variable {0} is not set")]
    MissingEnv(&'static str),

    #[error("internal state lock was poisoned")]
    LockPoisoned,
}

impl serde::Serialize for Error {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
