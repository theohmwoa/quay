//! PTY process spawning.
//!
//! Each agent gets a real pseudo-terminal running a process — a shell, or the
//! `claude` CLI — with its working directory pinned to a worktree. Output is
//! streamed over a channel so the command layer can forward it to the
//! frontend as terminal events; input and resize go back through the handle.

use std::io::{Read, Write};
use std::path::Path;
use std::sync::mpsc::{channel, Receiver};
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};

use crate::error::{QuayError, Result};
use crate::scrollback::ScrollbackBuffer;

/// Per-terminal scrollback retained for reattach/replay (256 KiB).
const SCROLLBACK_CAP: usize = 256 * 1024;

/// A live PTY: holds the master side, the child process, and a writer.
///
/// Output is delivered out-of-band via the [`Receiver`] returned from
/// [`spawn`]. Dropping the handle leaves the child running until [`kill`]
/// is called or the process exits on its own.
pub struct PtyHandle {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    scrollback: Arc<Mutex<ScrollbackBuffer>>,
}

fn pty_err<E: std::fmt::Display>(e: E) -> QuayError {
    QuayError::Pty(e.to_string())
}

/// Spawn `command` (with `args`) in a PTY whose working directory is `cwd`.
///
/// Returns the handle plus a receiver of raw output chunks. The reader runs
/// on its own thread; the channel closes when the process output reaches EOF.
pub fn spawn(
    cwd: &Path,
    command: &str,
    args: &[String],
    cols: u16,
    rows: u16,
) -> Result<(PtyHandle, Receiver<Vec<u8>>)> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(pty_err)?;

    let mut cmd = CommandBuilder::new(command);
    for arg in args {
        cmd.arg(arg);
    }
    cmd.cwd(cwd);

    let child = pair.slave.spawn_command(cmd).map_err(pty_err)?;
    // Drop the slave so the master observes EOF once the child exits.
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(pty_err)?;
    let writer = pair.master.take_writer().map_err(pty_err)?;

    let scrollback = Arc::new(Mutex::new(ScrollbackBuffer::new(SCROLLBACK_CAP)));
    let scrollback_writer = Arc::clone(&scrollback);

    let (tx, rx) = channel::<Vec<u8>>();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = &buf[..n];
                    if let Ok(mut sb) = scrollback_writer.lock() {
                        sb.push(chunk);
                    }
                    if tx.send(chunk.to_vec()).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    Ok((
        PtyHandle {
            master: pair.master,
            writer,
            child,
            scrollback,
        },
        rx,
    ))
}

impl PtyHandle {
    /// Write bytes to the process's stdin.
    pub fn write(&mut self, data: &[u8]) -> Result<()> {
        self.writer.write_all(data).map_err(QuayError::Io)?;
        self.writer.flush().map_err(QuayError::Io)
    }

    /// Resize the terminal.
    pub fn resize(&self, cols: u16, rows: u16) -> Result<()> {
        self.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(pty_err)
    }

    /// Terminate the child process.
    pub fn kill(&mut self) -> Result<()> {
        self.child.kill().map_err(QuayError::Io)
    }

    /// Snapshot of recent output for reattach/replay (oldest byte first).
    pub fn scrollback(&self) -> Vec<u8> {
        self.scrollback
            .lock()
            .map(|sb| sb.snapshot())
            .unwrap_or_default()
    }

    /// Non-blocking check of whether the child has exited.
    pub fn try_wait(&mut self) -> Result<Option<u32>> {
        match self.child.try_wait().map_err(QuayError::Io)? {
            Some(status) => Ok(Some(status.exit_code())),
            None => Ok(None),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::Receiver;
    use std::time::{Duration, Instant};

    /// Drain a receiver into a string for up to `ms` milliseconds.
    fn collect(rx: &Receiver<Vec<u8>>, ms: u64) -> String {
        let deadline = Instant::now() + Duration::from_millis(ms);
        let mut out = Vec::new();
        while Instant::now() < deadline {
            match rx.recv_timeout(Duration::from_millis(50)) {
                Ok(chunk) => out.extend_from_slice(&chunk),
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
        String::from_utf8_lossy(&out).into_owned()
    }

    #[test]
    fn captures_process_output() {
        let dir = std::env::temp_dir();
        let (_handle, rx) = spawn(
            &dir,
            "sh",
            &["-c".into(), "printf quay-pty-marker".into()],
            80,
            24,
        )
        .unwrap();
        let out = collect(&rx, 2000);
        assert!(
            out.contains("quay-pty-marker"),
            "expected marker in output, got: {out:?}"
        );
    }

    #[test]
    fn runs_in_the_given_directory() {
        let tmp = tempfile::TempDir::new().unwrap();
        std::fs::write(tmp.path().join("sentinel.txt"), "x").unwrap();
        let (_handle, rx) = spawn(tmp.path(), "sh", &["-c".into(), "ls".into()], 80, 24).unwrap();
        let out = collect(&rx, 2000);
        assert!(out.contains("sentinel.txt"), "got: {out:?}");
    }

    #[test]
    fn write_reaches_the_process() {
        let dir = std::env::temp_dir();
        // `cat` echoes stdin back to stdout.
        let (mut handle, rx) = spawn(&dir, "cat", &[], 80, 24).unwrap();
        handle.write(b"ping-pong\n").unwrap();
        let out = collect(&rx, 1500);
        handle.kill().unwrap();
        assert!(out.contains("ping-pong"), "got: {out:?}");
    }

    #[test]
    fn resize_succeeds() {
        let dir = std::env::temp_dir();
        let (handle, _rx) = spawn(&dir, "cat", &[], 80, 24).unwrap();
        assert!(handle.resize(120, 40).is_ok());
    }

    #[test]
    fn scrollback_captures_output_for_replay() {
        let dir = std::env::temp_dir();
        let (handle, rx) = spawn(
            &dir,
            "sh",
            &["-c".into(), "printf quay-replay-marker".into()],
            80,
            24,
        )
        .unwrap();
        // Drain so the reader thread has processed the output.
        let _ = collect(&rx, 2000);
        let replay = String::from_utf8_lossy(&handle.scrollback()).into_owned();
        assert!(
            replay.contains("quay-replay-marker"),
            "scrollback should retain output for reattach, got: {replay:?}"
        );
    }
}
