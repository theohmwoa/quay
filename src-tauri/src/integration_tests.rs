//! End-to-end test of quay's central loop, exercised at the core level:
//!
//!   create a worktree  ->  (agent does work)  ->  branch-vs-base diff
//!   ->  narrate the diff  ->  run a process in the worktree's PTY
//!
//! This is the whole reason the app exists, verified without a GUI.

#![cfg(test)]

use std::process::Command;
use std::sync::mpsc::Receiver;
use std::time::{Duration, Instant};

use crate::git::diff::{branch_vs_base, FileStatus};
use crate::git::worktree;
use crate::narrate::{AnyNarrator, MockNarrator};
use crate::pty;
use crate::testutil::TestRepo;

fn git_in(dir: &std::path::Path, args: &[&str]) {
    let out = Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .expect("run git");
    assert!(
        out.status.success(),
        "git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&out.stderr)
    );
}

fn drain(rx: &Receiver<Vec<u8>>, ms: u64) -> String {
    let deadline = Instant::now() + Duration::from_millis(ms);
    let mut out = Vec::new();
    while Instant::now() < deadline {
        match rx.recv_timeout(Duration::from_millis(50)) {
            Ok(c) => out.extend_from_slice(&c),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[test]
fn central_loop_worktree_diff_narrate_pty() {
    // 1. A repo with main + initial commit.
    let repo = TestRepo::new();

    // 2. Spin up an agent: a worktree on a fresh branch off main.
    let wt_path = repo.sibling("agent-login");
    let wt = worktree::create(repo.path(), &wt_path, "agent-login", "main").unwrap();
    assert_eq!(wt.branch.as_deref(), Some("agent-login"));
    assert!(!wt.is_main);

    // 3. The agent does some work in its worktree (simulated commits).
    git_in(&wt_path, &["config", "user.email", "agent@quay.dev"]);
    git_in(&wt_path, &["config", "user.name", "Agent"]);
    std::fs::write(
        wt_path.join("login.rs"),
        "pub fn login() -> bool {\n    true\n}\n",
    )
    .unwrap();
    git_in(&wt_path, &["add", "login.rs"]);
    git_in(&wt_path, &["commit", "-m", "add login"]);

    // 4. The whole-feature diff: branch vs main (merge-base), from the worktree.
    let diff = branch_vs_base(&wt_path, "main").unwrap();
    let login = diff
        .files
        .iter()
        .find(|f| f.path == "login.rs")
        .expect("login.rs in diff");
    assert_eq!(login.status, FileStatus::Added);
    assert!(login.additions >= 3);

    // 5. Narrate it (offline mock — deterministic, no credits/network).
    let narration = MockNarrator.narrate(&diff);
    assert!(narration.summary.contains("main"));
    assert!(narration
        .file_notes
        .iter()
        .any(|n| n.path == "login.rs" && n.note.contains("Added")));
    // The env-built narrator falls back to mock without a key.
    assert!(matches!(AnyNarrator::from_env(), AnyNarrator::Mock(_))
        || std::env::var("ANTHROPIC_API_KEY").is_ok());

    // 6. Run a process in the agent's PTY, rooted at the worktree.
    let (mut handle, rx) = pty::spawn(
        &wt_path,
        "sh",
        &["-c".into(), "ls && echo LOOP-OK".into()],
        80,
        24,
    )
    .unwrap();
    let output = drain(&rx, 3000);
    let _ = handle.kill();
    assert!(output.contains("login.rs"), "pty should see worktree files: {output:?}");
    assert!(output.contains("LOOP-OK"), "pty output: {output:?}");
}
