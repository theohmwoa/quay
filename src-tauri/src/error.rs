//! Shared error type for the quay core.
//!
//! Everything fallible in the core returns [`Result`]. The error is
//! serializable so it can cross the Tauri command boundary into the
//! frontend as a plain string payload.

use serde::Serialize;

/// The single error type used across quay's Rust core.
#[derive(Debug, thiserror::Error)]
pub enum QuayError {
    #[error("git command failed: {0}")]
    Git(String),

    #[error(transparent)]
    LibGit(#[from] git2::Error),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("pty error: {0}")]
    Pty(String),

    #[error("narrator error: {0}")]
    Narrator(String),

    #[error("invalid input: {0}")]
    Invalid(String),
}

/// Convenience alias used throughout the core.
pub type Result<T> = std::result::Result<T, QuayError>;

// Tauri commands need errors to serialize. We render to the Display string,
// which keeps the frontend payload simple and human-readable.
impl Serialize for QuayError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
