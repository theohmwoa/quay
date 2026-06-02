//! Persisting the deck across app restarts.
//!
//! We save the open repo, base branch, and the list of terminal sessions to a
//! small JSON file in the app's data directory, and restore it on launch. The
//! (de)serialization and file I/O are pure/standalone here; the command layer
//! supplies the on-disk path from Tauri's app-data directory.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::{QuayError, Result};

/// One persisted terminal session (mirrors the frontend's Session).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PersistedSession {
    pub path: String,
    pub program: String,
}

/// The whole restorable deck state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PersistedState {
    #[serde(default)]
    pub repo_path: String,
    #[serde(default = "default_base")]
    pub base: String,
    #[serde(default)]
    pub sessions: Vec<PersistedSession>,
}

fn default_base() -> String {
    "main".to_string()
}

// Manual Default so it matches the serde defaults (base = "main"), keeping
// `load()` of a missing file consistent with parsing an empty object.
impl Default for PersistedState {
    fn default() -> Self {
        Self {
            repo_path: String::new(),
            base: default_base(),
            sessions: Vec::new(),
        }
    }
}

impl PersistedState {
    pub fn to_json(&self) -> Result<String> {
        serde_json::to_string_pretty(self)
            .map_err(|e| QuayError::Invalid(format!("serialize state: {e}")))
    }

    pub fn from_json(s: &str) -> Result<Self> {
        serde_json::from_str(s).map_err(|e| QuayError::Invalid(format!("parse state: {e}")))
    }
}

/// Write the state to `path`, creating parent directories as needed.
pub fn save(path: &Path, state: &PersistedState) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, state.to_json()?)?;
    Ok(())
}

/// Load the state from `path`. A missing file yields the default state, so
/// first launch is not an error.
pub fn load(path: &Path) -> Result<PersistedState> {
    match std::fs::read_to_string(path) {
        Ok(s) => PersistedState::from_json(&s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(PersistedState::default()),
        Err(e) => Err(QuayError::Io(e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> PersistedState {
        PersistedState {
            repo_path: "/repo".into(),
            base: "main".into(),
            sessions: vec![
                PersistedSession { path: "/repo/wt-a".into(), program: "claude".into() },
                PersistedSession { path: "/repo/wt-b".into(), program: "shell".into() },
            ],
        }
    }

    #[test]
    fn json_round_trips() {
        let s = sample();
        let restored = PersistedState::from_json(&s.to_json().unwrap()).unwrap();
        assert_eq!(s, restored);
    }

    #[test]
    fn save_then_load_recovers_state() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("nested/state.json");
        save(&path, &sample()).unwrap();
        assert_eq!(load(&path).unwrap(), sample());
    }

    #[test]
    fn missing_file_loads_default() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("nope.json");
        let st = load(&path).unwrap();
        assert_eq!(st, PersistedState::default());
        assert_eq!(st.base, "main");
    }

    #[test]
    fn missing_fields_fall_back() {
        // Forward/backward compatibility: a partial file still loads.
        let st = PersistedState::from_json(r#"{"repo_path":"/r"}"#).unwrap();
        assert_eq!(st.repo_path, "/r");
        assert_eq!(st.base, "main");
        assert!(st.sessions.is_empty());
    }
}
