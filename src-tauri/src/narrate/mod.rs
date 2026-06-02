//! Turning a structured diff into something a human can *understand*.
//!
//! A [`Narration`] is the narrated-diff payload: a one-paragraph summary,
//! changes clustered by intent, a plain-English note per file, and a list of
//! things worth double-checking.
//!
//! Two implementations, behind [`AnyNarrator`]:
//! - [`MockNarrator`] — deterministic, offline, no network. Used in tests and
//!   as the fallback when no API key is configured.
//! - [`anthropic::AnthropicNarrator`] — calls Haiku to produce a richer,
//!   intent-aware narration. Costs API credits, so it's never on the test path.

pub mod anthropic;

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::git::diff::{DiffFile, DiffSummary, FileStatus};

/// A group of related changes ("what was done"), not a single file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Cluster {
    pub title: String,
    pub description: String,
    pub files: Vec<String>,
}

/// A plain-English note about a single file's change.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileNote {
    pub path: String,
    pub note: String,
}

/// The narrated-diff result rendered by the frontend.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Narration {
    pub summary: String,
    pub clusters: Vec<Cluster>,
    pub file_notes: Vec<FileNote>,
    pub risks: Vec<String>,
    /// Which engine produced this ("mock" or "haiku") — surfaced in the UI.
    pub engine: String,
}

/// Dispatch over the available narrators without needing async trait objects.
pub enum AnyNarrator {
    Mock(MockNarrator),
    Anthropic(anthropic::AnthropicNarrator),
}

impl AnyNarrator {
    /// Build the narrator from the environment: use Haiku when
    /// `ANTHROPIC_API_KEY` is set, otherwise fall back to the offline mock.
    pub fn from_env() -> Self {
        match std::env::var("ANTHROPIC_API_KEY") {
            Ok(key) if !key.trim().is_empty() => {
                let mut narrator = anthropic::AnthropicNarrator::new(key);
                // Optional model override, e.g. a larger model for big diffs.
                if let Ok(model) = std::env::var("QUAY_NARRATOR_MODEL") {
                    if !model.trim().is_empty() {
                        narrator = narrator.with_model(model);
                    }
                }
                AnyNarrator::Anthropic(narrator)
            }
            _ => AnyNarrator::Mock(MockNarrator),
        }
    }

    pub async fn narrate(&self, diff: &DiffSummary) -> Result<Narration> {
        match self {
            AnyNarrator::Mock(m) => Ok(m.narrate(diff)),
            AnyNarrator::Anthropic(a) => a.narrate(diff).await,
        }
    }

    pub async fn commit_message(&self, diff: &DiffSummary) -> Result<String> {
        match self {
            AnyNarrator::Mock(m) => Ok(m.commit_message(diff)),
            AnyNarrator::Anthropic(a) => a.commit_message(diff).await,
        }
    }

    pub async fn ask(&self, diff: &DiffSummary, question: &str) -> Result<String> {
        match self {
            AnyNarrator::Mock(m) => Ok(m.ask(diff, question)),
            AnyNarrator::Anthropic(a) => a.ask(diff, question).await,
        }
    }
}

/// Deterministic, offline narrator. Groups changes by top-level directory and
/// describes each file from its status and line stats. No network, no cost.
pub struct MockNarrator;

impl MockNarrator {
    pub fn narrate(&self, diff: &DiffSummary) -> Narration {
        let summary = format!(
            "{} file{} changed against {} (+{} / -{}).",
            diff.files.len(),
            if diff.files.len() == 1 { "" } else { "s" },
            diff.base,
            diff.total_additions,
            diff.total_deletions,
        );

        // Cluster by top-level directory for a stable, intent-ish grouping.
        let mut groups: BTreeMap<String, Vec<&DiffFile>> = BTreeMap::new();
        for f in &diff.files {
            groups.entry(top_dir(&f.path)).or_default().push(f);
        }
        let clusters = groups
            .into_iter()
            .map(|(dir, files)| {
                let adds: usize = files.iter().map(|f| f.additions).sum();
                let dels: usize = files.iter().map(|f| f.deletions).sum();
                Cluster {
                    title: dir.clone(),
                    description: format!(
                        "{} file{} under {dir} (+{adds} / -{dels}).",
                        files.len(),
                        if files.len() == 1 { "" } else { "s" },
                    ),
                    files: files.iter().map(|f| f.path.clone()).collect(),
                }
            })
            .collect();

        let file_notes = diff
            .files
            .iter()
            .map(|f| FileNote {
                path: f.path.clone(),
                note: describe_file(f),
            })
            .collect();

        Narration {
            summary,
            clusters,
            file_notes,
            risks: detect_risks(diff),
            engine: "mock".to_string(),
        }
    }
}

impl MockNarrator {
    /// Deterministic conventional-commit message derived from the diff.
    pub fn commit_message(&self, diff: &DiffSummary) -> String {
        if diff.files.is_empty() {
            return "Update working tree".to_string();
        }
        let all_added = diff.files.iter().all(|f| f.status == FileStatus::Added);
        let all_deleted = diff.files.iter().all(|f| f.status == FileStatus::Deleted);
        let verb = if all_added {
            "Add"
        } else if all_deleted {
            "Remove"
        } else {
            "Update"
        };

        // A single shared top-level directory becomes the scope.
        let dirs: std::collections::BTreeSet<String> =
            diff.files.iter().map(|f| top_dir(&f.path)).collect();
        let scope = if dirs.len() == 1 {
            let d = dirs.into_iter().next().unwrap();
            if d == "(root)" {
                String::new()
            } else {
                format!(" in {d}")
            }
        } else {
            String::new()
        };

        let subject = if diff.files.len() == 1 {
            format!("{verb} {}", diff.files[0].path)
        } else {
            format!("{verb} {} files{scope}", diff.files.len())
        };

        // Body: one bullet per file (capped), for context.
        let mut body = String::new();
        for f in diff.files.iter().take(10) {
            body.push_str(&format!("\n- {}", describe_file(f)));
        }
        if diff.files.len() > 10 {
            body.push_str(&format!("\n- … and {} more", diff.files.len() - 10));
        }
        format!("{subject}\n{body}")
    }

    /// Offline answer to a question about the diff. Can't truly reason, but
    /// returns useful, deterministic context so the feature degrades gracefully.
    pub fn ask(&self, diff: &DiffSummary, question: &str) -> String {
        let files: Vec<&str> = diff.files.iter().map(|f| f.path.as_str()).collect();
        format!(
            "(offline narrator — set ANTHROPIC_API_KEY for real answers)\n\nQuestion: {}\n\nThe diff against {} changes {} file(s) (+{} / -{}): {}.",
            question.trim(),
            diff.base,
            diff.files.len(),
            diff.total_additions,
            diff.total_deletions,
            files.join(", ")
        )
    }
}

/// Top-level directory of a path, or `(root)` for files at the repo root.
fn top_dir(path: &str) -> String {
    match path.split_once('/') {
        Some((dir, _)) => dir.to_string(),
        None => "(root)".to_string(),
    }
}

fn describe_file(f: &DiffFile) -> String {
    let verb = match f.status {
        FileStatus::Added => "Added",
        FileStatus::Modified => "Modified",
        FileStatus::Deleted => "Deleted",
        FileStatus::Renamed => "Renamed",
        FileStatus::Copied => "Copied",
        FileStatus::Other => "Changed",
    };
    if f.binary {
        return format!("{verb} {} (binary)", f.path);
    }
    format!("{verb} {} (+{} / -{})", f.path, f.additions, f.deletions)
}

/// Heuristic risk flags — cheap signals worth a second look.
fn detect_risks(diff: &DiffSummary) -> Vec<String> {
    let mut risks = Vec::new();
    let deletions: Vec<_> = diff
        .files
        .iter()
        .filter(|f| f.status == FileStatus::Deleted)
        .collect();
    if !deletions.is_empty() {
        risks.push(format!("{} file(s) deleted", deletions.len()));
    }
    for f in &diff.files {
        if f.additions + f.deletions > 150 {
            risks.push(format!(
                "Large change in {} ({} lines)",
                f.path,
                f.additions + f.deletions
            ));
        }
    }
    risks
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::diff::{DiffFile, DiffSummary, FileStatus};

    fn file(path: &str, status: FileStatus, add: usize, del: usize) -> DiffFile {
        DiffFile {
            path: path.to_string(),
            old_path: None,
            status,
            additions: add,
            deletions: del,
            binary: false,
            hunks: vec![],
        }
    }

    fn sample() -> DiffSummary {
        DiffSummary {
            base: "main".to_string(),
            head: "abc1234".to_string(),
            files: vec![
                file("src/auth.rs", FileStatus::Modified, 20, 5),
                file("src/login.rs", FileStatus::Added, 60, 0),
                file("README.md", FileStatus::Modified, 2, 1),
                file("old.txt", FileStatus::Deleted, 0, 200),
            ],
            total_additions: 82,
            total_deletions: 206,
        }
    }

    #[test]
    fn mock_summary_mentions_counts_and_base() {
        let n = MockNarrator.narrate(&sample());
        assert!(n.summary.contains("4 files"));
        assert!(n.summary.contains("main"));
        assert!(n.summary.contains("+82"));
        assert_eq!(n.engine, "mock");
    }

    #[test]
    fn mock_clusters_by_top_dir() {
        let n = MockNarrator.narrate(&sample());
        let titles: Vec<_> = n.clusters.iter().map(|c| c.title.as_str()).collect();
        assert!(titles.contains(&"src"));
        assert!(titles.contains(&"(root)"));
        let src = n.clusters.iter().find(|c| c.title == "src").unwrap();
        assert_eq!(src.files.len(), 2);
    }

    #[test]
    fn mock_flags_deletions_and_large_changes() {
        let n = MockNarrator.narrate(&sample());
        assert!(n.risks.iter().any(|r| r.contains("deleted")));
        assert!(n.risks.iter().any(|r| r.contains("Large change in old.txt")));
    }

    #[test]
    fn mock_is_deterministic() {
        let a = MockNarrator.narrate(&sample());
        let b = MockNarrator.narrate(&sample());
        assert_eq!(a, b);
    }

    #[test]
    fn mock_commit_message_picks_verb_and_scope() {
        // All-added under a single dir -> "Add N files in src".
        let all_added = DiffSummary {
            base: "main".into(),
            head: "h".into(),
            files: vec![
                file("src/a.rs", FileStatus::Added, 5, 0),
                file("src/b.rs", FileStatus::Added, 3, 0),
            ],
            total_additions: 8,
            total_deletions: 0,
        };
        let msg = MockNarrator.commit_message(&all_added);
        assert!(msg.starts_with("Add 2 files in src"), "got: {msg}");
        assert!(msg.contains("- Added src/a.rs"));

        // Single file -> "Update <path>".
        let one = DiffSummary {
            base: "main".into(),
            head: "h".into(),
            files: vec![file("README.md", FileStatus::Modified, 1, 1)],
            total_additions: 1,
            total_deletions: 1,
        };
        assert!(MockNarrator.commit_message(&one).starts_with("Update README.md"));
    }

    #[test]
    fn mock_commit_message_is_deterministic() {
        let d = sample();
        assert_eq!(MockNarrator.commit_message(&d), MockNarrator.commit_message(&d));
    }

    #[test]
    fn mock_ask_is_deterministic_and_mentions_files() {
        let d = sample();
        let a = MockNarrator.ask(&d, "what changed?");
        let b = MockNarrator.ask(&d, "what changed?");
        assert_eq!(a, b);
        assert!(a.contains("src/auth.rs"));
        assert!(a.contains("what changed?"));
    }

    #[test]
    fn from_env_without_key_is_mock() {
        // Note: this assumes the test env has no real key; CI/dev default.
        if std::env::var("ANTHROPIC_API_KEY").is_err() {
            assert!(matches!(AnyNarrator::from_env(), AnyNarrator::Mock(_)));
        }
    }
}
