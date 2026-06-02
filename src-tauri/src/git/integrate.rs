//! Landing an agent's work: merge a worktree's branch into the base branch,
//! detecting conflicts up front (and aborting cleanly if any), then optionally
//! removing the now-merged worktree.
//!
//! We shell out to `git` so the behavior matches exactly what the user would
//! get by hand, including merge-message conventions.

use std::path::Path;
use std::process::Command;

use serde::{Deserialize, Serialize};

use crate::error::{QuayError, Result};
use crate::git::worktree;

/// Outcome of an integration attempt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum IntegrateResult {
    /// Merged successfully; `sha` is the new (or unchanged) HEAD of base.
    Merged { sha: String },
    /// Already up to date — base already contains the branch. No-op.
    UpToDate { sha: String },
    /// Conflicts prevented the merge; it was aborted and `files` list them.
    Conflicts { files: Vec<String> },
}

/// Raw git invocation returning (success, stdout, stderr).
fn git_raw(cwd: &Path, args: &[&str]) -> Result<(bool, String, String)> {
    let out = Command::new("git").current_dir(cwd).args(args).output()?;
    Ok((
        out.status.success(),
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    ))
}

fn git_ok(cwd: &Path, args: &[&str]) -> Result<String> {
    let (ok, stdout, stderr) = git_raw(cwd, args)?;
    if !ok {
        return Err(QuayError::Git(format!(
            "`git {}` failed: {}",
            args.join(" "),
            stderr.trim()
        )));
    }
    Ok(stdout)
}

fn head_sha(cwd: &Path) -> Result<String> {
    Ok(git_ok(cwd, &["rev-parse", "--short", "HEAD"])?.trim().to_string())
}

/// Merge `branch` into `base` within the repository at `repo_path` (which must
/// have `base` checked out — typically the primary worktree). Conflicts are
/// detected and the merge aborted, leaving the tree clean either way.
pub fn integrate(repo_path: &Path, branch: &str, base: &str) -> Result<IntegrateResult> {
    // Ensure base is the checked-out branch we're merging into.
    git_ok(repo_path, &["checkout", base])?;

    // Attempt a non-committing merge so we can inspect the result first.
    let (ok, _out, err) =
        git_raw(repo_path, &["merge", "--no-ff", "--no-commit", branch])?;

    if ok {
        // Either staged-and-ready, or nothing to do (already up to date).
        if err.contains("up to date") || err.contains("up-to-date") {
            return Ok(IntegrateResult::UpToDate { sha: head_sha(repo_path)? });
        }
        // Is there anything staged to commit? If MERGE_HEAD exists, finalize.
        let merge_head_exists = git_raw(repo_path, &["rev-parse", "--verify", "MERGE_HEAD"])?.0;
        if !merge_head_exists {
            // Fast-forward or no-op left nothing pending.
            return Ok(IntegrateResult::UpToDate { sha: head_sha(repo_path)? });
        }
        git_ok(repo_path, &["commit", "--no-edit"])?;
        return Ok(IntegrateResult::Merged { sha: head_sha(repo_path)? });
    }

    // Merge failed — collect conflicted paths, then abort to restore a clean tree.
    let conflicts = git_raw(repo_path, &["diff", "--name-only", "--diff-filter=U"])?
        .1
        .lines()
        .map(str::to_string)
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>();
    let _ = git_raw(repo_path, &["merge", "--abort"]);

    if conflicts.is_empty() {
        // Failed for some non-conflict reason.
        return Err(QuayError::Git(format!("merge failed: {}", err.trim())));
    }
    Ok(IntegrateResult::Conflicts { files: conflicts })
}

/// Integrate `branch` into `base`, and on a successful (non-conflicting) merge
/// remove the worktree at `worktree_path`. Returns the integration result; the
/// worktree is left in place if there were conflicts.
pub fn land(
    repo_path: &Path,
    worktree_path: &Path,
    branch: &str,
    base: &str,
) -> Result<IntegrateResult> {
    let result = integrate(repo_path, branch, base)?;
    if matches!(result, IntegrateResult::Merged { .. } | IntegrateResult::UpToDate { .. }) {
        worktree::remove(repo_path, worktree_path, true)?;
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TestRepo;

    #[test]
    fn clean_merge_lands_the_branch() {
        let repo = TestRepo::new();
        repo.checkout_new_branch("feature");
        repo.write_commit("feature.txt", "feature\n", "add feature");
        repo.git(&["checkout", "main"]);

        let result = integrate(repo.path(), "feature", "main").unwrap();
        assert!(matches!(result, IntegrateResult::Merged { .. }));
        // main now contains the feature file.
        assert!(repo.path().join("feature.txt").exists());
    }

    #[test]
    fn conflicting_merge_is_detected_and_aborted() {
        let repo = TestRepo::new();
        // Common ancestor establishes the file.
        repo.write_commit("shared.txt", "base line\n", "add shared");
        repo.checkout_new_branch("feature");
        repo.write_commit("shared.txt", "feature line\n", "feature edits shared");
        repo.git(&["checkout", "main"]);
        repo.write_commit("shared.txt", "main line\n", "main edits shared");

        let result = integrate(repo.path(), "feature", "main").unwrap();
        match result {
            IntegrateResult::Conflicts { files } => {
                assert!(files.contains(&"shared.txt".to_string()));
            }
            other => panic!("expected conflicts, got {other:?}"),
        }
        // The tree was restored — no merge in progress, working tree clean.
        let status = repo.git(&["status", "--porcelain"]);
        assert!(status.trim().is_empty(), "tree not clean: {status:?}");
        assert!(!repo.path().join(".git/MERGE_HEAD").exists());
    }

    #[test]
    fn up_to_date_is_a_noop() {
        let repo = TestRepo::new();
        // Branch points at the same commit as main.
        repo.git(&["branch", "feature"]);
        let result = integrate(repo.path(), "feature", "main").unwrap();
        assert!(matches!(result, IntegrateResult::UpToDate { .. }));
    }

    #[test]
    fn land_removes_the_worktree_after_a_clean_merge() {
        let repo = TestRepo::new();
        let wt_path = repo.sibling("agent");
        worktree::create(repo.path(), &wt_path, "agent", "main").unwrap();
        // Do work in the worktree.
        std::fs::write(wt_path.join("done.txt"), "done\n").unwrap();
        let out = std::process::Command::new("git")
            .current_dir(&wt_path)
            .args(["add", "done.txt"])
            .output()
            .unwrap();
        assert!(out.status.success());
        let out = std::process::Command::new("git")
            .current_dir(&wt_path)
            .args(["commit", "-m", "work"])
            .output()
            .unwrap();
        assert!(out.status.success());

        let result = land(repo.path(), &wt_path, "agent", "main").unwrap();
        assert!(matches!(result, IntegrateResult::Merged { .. }));
        assert!(repo.path().join("done.txt").exists());
        // Worktree removed.
        assert_eq!(worktree::list(repo.path()).unwrap().len(), 1);
    }
}
