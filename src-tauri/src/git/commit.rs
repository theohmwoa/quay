//! Staging and committing an agent's work.
//!
//! Shell out to `git` for the index/commit operations (robust, matches what
//! the user would do by hand). The commit *message* is generated separately by
//! the narrator (see `crate::narrate`) — a cheap Haiku "smart sprinkle", with
//! an offline fallback.

use std::path::Path;
use std::process::Command;

use crate::error::{QuayError, Result};

fn git(cwd: &Path, args: &[&str]) -> Result<String> {
    let output = Command::new("git").current_dir(cwd).args(args).output()?;
    if !output.status.success() {
        return Err(QuayError::Git(format!(
            "`git {}` failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Stage every change (tracked + untracked) in the worktree.
pub fn stage_all(repo_path: &Path) -> Result<()> {
    git(repo_path, &["add", "-A"])?;
    Ok(())
}

/// Commit the staged index with `message`. Errors if `message` is empty.
pub fn commit(repo_path: &Path, message: &str) -> Result<String> {
    if message.trim().is_empty() {
        return Err(QuayError::Invalid("empty commit message".into()));
    }
    git(repo_path, &["commit", "-m", message])?;
    Ok(git(repo_path, &["rev-parse", "--short", "HEAD"])?
        .trim()
        .to_string())
}

/// Stage everything and commit it; returns the new short commit sha.
pub fn stage_and_commit(repo_path: &Path, message: &str) -> Result<String> {
    stage_all(repo_path)?;
    commit(repo_path, message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::status::worktree_status;
    use crate::testutil::TestRepo;

    #[test]
    fn stage_and_commit_clears_the_worktree() {
        let repo = TestRepo::new();
        repo.checkout_new_branch("feature");
        std::fs::write(repo.path().join("work.txt"), "agent work\n").unwrap();

        let before = worktree_status(repo.path(), "main").unwrap();
        assert!(!before.clean);

        let sha = stage_and_commit(repo.path(), "Add agent work").unwrap();
        assert!(!sha.is_empty());

        let after = worktree_status(repo.path(), "main").unwrap();
        assert!(after.clean);
        assert_eq!(after.ahead, 1);

        let log = repo.git(&["log", "-1", "--pretty=%s"]);
        assert_eq!(log.trim(), "Add agent work");
    }

    #[test]
    fn empty_message_is_rejected() {
        let repo = TestRepo::new();
        std::fs::write(repo.path().join("x.txt"), "x").unwrap();
        stage_all(repo.path()).unwrap();
        assert!(matches!(
            commit(repo.path(), "   ").unwrap_err(),
            QuayError::Invalid(_)
        ));
    }
}
