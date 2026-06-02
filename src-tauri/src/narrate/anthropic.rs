//! Live narrator backed by Anthropic's Messages API (Haiku by default).
//!
//! This is one of the "cheap smart sprinkles": a small prompt summarizing a
//! diff, answered by Haiku, parsed into a [`Narration`]. The network call is
//! the only impure part — prompt construction and response parsing are pure
//! functions covered by tests, so the logic is verified without spending
//! credits or requiring connectivity.

use serde_json::{json, Value};

use super::{Cluster, FileNote, Narration};
use crate::error::{QuayError, Result};
use crate::git::diff::DiffSummary;

const API_URL: &str = "https://api.anthropic.com/v1/messages";
const API_VERSION: &str = "2023-06-01";
const DEFAULT_MODEL: &str = "claude-haiku-4-5-20251001";
/// Cap the diff text we send so a huge diff can't blow up the prompt/cost.
const MAX_PROMPT_CHARS: usize = 24_000;

pub struct AnthropicNarrator {
    api_key: String,
    model: String,
}

impl AnthropicNarrator {
    pub fn new(api_key: String) -> Self {
        Self {
            api_key,
            model: DEFAULT_MODEL.to_string(),
        }
    }

    /// Override the model (e.g. to use a larger one for big diffs).
    pub fn with_model(mut self, model: impl Into<String>) -> Self {
        self.model = model.into();
        self
    }

    /// One-shot completion: send a system + user prompt, return assistant text.
    async fn complete(&self, system: &str, user: &str, max_tokens: u32) -> Result<String> {
        let body = json!({
            "model": self.model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": [{ "role": "user", "content": user }],
        });

        let client = reqwest::Client::new();
        let resp = client
            .post(API_URL)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", API_VERSION)
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| QuayError::Narrator(format!("request failed: {e}")))?;

        let status = resp.status();
        let text = resp
            .text()
            .await
            .map_err(|e| QuayError::Narrator(format!("reading response failed: {e}")))?;
        if !status.is_success() {
            return Err(QuayError::Narrator(format!("API {status}: {text}")));
        }

        let api_json: Value = serde_json::from_str(&text)
            .map_err(|e| QuayError::Narrator(format!("invalid API json: {e}")))?;
        extract_text(&api_json)
    }

    pub async fn narrate(&self, diff: &DiffSummary) -> Result<Narration> {
        let content = self.complete(SYSTEM_PROMPT, &build_prompt(diff), 1024).await?;
        parse_narration(&content)
    }

    /// Generate a concise conventional-commit message for the diff.
    pub async fn commit_message(&self, diff: &DiffSummary) -> Result<String> {
        let content = self.complete(COMMIT_SYSTEM, &build_prompt(diff), 256).await?;
        Ok(clean_commit_message(&content))
    }

    /// Answer a free-form question about the diff (the "ask Haiku" feature).
    pub async fn ask(&self, diff: &DiffSummary, question: &str) -> Result<String> {
        let content = self
            .complete(ASK_SYSTEM, &build_ask_prompt(diff, question), 1024)
            .await?;
        Ok(content.trim().to_string())
    }
}

const SYSTEM_PROMPT: &str = "You are a senior engineer reviewing a code diff for a teammate. \
Explain what the change accomplishes so a human can understand it quickly — not a line-by-line \
restatement. Group related edits by intent, flag anything risky, and keep it concise. \
Respond with ONLY a JSON object, no prose, no markdown fences, matching this shape: \
{\"summary\": string, \"clusters\": [{\"title\": string, \"description\": string, \"files\": [string]}], \
\"file_notes\": [{\"path\": string, \"note\": string}], \"risks\": [string]}";

const COMMIT_SYSTEM: &str = "You write git commit messages. Given a diff, respond with ONLY a \
commit message: a concise imperative subject line (<= 72 chars), optionally followed by a blank \
line and a short body explaining the why. No quotes, no markdown fences, no preamble.";

const ASK_SYSTEM: &str = "You are a senior engineer answering a question about a specific code \
diff. Answer concisely and concretely, referring to the actual changes. If the diff doesn't \
contain the answer, say so.";

/// Clean a model-produced commit message: strip markdown fences, surrounding
/// quotes, and any "Subject:"-style preamble; trim trailing whitespace.
pub fn clean_commit_message(text: &str) -> String {
    let mut s = text.trim();
    // Strip a leading/trailing ``` fence if present.
    if let Some(rest) = s.strip_prefix("```") {
        s = rest;
        if let Some(nl) = s.find('\n') {
            s = &s[nl + 1..];
        }
        if let Some(end) = s.rfind("```") {
            s = &s[..end];
        }
        s = s.trim();
    }
    // Strip wrapping quotes around a single-line message.
    if !s.contains('\n') && s.len() >= 2 {
        let bytes = s.as_bytes();
        let q = bytes[0];
        if (q == b'"' || q == b'\'') && bytes[bytes.len() - 1] == q {
            s = &s[1..s.len() - 1];
        }
    }
    s.trim().to_string()
}

/// Build the prompt for a question about a diff.
pub fn build_ask_prompt(diff: &DiffSummary, question: &str) -> String {
    format!(
        "Question: {}\n\n--- diff ---\n{}",
        question.trim(),
        build_prompt(diff)
    )
}

/// Build the user prompt: a compact, structured rendering of the diff,
/// truncated so it can't exceed a sane size.
pub fn build_prompt(diff: &DiffSummary) -> String {
    let mut s = String::new();
    s.push_str(&format!(
        "Diff of branch {} against base {} (+{} / -{}):\n\n",
        diff.head, diff.base, diff.total_additions, diff.total_deletions
    ));
    for f in &diff.files {
        s.push_str(&format!(
            "## {} [{:?}] (+{} / -{})\n",
            f.path, f.status, f.additions, f.deletions
        ));
        if f.binary {
            s.push_str("(binary file)\n\n");
            continue;
        }
        for h in &f.hunks {
            s.push_str(&format!("{}\n", h.header));
            for line in &h.lines {
                s.push(line.origin);
                s.push_str(&line.content);
                s.push('\n');
            }
        }
        s.push('\n');
        if s.len() > MAX_PROMPT_CHARS {
            s.truncate(MAX_PROMPT_CHARS);
            s.push_str("\n... (diff truncated)\n");
            break;
        }
    }
    s
}

/// Pull the assistant's text out of a Messages API response body.
pub fn extract_text(api_json: &Value) -> Result<String> {
    let blocks = api_json
        .get("content")
        .and_then(Value::as_array)
        .ok_or_else(|| QuayError::Narrator("response has no content array".into()))?;
    let mut text = String::new();
    for block in blocks {
        if block.get("type").and_then(Value::as_str) == Some("text") {
            if let Some(t) = block.get("text").and_then(Value::as_str) {
                text.push_str(t);
            }
        }
    }
    if text.is_empty() {
        return Err(QuayError::Narrator("no text block in response".into()));
    }
    Ok(text)
}

/// Parse the model's JSON text into a [`Narration`].
///
/// Tolerant of the model wrapping JSON in ```json fences or adding stray
/// text around it — we extract the outermost `{...}` span.
pub fn parse_narration(text: &str) -> Result<Narration> {
    let json_str = extract_json_object(text)
        .ok_or_else(|| QuayError::Narrator("no JSON object found in response".into()))?;
    let v: Value = serde_json::from_str(json_str)
        .map_err(|e| QuayError::Narrator(format!("narration json parse error: {e}")))?;

    let summary = v
        .get("summary")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    let clusters = v
        .get("clusters")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .map(|c| Cluster {
                    title: str_field(c, "title"),
                    description: str_field(c, "description"),
                    files: str_array(c, "files"),
                })
                .collect()
        })
        .unwrap_or_default();

    let file_notes = v
        .get("file_notes")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .map(|n| FileNote {
                    path: str_field(n, "path"),
                    note: str_field(n, "note"),
                })
                .collect()
        })
        .unwrap_or_default();

    let risks = str_array(&v, "risks");

    Ok(Narration {
        summary,
        clusters,
        file_notes,
        risks,
        engine: "haiku".to_string(),
    })
}

fn str_field(v: &Value, key: &str) -> String {
    v.get(key).and_then(Value::as_str).unwrap_or_default().to_string()
}

fn str_array(v: &Value, key: &str) -> Vec<String> {
    v.get(key)
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// Extract the outermost balanced `{...}` JSON object from arbitrary text.
fn extract_json_object(text: &str) -> Option<&str> {
    let start = text.find('{')?;
    let bytes = text.as_bytes();
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;
    for (i, &b) in bytes.iter().enumerate().skip(start) {
        if in_string {
            if escaped {
                escaped = false;
            } else if b == b'\\' {
                escaped = true;
            } else if b == b'"' {
                in_string = false;
            }
            continue;
        }
        match b {
            b'"' => in_string = true,
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(&text[start..=i]);
                }
            }
            _ => {}
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::diff::{DiffFile, DiffLine, DiffSummary, FileStatus, Hunk};

    fn sample_diff() -> DiffSummary {
        DiffSummary {
            base: "main".to_string(),
            head: "abc1234".to_string(),
            files: vec![DiffFile {
                path: "src/auth.rs".to_string(),
                old_path: None,
                status: FileStatus::Modified,
                additions: 1,
                deletions: 0,
                binary: false,
                hunks: vec![Hunk {
                    header: "@@ -1,2 +1,3 @@".to_string(),
                    lines: vec![DiffLine {
                        origin: '+',
                        content: "let token = mint();".to_string(),
                        old_lineno: None,
                        new_lineno: Some(2),
                    }],
                }],
            }],
            total_additions: 1,
            total_deletions: 0,
        }
    }

    #[test]
    fn prompt_includes_paths_stats_and_hunk_content() {
        let p = build_prompt(&sample_diff());
        assert!(p.contains("src/auth.rs"));
        assert!(p.contains("main"));
        assert!(p.contains("+let token = mint();"));
        assert!(p.contains("@@ -1,2 +1,3 @@"));
    }

    #[test]
    fn prompt_is_capped_in_size() {
        let mut big = sample_diff();
        let huge_hunk = Hunk {
            header: "@@ big @@".to_string(),
            lines: (0..5000)
                .map(|i| DiffLine {
                    origin: '+',
                    content: format!("line number {i} with some padding text"),
                    old_lineno: None,
                    new_lineno: Some(i),
                })
                .collect(),
        };
        big.files[0].hunks.push(huge_hunk);
        let p = build_prompt(&big);
        assert!(p.len() <= MAX_PROMPT_CHARS + 64);
        assert!(p.contains("truncated"));
    }

    #[test]
    fn extracts_text_from_messages_response() {
        let resp = serde_json::json!({
            "content": [
                { "type": "text", "text": "{\"summary\":\"hi\"}" }
            ]
        });
        assert_eq!(extract_text(&resp).unwrap(), "{\"summary\":\"hi\"}");
    }

    #[test]
    fn parses_well_formed_narration() {
        let text = r#"{
            "summary": "Adds token minting to auth.",
            "clusters": [{"title": "auth", "description": "token work", "files": ["src/auth.rs"]}],
            "file_notes": [{"path": "src/auth.rs", "note": "now mints a token"}],
            "risks": ["touches auth path"]
        }"#;
        let n = parse_narration(text).unwrap();
        assert_eq!(n.summary, "Adds token minting to auth.");
        assert_eq!(n.clusters.len(), 1);
        assert_eq!(n.clusters[0].files, vec!["src/auth.rs"]);
        assert_eq!(n.file_notes[0].path, "src/auth.rs");
        assert_eq!(n.risks, vec!["touches auth path"]);
        assert_eq!(n.engine, "haiku");
    }

    #[test]
    fn parses_narration_wrapped_in_markdown_fence() {
        let text = "Here you go:\n```json\n{\"summary\": \"x\", \"risks\": []}\n```\nthanks";
        let n = parse_narration(text).unwrap();
        assert_eq!(n.summary, "x");
    }

    #[test]
    fn parse_fails_without_json() {
        assert!(parse_narration("no json here").is_err());
    }

    #[test]
    fn clean_commit_message_strips_fences_and_quotes() {
        assert_eq!(clean_commit_message("  Add login flow  "), "Add login flow");
        assert_eq!(clean_commit_message("\"Add login flow\""), "Add login flow");
        assert_eq!(
            clean_commit_message("```\nAdd login flow\n```"),
            "Add login flow"
        );
        // Multi-line body is preserved (quotes only stripped for single line).
        let multi = "Add login flow\n\nIntroduces token minting.";
        assert_eq!(clean_commit_message(multi), multi);
    }

    #[test]
    fn build_ask_prompt_includes_question_and_diff() {
        let p = build_ask_prompt(&sample_diff(), "  why mint a token?  ");
        assert!(p.contains("Question: why mint a token?"));
        assert!(p.contains("src/auth.rs"));
        assert!(p.contains("--- diff ---"));
    }

    #[test]
    fn extract_json_handles_braces_inside_strings() {
        let text = r#"prefix {"summary": "a } brace in a string", "risks": []} suffix"#;
        let n = parse_narration(text).unwrap();
        assert_eq!(n.summary, "a } brace in a string");
    }
}
