//! Working-tree status for a worktree: what's changed, and how far the
//! branch has diverged from its base. Drives the agent-card badges and gates
//! the lifecycle actions (you can't commit a clean tree, can't land if behind).

use std::path::Path;

use git2::{Repository, Status, StatusOptions};
use serde::{Deserialize, Serialize};

use crate::error::{QuayError, Result};

/// Snapshot of a worktree's state relative to `base`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorktreeStatus {
    pub branch: Option<String>,
    /// Paths staged in the index (ready to commit).
    pub staged: Vec<String>,
    /// Tracked paths modified/deleted but not staged.
    pub unstaged: Vec<String>,
    /// Untracked paths.
    pub untracked: Vec<String>,
    /// Commits HEAD is ahead of `base` (the work this branch introduces).
    pub ahead: usize,
    /// Commits HEAD is behind `base` (work on base since divergence).
    pub behind: usize,
    /// True when there is nothing staged, unstaged, or untracked.
    pub clean: bool,
}

/// Compute the status of the worktree at `repo_path` relative to `base`.
pub fn worktree_status(repo_path: &Path, base: &str) -> Result<WorktreeStatus> {
    let repo = Repository::open(repo_path)?;

    let mut opts = StatusOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(true);
    let statuses = repo.statuses(Some(&mut opts))?;

    let mut staged = Vec::new();
    let mut unstaged = Vec::new();
    let mut untracked = Vec::new();

    for entry in statuses.iter() {
        let path = match entry.path() {
            Some(p) => p.to_string(),
            None => continue,
        };
        let s = entry.status();
        if s.intersects(
            Status::INDEX_NEW
                | Status::INDEX_MODIFIED
                | Status::INDEX_DELETED
                | Status::INDEX_RENAMED
                | Status::INDEX_TYPECHANGE,
        ) {
            staged.push(path.clone());
        }
        if s.contains(Status::WT_NEW) {
            untracked.push(path);
        } else if s.intersects(
            Status::WT_MODIFIED | Status::WT_DELETED | Status::WT_RENAMED | Status::WT_TYPECHANGE,
        ) {
            unstaged.push(path);
        }
    }

    let branch = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(str::to_string));

    let (ahead, behind) = ahead_behind(&repo, base).unwrap_or((0, 0));

    let clean = staged.is_empty() && unstaged.is_empty() && untracked.is_empty();
    Ok(WorktreeStatus {
        branch,
        staged,
        unstaged,
        untracked,
        ahead,
        behind,
        clean,
    })
}

/// (ahead, behind) of HEAD relative to `base`.
fn ahead_behind(repo: &Repository, base: &str) -> Result<(usize, usize)> {
    let head = repo.head()?.peel_to_commit()?.id();
    let base_oid = repo
        .revparse_single(base)
        .map_err(|_| QuayError::Invalid(format!("base ref `{base}` not found")))?
        .peel_to_commit()?
        .id();
    Ok(repo.graph_ahead_behind(head, base_oid)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TestRepo;

    #[test]
    fn clean_repo_is_clean_and_level() {
        let repo = TestRepo::new();
        let st = worktree_status(repo.path(), "main").unwrap();
        assert!(st.clean);
        assert_eq!(st.branch.as_deref(), Some("main"));
        assert_eq!((st.ahead, st.behind), (0, 0));
    }

    #[test]
    fn detects_untracked_file() {
        let repo = TestRepo::new();
        std::fs::write(repo.path().join("new.txt"), "hi").unwrap();
        let st = worktree_status(repo.path(), "main").unwrap();
        assert!(!st.clean);
        assert_eq!(st.untracked, vec!["new.txt"]);
        assert!(st.staged.is_empty());
    }

    #[test]
    fn detects_staged_file() {
        let repo = TestRepo::new();
        std::fs::write(repo.path().join("new.txt"), "hi").unwrap();
        repo.git(&["add", "new.txt"]);
        let st = worktree_status(repo.path(), "main").unwrap();
        assert_eq!(st.staged, vec!["new.txt"]);
        assert!(st.untracked.is_empty());
    }

    #[test]
    fn detects_unstaged_modification_of_tracked_file() {
        let repo = TestRepo::new();
        std::fs::write(repo.path().join("README.md"), "# changed\n").unwrap();
        let st = worktree_status(repo.path(), "main").unwrap();
        assert_eq!(st.unstaged, vec!["README.md"]);
    }

    #[test]
    fn reports_ahead_on_feature_branch() {
        let repo = TestRepo::new();
        repo.checkout_new_branch("feature");
        repo.write_commit("a.txt", "a\n", "commit a");
        repo.write_commit("b.txt", "b\n", "commit b");
        let st = worktree_status(repo.path(), "main").unwrap();
        assert_eq!(st.ahead, 2);
        assert_eq!(st.behind, 0);
        assert_eq!(st.branch.as_deref(), Some("feature"));
    }

    #[test]
    fn reports_behind_when_base_advanced() {
        let repo = TestRepo::new();
        repo.checkout_new_branch("feature");
        repo.write_commit("f.txt", "f\n", "feature commit");
        repo.git(&["checkout", "main"]);
        repo.write_commit("m1.txt", "m\n", "main 1");
        repo.write_commit("m2.txt", "m\n", "main 2");
        repo.git(&["checkout", "feature"]);
        let st = worktree_status(repo.path(), "main").unwrap();
        assert_eq!(st.ahead, 1);
        assert_eq!(st.behind, 2);
    }

    #[test]
    fn unknown_base_falls_back_to_zero() {
        let repo = TestRepo::new();
        let st = worktree_status(repo.path(), "does-not-exist").unwrap();
        // Status still computes; divergence is unknown -> 0/0.
        assert_eq!((st.ahead, st.behind), (0, 0));
    }
}
