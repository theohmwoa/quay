//! Git worktree management.
//!
//! We shell out to the `git` CLI here rather than using libgit2: worktree
//! creation/removal is far better supported by the porcelain CLI, and the
//! output of `git worktree list --porcelain` is stable and easy to parse.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};

use crate::error::{QuayError, Result};

/// A single git worktree as reported by `git worktree list --porcelain`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Worktree {
    /// Absolute path to the worktree's working directory.
    pub path: PathBuf,
    /// Short branch name (e.g. `feature-x`), or `None` if detached.
    pub branch: Option<String>,
    /// The commit the worktree currently points at.
    pub head: Option<String>,
    /// True for the repository's primary worktree.
    pub is_main: bool,
    /// True if the worktree is locked.
    pub locked: bool,
}

/// Run `git` with `args` inside `cwd`, returning stdout on success.
fn git(cwd: &Path, args: &[&str]) -> Result<String> {
    let output = Command::new("git").current_dir(cwd).args(args).output()?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(QuayError::Git(format!(
            "`git {}` failed: {}",
            args.join(" "),
            stderr.trim()
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// List all worktrees for the repository containing `repo_path`.
///
/// The first entry reported by git is always the main worktree.
pub fn list(repo_path: &Path) -> Result<Vec<Worktree>> {
    let out = git(repo_path, &["worktree", "list", "--porcelain"])?;
    Ok(parse_porcelain(&out))
}

/// Parse the output of `git worktree list --porcelain`.
///
/// Records are separated by blank lines. Each record begins with a
/// `worktree <path>` line, followed by optional `HEAD`, `branch`,
/// `bare`, `detached`, and `locked` lines.
fn parse_porcelain(out: &str) -> Vec<Worktree> {
    let mut worktrees = Vec::new();
    let mut current: Option<Worktree> = None;
    let mut first = true;

    for line in out.lines() {
        if let Some(path) = line.strip_prefix("worktree ") {
            if let Some(wt) = current.take() {
                worktrees.push(wt);
            }
            current = Some(Worktree {
                path: PathBuf::from(path),
                branch: None,
                head: None,
                // The first record is always the primary worktree.
                is_main: std::mem::take(&mut first),
                locked: false,
            });
        } else if let Some(head) = line.strip_prefix("HEAD ") {
            if let Some(wt) = current.as_mut() {
                wt.head = Some(head.to_string());
            }
        } else if let Some(branch) = line.strip_prefix("branch ") {
            if let Some(wt) = current.as_mut() {
                // git reports the full ref, e.g. refs/heads/feature-x.
                wt.branch = Some(branch.trim_start_matches("refs/heads/").to_string());
            }
        } else if line == "locked" || line.starts_with("locked ") {
            if let Some(wt) = current.as_mut() {
                wt.locked = true;
            }
        }
    }
    if let Some(wt) = current.take() {
        worktrees.push(wt);
    }
    worktrees
}

/// Create a new worktree at `path` on a brand-new branch `branch`, based on
/// `base` (a branch name or commit-ish). Returns the created [`Worktree`].
pub fn create(repo_path: &Path, path: &Path, branch: &str, base: &str) -> Result<Worktree> {
    if branch.trim().is_empty() {
        return Err(QuayError::Invalid("branch name is empty".into()));
    }
    let path_str = path.to_string_lossy();
    git(
        repo_path,
        &["worktree", "add", "-b", branch, &path_str, base],
    )?;

    // Return the freshly created worktree by locating it in the list.
    let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    list(repo_path)?
        .into_iter()
        .find(|wt| {
            std::fs::canonicalize(&wt.path).unwrap_or_else(|_| wt.path.clone()) == canonical
        })
        .ok_or_else(|| QuayError::Git("created worktree not found in list".into()))
}

/// Turn a free-text name into a filesystem/branch-safe slug.
///
/// Keeps alphanumerics, `-` and `_`; collapses any other run into a single
/// `-`; lowercases; trims leading/trailing separators.
pub fn slugify(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut last_dash = false;
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() || ch == '_' {
            out.push(ch.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

/// Remove the worktree at `path`. With `force`, removes even if dirty.
pub fn remove(repo_path: &Path, path: &Path, force: bool) -> Result<()> {
    let path_str = path.to_string_lossy();
    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.push(&path_str);
    git(repo_path, &args)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TestRepo;

    #[test]
    fn parses_porcelain_with_main_and_feature() {
        let out = "\
worktree /repo
HEAD abc123
branch refs/heads/main

worktree /repo-wt/feature
HEAD def456
branch refs/heads/feature
locked

";
        let wts = parse_porcelain(out);
        assert_eq!(wts.len(), 2);
        assert!(wts[0].is_main);
        assert_eq!(wts[0].branch.as_deref(), Some("main"));
        assert_eq!(wts[0].head.as_deref(), Some("abc123"));
        assert!(!wts[1].is_main);
        assert_eq!(wts[1].branch.as_deref(), Some("feature"));
        assert!(wts[1].locked);
    }

    #[test]
    fn lists_main_worktree() {
        let repo = TestRepo::new();
        let wts = list(repo.path()).unwrap();
        assert_eq!(wts.len(), 1);
        assert!(wts[0].is_main);
        assert_eq!(wts[0].branch.as_deref(), Some("main"));
    }

    #[test]
    fn creates_and_lists_new_worktree() {
        let repo = TestRepo::new();
        let wt_path = repo.sibling("agent-a");

        let created = create(repo.path(), &wt_path, "agent-a", "main").unwrap();
        assert_eq!(created.branch.as_deref(), Some("agent-a"));
        assert!(!created.is_main);
        assert!(wt_path.join(".git").exists());

        let wts = list(repo.path()).unwrap();
        assert_eq!(wts.len(), 2);
        assert!(wts.iter().any(|w| w.branch.as_deref() == Some("agent-a")));
    }

    #[test]
    fn empty_branch_name_is_rejected() {
        let repo = TestRepo::new();
        let err = create(repo.path(), &repo.sibling("x"), "  ", "main").unwrap_err();
        assert!(matches!(err, QuayError::Invalid(_)));
    }

    #[test]
    fn slugify_makes_safe_names() {
        assert_eq!(slugify("Fix login bug!"), "fix-login-bug");
        assert_eq!(slugify("  feature/AUTH  "), "feature-auth");
        assert_eq!(slugify("already-fine_1"), "already-fine_1");
        assert_eq!(slugify("***"), "");
    }

    #[test]
    fn removes_worktree() {
        let repo = TestRepo::new();
        let wt_path = repo.sibling("temp");
        create(repo.path(), &wt_path, "temp", "main").unwrap();
        assert_eq!(list(repo.path()).unwrap().len(), 2);

        remove(repo.path(), &wt_path, false).unwrap();
        assert_eq!(list(repo.path()).unwrap().len(), 1);
    }
}
