//! Test-only helpers for building throwaway git repositories.
//!
//! Compiled only under `cfg(test)`. Each [`TestRepo`] is a real on-disk git
//! repo in a tempdir with a `main` branch and one initial commit, plus a
//! separate temp root for sibling worktrees.

#![cfg(test)]

use std::path::{Path, PathBuf};
use std::process::Command;

use tempfile::TempDir;

pub struct TestRepo {
    dir: TempDir,
    /// Separate root for sibling worktrees (kept alive for the test).
    wt_root: TempDir,
}

impl TestRepo {
    /// Create a repo with a `main` branch and an initial commit.
    pub fn new() -> Self {
        let dir = TempDir::new().expect("tempdir");
        let repo = Self {
            dir,
            wt_root: TempDir::new().expect("wt tempdir"),
        };
        repo.git(&["init", "-b", "main"]);
        repo.git(&["config", "user.email", "test@quay.dev"]);
        repo.git(&["config", "user.name", "Quay Test"]);
        // Some environments need this for worktree ops in CI sandboxes.
        repo.git(&["config", "commit.gpgsign", "false"]);
        repo.write_commit("README.md", "# initial\n", "initial commit");
        repo
    }

    pub fn path(&self) -> &Path {
        self.dir.path()
    }

    /// Path for a worktree living outside the repo, under the wt root.
    pub fn sibling(&self, name: &str) -> PathBuf {
        self.wt_root.path().join(name)
    }

    /// Run a git command in the repo, asserting success.
    pub fn git(&self, args: &[&str]) -> String {
        let out = Command::new("git")
            .current_dir(self.dir.path())
            .args(args)
            .output()
            .expect("run git");
        assert!(
            out.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8_lossy(&out.stdout).into_owned()
    }

    /// Write `contents` to `file` and commit it with `msg`.
    pub fn write_commit(&self, file: &str, contents: &str, msg: &str) {
        std::fs::write(self.dir.path().join(file), contents).expect("write file");
        self.git(&["add", file]);
        self.git(&["commit", "-m", msg]);
    }

    /// Create and check out a new branch off the current HEAD.
    pub fn checkout_new_branch(&self, name: &str) {
        self.git(&["checkout", "-b", name]);
    }
}
