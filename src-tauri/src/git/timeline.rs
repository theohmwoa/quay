//! Commit-by-commit story of a branch: each commit in `base..HEAD` with its
//! own diff, so the review can be read as a sequence of intentful steps rather
//! than one big blob. Narration is layered on per-commit at the command level.

use std::path::Path;

use git2::{Repository, Sort};
use serde::{Deserialize, Serialize};

use crate::error::{QuayError, Result};
use crate::git::diff::{build_diff_summary, DiffSummary};

/// One commit in the timeline, with the change it introduced.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TimelineEntry {
    pub sha: String,
    pub subject: String,
    pub author: String,
    /// The diff this commit introduced (vs its first parent).
    pub diff: DiffSummary,
}

/// List the commits in `base..HEAD`, oldest first, each with its own diff.
pub fn commit_timeline(repo_path: &Path, base: &str) -> Result<Vec<TimelineEntry>> {
    let repo = Repository::open(repo_path)?;
    let head = repo.head()?.peel_to_commit()?;
    let base_commit = repo
        .revparse_single(base)
        .map_err(|_| QuayError::Invalid(format!("base ref `{base}` not found")))?
        .peel_to_commit()?;
    let merge_base = repo.merge_base(base_commit.id(), head.id())?;

    let mut walk = repo.revwalk()?;
    walk.push(head.id())?;
    walk.hide(merge_base)?;
    walk.set_sorting(Sort::TOPOLOGICAL | Sort::REVERSE)?;

    let mut entries = Vec::new();
    for oid in walk {
        let commit = repo.find_commit(oid?)?;
        let tree = commit.tree()?;
        let parent = commit.parent(0).ok();
        let parent_tree = match &parent {
            Some(p) => Some(p.tree()?),
            None => None,
        };
        let sha = commit
            .as_object()
            .short_id()?
            .as_str()
            .unwrap_or("")
            .to_string();
        let parent_label = parent
            .as_ref()
            .and_then(|p| p.as_object().short_id().ok())
            .and_then(|s| s.as_str().map(str::to_string))
            .unwrap_or_else(|| "∅".to_string());

        let diff = build_diff_summary(
            &repo,
            parent_tree.as_ref(),
            Some(&tree),
            &parent_label,
            &sha,
        )?;

        entries.push(TimelineEntry {
            sha,
            subject: commit.summary().unwrap_or("").to_string(),
            author: commit.author().name().unwrap_or("").to_string(),
            diff,
        });
    }
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TestRepo;

    #[test]
    fn lists_commits_oldest_first_with_their_diffs() {
        let repo = TestRepo::new();
        repo.checkout_new_branch("feature");
        repo.write_commit("first.txt", "1\n", "add first");
        repo.write_commit("second.txt", "2\n", "add second");

        let tl = commit_timeline(repo.path(), "main").unwrap();
        assert_eq!(tl.len(), 2);
        assert_eq!(tl[0].subject, "add first");
        assert_eq!(tl[1].subject, "add second");

        // Each commit's diff contains only the file it introduced.
        assert!(tl[0].diff.files.iter().any(|f| f.path == "first.txt"));
        assert!(!tl[0].diff.files.iter().any(|f| f.path == "second.txt"));
        assert!(tl[1].diff.files.iter().any(|f| f.path == "second.txt"));
    }

    #[test]
    fn empty_when_no_commits_ahead_of_base() {
        let repo = TestRepo::new();
        let tl = commit_timeline(repo.path(), "main").unwrap();
        assert!(tl.is_empty());
    }

    #[test]
    fn unknown_base_is_invalid() {
        let repo = TestRepo::new();
        assert!(matches!(
            commit_timeline(repo.path(), "nope").unwrap_err(),
            QuayError::Invalid(_)
        ));
    }
}
