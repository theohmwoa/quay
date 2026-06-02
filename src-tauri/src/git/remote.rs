//! Push and pull-request creation.
//!
//! `git push` is plain git; PR creation shells out to the GitHub CLI (`gh`).
//! Command construction and output parsing are pure functions (tested without
//! the network or `gh` installed); the executing wrappers are thin.

use std::path::Path;
use std::process::Command;

use crate::error::{QuayError, Result};

/// Arguments for `git push -u <remote> <branch>`.
pub fn push_args(remote: &str, branch: &str) -> Vec<String> {
    vec![
        "push".into(),
        "-u".into(),
        remote.into(),
        branch.into(),
    ]
}

/// Arguments for `gh pr create ...`.
pub fn pr_create_args(title: &str, body: &str, base: &str, head: &str) -> Vec<String> {
    vec![
        "pr".into(),
        "create".into(),
        "--title".into(),
        title.into(),
        "--body".into(),
        body.into(),
        "--base".into(),
        base.into(),
        "--head".into(),
        head.into(),
    ]
}

/// Extract the PR URL `gh pr create` prints (the GitHub PR link).
pub fn parse_pr_url(stdout: &str) -> Option<String> {
    stdout
        .lines()
        .map(str::trim)
        .find(|l| l.starts_with("http") && l.contains("/pull/"))
        .map(str::to_string)
        .or_else(|| {
            stdout
                .lines()
                .map(str::trim)
                .find(|l| l.starts_with("http"))
                .map(str::to_string)
        })
}

/// Push `branch` to `remote`, setting upstream.
pub fn push(repo_path: &Path, remote: &str, branch: &str) -> Result<()> {
    let args = push_args(remote, branch);
    let out = Command::new("git")
        .current_dir(repo_path)
        .args(&args)
        .output()?;
    if !out.status.success() {
        return Err(QuayError::Git(format!(
            "git push failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        )));
    }
    Ok(())
}

/// Open a PR via `gh`, returning the PR URL. Requires `gh` to be installed and
/// authenticated; errors clearly otherwise.
pub fn open_pr(
    repo_path: &Path,
    title: &str,
    body: &str,
    base: &str,
    head: &str,
) -> Result<String> {
    let args = pr_create_args(title, body, base, head);
    let out = Command::new("gh")
        .current_dir(repo_path)
        .args(&args)
        .output()
        .map_err(|e| QuayError::Git(format!("could not run `gh` (is it installed?): {e}")))?;
    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
    if !out.status.success() {
        return Err(QuayError::Git(format!("gh pr create failed: {}", stderr.trim())));
    }
    parse_pr_url(&format!("{stdout}\n{stderr}"))
        .ok_or_else(|| QuayError::Git("could not find PR URL in gh output".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn push_args_set_upstream() {
        assert_eq!(
            push_args("origin", "feature-x"),
            vec!["push", "-u", "origin", "feature-x"]
        );
    }

    #[test]
    fn pr_create_args_are_well_formed() {
        let args = pr_create_args("My title", "Some body", "main", "feature-x");
        assert_eq!(args[0], "pr");
        assert_eq!(args[1], "create");
        // title/body/base/head values are passed through verbatim.
        let joined = args.join(" ");
        assert!(joined.contains("--title My title"));
        assert!(joined.contains("--base main"));
        assert!(joined.contains("--head feature-x"));
    }

    #[test]
    fn parse_pr_url_finds_the_pull_link() {
        let out = "Creating pull request for feature-x into main\nhttps://github.com/me/repo/pull/42\n";
        assert_eq!(
            parse_pr_url(out).as_deref(),
            Some("https://github.com/me/repo/pull/42")
        );
    }

    #[test]
    fn parse_pr_url_handles_no_url() {
        assert_eq!(parse_pr_url("no link here"), None);
    }
}
