//! Structured branch-vs-base diffs.
//!
//! The signature feature: instead of "diff against remote", we compute the
//! *whole feature* diff — everything in the worktree that differs from `base`
//! (usually `main`), since the branch diverged. Crucially this includes
//! **uncommitted** work: the diff is computed against the working directory
//! (staged, unstaged, and untracked files), not just the committed `HEAD`, so
//! changes show up the moment they're saved — no commit required. The result
//! is structured data (files, hunks, lines, stats) ready for the frontend to
//! render and for the narrator to summarize.

use std::path::Path;

use git2::{Delta, Patch, Repository};
use serde::{Deserialize, Serialize};

use crate::error::{QuayError, Result};

/// How a file changed between base and head.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    Other,
}

impl From<Delta> for FileStatus {
    fn from(d: Delta) -> Self {
        match d {
            // Untracked files (new, never `git add`ed) read as additions.
            Delta::Added | Delta::Untracked => FileStatus::Added,
            Delta::Deleted => FileStatus::Deleted,
            Delta::Modified => FileStatus::Modified,
            Delta::Renamed => FileStatus::Renamed,
            Delta::Copied => FileStatus::Copied,
            _ => FileStatus::Other,
        }
    }
}

/// One line within a diff hunk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiffLine {
    /// `+` added, `-` removed, ` ` context.
    pub origin: char,
    pub content: String,
    pub old_lineno: Option<u32>,
    pub new_lineno: Option<u32>,
}

/// A contiguous block of changes within a file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Hunk {
    pub header: String,
    pub lines: Vec<DiffLine>,
}

/// All changes to a single file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiffFile {
    pub path: String,
    /// Previous path when the file was renamed.
    pub old_path: Option<String>,
    pub status: FileStatus,
    pub additions: usize,
    pub deletions: usize,
    /// True for files git considers binary (no textual hunks).
    pub binary: bool,
    pub hunks: Vec<Hunk>,
}

/// The full structured diff of a branch against its base.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiffSummary {
    /// Base ref the diff was computed against (e.g. `main`).
    pub base: String,
    /// The head we diffed (short sha).
    pub head: String,
    pub files: Vec<DiffFile>,
    pub total_additions: usize,
    pub total_deletions: usize,
}

/// Label used for the "head" side of a diff when it's the working directory
/// rather than a specific commit.
const WORKDIR_LABEL: &str = "working tree";

/// Compute the diff of the worktree at `repo_path` against `base`.
///
/// This finds the merge-base of `base` and the current HEAD, then diffs that
/// common ancestor's tree against the **working directory** — staged,
/// unstaged, and untracked changes all included. The result is everything the
/// worktree currently differs from `base` by, regardless of whether it has
/// been committed, while still ignoring anything that landed on `base` after
/// divergence.
pub fn branch_vs_base(repo_path: &Path, base: &str) -> Result<DiffSummary> {
    let repo = Repository::open(repo_path)?;

    let head_commit = repo.head()?.peel_to_commit()?;
    let base_commit = repo
        .revparse_single(base)
        .map_err(|_| QuayError::Invalid(format!("base ref `{base}` not found")))?
        .peel_to_commit()?;

    let merge_base = repo.merge_base(base_commit.id(), head_commit.id())?;
    let base_tree = repo.find_commit(merge_base)?.tree()?;

    let mut opts = git2::DiffOptions::new();
    opts.context_lines(3);
    // Include uncommitted work so changes appear without needing a commit, and
    // emit the actual contents of untracked files so they render real hunks.
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .show_untracked_content(true);
    // Compare the base tree to the working directory, using the index as a
    // shortcut so both staged and unstaged changes are captured.
    let diff = repo.diff_tree_to_workdir_with_index(Some(&base_tree), Some(&mut opts))?;

    process_diff(diff, base, WORKDIR_LABEL)
}

/// Build a [`DiffSummary`] from two trees (either may be `None` for the empty
/// tree). Used by the per-commit timeline, which compares committed snapshots.
pub fn build_diff_summary(
    repo: &Repository,
    old_tree: Option<&git2::Tree>,
    new_tree: Option<&git2::Tree>,
    base: &str,
    head: &str,
) -> Result<DiffSummary> {
    let mut opts = git2::DiffOptions::new();
    opts.context_lines(3);
    let diff = repo.diff_tree_to_tree(old_tree, new_tree, Some(&mut opts))?;
    process_diff(diff, base, head)
}

/// Walk a prepared [`git2::Diff`] into a structured [`DiffSummary`]. Shared by
/// [`branch_vs_base`] (tree-vs-workdir) and [`build_diff_summary`] (tree-vs-tree).
fn process_diff(mut diff: git2::Diff, base: &str, head: &str) -> Result<DiffSummary> {
    // Detect renames so they show up as Renamed rather than add+delete.
    diff.find_similar(None)?;

    let mut files = Vec::new();
    let mut total_additions = 0;
    let mut total_deletions = 0;

    for (idx, delta) in diff.deltas().enumerate() {
        let status = FileStatus::from(delta.status());
        let new_path = delta
            .new_file()
            .path()
            .map(|p| p.to_string_lossy().into_owned());
        let old_path = delta
            .old_file()
            .path()
            .map(|p| p.to_string_lossy().into_owned());
        let path = new_path.clone().or_else(|| old_path.clone()).unwrap_or_default();
        let old_path = if status == FileStatus::Renamed {
            old_path
        } else {
            None
        };

        let patch = Patch::from_diff(&diff, idx)?;
        let mut hunks = Vec::new();
        let mut additions = 0;
        let mut deletions = 0;
        let mut binary = delta.new_file().is_binary() || delta.old_file().is_binary();

        if let Some(patch) = patch {
            let (_ctx, adds, dels) = patch.line_stats()?;
            additions = adds;
            deletions = dels;
            for h in 0..patch.num_hunks() {
                let (hunk, line_count) = patch.hunk(h)?;
                let header = String::from_utf8_lossy(hunk.header()).trim_end().to_string();
                let mut lines = Vec::with_capacity(line_count);
                for l in 0..line_count {
                    let line = patch.line_in_hunk(h, l)?;
                    lines.push(DiffLine {
                        origin: line.origin(),
                        content: String::from_utf8_lossy(line.content())
                            .trim_end_matches('\n')
                            .to_string(),
                        old_lineno: line.old_lineno(),
                        new_lineno: line.new_lineno(),
                    });
                }
                hunks.push(Hunk { header, lines });
            }
        } else {
            // No textual patch available — treat as binary.
            binary = true;
        }

        total_additions += additions;
        total_deletions += deletions;
        files.push(DiffFile {
            path,
            old_path,
            status,
            additions,
            deletions,
            binary,
            hunks,
        });
    }

    Ok(DiffSummary {
        base: base.to_string(),
        head: head.to_string(),
        files,
        total_additions,
        total_deletions,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TestRepo;

    #[test]
    fn captures_feature_branch_changes() {
        let repo = TestRepo::new();
        // main has README.md from the initial commit. Branch off and add work.
        repo.checkout_new_branch("feature");
        repo.write_commit("src.txt", "line one\nline two\n", "add src");
        repo.write_commit("README.md", "# initial\nmore\n", "extend readme");

        let diff = branch_vs_base(repo.path(), "main").unwrap();
        assert_eq!(diff.base, "main");
        assert!(diff.total_additions >= 3);

        let added = diff.files.iter().find(|f| f.path == "src.txt").unwrap();
        assert_eq!(added.status, FileStatus::Added);
        assert_eq!(added.additions, 2);
        assert!(!added.hunks.is_empty());

        let modified = diff.files.iter().find(|f| f.path == "README.md").unwrap();
        assert_eq!(modified.status, FileStatus::Modified);
    }

    #[test]
    fn ignores_changes_that_landed_on_base_after_divergence() {
        let repo = TestRepo::new();
        repo.checkout_new_branch("feature");
        repo.write_commit("feat.txt", "feature work\n", "feature commit");

        // Advance main independently — this must NOT appear in the feature diff.
        repo.git(&["checkout", "main"]);
        repo.write_commit("on_main.txt", "main only\n", "main commit");
        repo.git(&["checkout", "feature"]);

        let diff = branch_vs_base(repo.path(), "main").unwrap();
        assert!(diff.files.iter().any(|f| f.path == "feat.txt"));
        assert!(
            !diff.files.iter().any(|f| f.path == "on_main.txt"),
            "merge-base diff must exclude commits that landed on main after divergence"
        );
    }

    #[test]
    fn includes_uncommitted_modifications() {
        let repo = TestRepo::new();
        repo.checkout_new_branch("feature");
        // Modify a tracked file but do NOT commit it.
        std::fs::write(repo.path().join("README.md"), "# initial\nuncommitted line\n")
            .expect("write file");

        let diff = branch_vs_base(repo.path(), "main").unwrap();
        let modified = diff
            .files
            .iter()
            .find(|f| f.path == "README.md")
            .expect("uncommitted edit should appear in the diff");
        assert_eq!(modified.status, FileStatus::Modified);
        assert!(modified.additions >= 1);
        assert_eq!(diff.head, WORKDIR_LABEL);
    }

    #[test]
    fn includes_untracked_files() {
        let repo = TestRepo::new();
        repo.checkout_new_branch("feature");
        // A brand-new, never-added file must still show up.
        std::fs::write(repo.path().join("scratch.txt"), "new work\n").expect("write file");

        let diff = branch_vs_base(repo.path(), "main").unwrap();
        let added = diff
            .files
            .iter()
            .find(|f| f.path == "scratch.txt")
            .expect("untracked file should appear in the diff");
        assert_eq!(added.status, FileStatus::Added);
        assert!(!added.hunks.is_empty());
    }

    #[test]
    fn detects_deletion() {
        let repo = TestRepo::new();
        repo.checkout_new_branch("feature");
        repo.git(&["rm", "README.md"]);
        repo.git(&["commit", "-m", "remove readme"]);

        let diff = branch_vs_base(repo.path(), "main").unwrap();
        let deleted = diff.files.iter().find(|f| f.path == "README.md").unwrap();
        assert_eq!(deleted.status, FileStatus::Deleted);
    }

    #[test]
    fn unknown_base_is_invalid() {
        let repo = TestRepo::new();
        let err = branch_vs_base(repo.path(), "nope-not-a-branch").unwrap_err();
        assert!(matches!(err, QuayError::Invalid(_)));
    }
}
