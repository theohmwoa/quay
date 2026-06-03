//! Running a Claude agent via the Agent SDK, kept alongside the CLI terminal.
//!
//! The SDK is a Node library, so we spawn a small Node sidecar
//! (`sidecar/agent-runner.mjs`) that runs `query()` in the worktree and emits
//! each SDK message as one line of NDJSON. This module spawns that process and
//! streams its stdout line-by-line; the command layer forwards each line to
//! the frontend. The streaming mechanism is generic so it's testable with a
//! fake command (no Node, no network, no credits).

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{channel, Receiver};

use serde_json::json;

use crate::error::{QuayError, Result};

/// A spawned streaming process; kill it to stop the agent.
pub struct AgentHandle {
    child: Child,
}

impl AgentHandle {
    pub fn kill(&mut self) -> Result<()> {
        self.child.kill().map_err(QuayError::Io)
    }
}

/// Spawn `command args` in `cwd`, streaming stdout line-by-line over a channel.
/// Generic on purpose: in production it runs the Node sidecar, in tests a fake.
pub fn stream_lines(
    command: &str,
    args: &[String],
    cwd: &Path,
) -> Result<(AgentHandle, Receiver<String>)> {
    let mut child = Command::new(command)
        .args(args)
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| QuayError::Pty(format!("spawn `{command}`: {e}")))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| QuayError::Pty("child has no stdout".into()))?;

    let (tx, rx) = channel::<String>();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(l) => {
                    if tx.send(l).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    Ok((AgentHandle { child }, rx))
}

/// Build the JSON payload passed to the sidecar.
pub fn build_payload(prompt: &str, cwd: &Path, model: Option<&str>) -> String {
    json!({
        "prompt": prompt,
        "cwd": cwd.to_string_lossy(),
        "model": model,
    })
    .to_string()
}

/// Locate the Node sidecar script: `$QUAY_SIDECAR`, else walk up from the
/// executable looking for `sidecar/agent-runner.mjs` (works in dev).
pub fn sidecar_path() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("QUAY_SIDECAR") {
        let pb = PathBuf::from(p);
        if pb.exists() {
            return Some(pb);
        }
    }
    let exe = std::env::current_exe().ok()?;
    for ancestor in exe.ancestors() {
        let cand = ancestor.join("sidecar").join("agent-runner.mjs");
        if cand.exists() {
            return Some(cand);
        }
    }
    None
}

/// Start an agent run: spawn the Node sidecar with the payload, streaming its
/// NDJSON output. Errors clearly if the sidecar can't be found.
pub fn start(prompt: &str, cwd: &Path, model: Option<&str>) -> Result<(AgentHandle, Receiver<String>)> {
    let sidecar = sidecar_path().ok_or_else(|| {
        QuayError::Invalid("agent sidecar not found (set QUAY_SIDECAR to agent-runner.mjs)".into())
    })?;
    let args = vec![
        sidecar.to_string_lossy().into_owned(),
        build_payload(prompt, cwd, model),
    ];
    stream_lines("node", &args, cwd)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::Receiver;
    use std::time::{Duration, Instant};

    fn collect(rx: &Receiver<String>, ms: u64) -> Vec<String> {
        let deadline = Instant::now() + Duration::from_millis(ms);
        let mut out = Vec::new();
        while Instant::now() < deadline {
            match rx.recv_timeout(Duration::from_millis(50)) {
                Ok(l) => out.push(l),
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
        out
    }

    #[test]
    fn streams_stdout_lines() {
        let dir = std::env::temp_dir();
        let (_h, rx) = stream_lines(
            "sh",
            &["-c".into(), "printf 'one\\ntwo\\nthree\\n'".into()],
            &dir,
        )
        .unwrap();
        let lines = collect(&rx, 2000);
        assert_eq!(lines, vec!["one", "two", "three"]);
    }

    #[test]
    fn streams_ndjson_like_a_real_agent_would() {
        let dir = std::env::temp_dir();
        let script = r#"printf '{"type":"quay_start"}\n{"type":"assistant"}\n{"type":"quay_done"}\n'"#;
        let (_h, rx) = stream_lines("sh", &["-c".into(), script.into()], &dir).unwrap();
        let lines = collect(&rx, 2000);
        assert_eq!(lines.len(), 3);
        assert!(lines[0].contains("quay_start"));
        assert!(lines[2].contains("quay_done"));
    }

    #[test]
    fn build_payload_contains_prompt_and_cwd() {
        let p = build_payload("fix the bug", Path::new("/repo/wt"), Some("claude-haiku-4-5"));
        let v: serde_json::Value = serde_json::from_str(&p).unwrap();
        assert_eq!(v["prompt"], "fix the bug");
        assert_eq!(v["cwd"], "/repo/wt");
        assert_eq!(v["model"], "claude-haiku-4-5");
    }

    #[test]
    fn build_payload_allows_null_model() {
        let p = build_payload("x", Path::new("/r"), None);
        let v: serde_json::Value = serde_json::from_str(&p).unwrap();
        assert!(v["model"].is_null());
    }

    #[test]
    fn kill_stops_a_long_running_stream() {
        let dir = std::env::temp_dir();
        let (mut h, _rx) = stream_lines("sh", &["-c".into(), "sleep 30".into()], &dir).unwrap();
        assert!(h.kill().is_ok());
    }
}
