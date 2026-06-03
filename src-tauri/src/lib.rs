//! quay — a personal terminal/agent-deck for driving Claude Code across git
//! worktrees, with a narrated branch-vs-base diff.
//!
//! This file is the Tauri boundary: it declares the core modules and exposes
//! them as commands. All real logic lives in the (unit-tested) core modules;
//! the commands here are thin adapters that manage state and emit events.

mod agent;
mod error;
mod git;
mod narrate;
mod persist;
mod pty;
mod scrollback;

#[cfg(test)]
mod testutil;

#[cfg(test)]
mod integration_tests;

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, State};

use error::{QuayError, Result};
use git::diff::DiffSummary;
use git::integrate::IntegrateResult;
use git::status::WorktreeStatus;
use git::timeline::TimelineEntry;
use git::worktree::{self, Worktree};
use narrate::{AnyNarrator, Narration};
use persist::PersistedState;

// ---------------------------------------------------------------------------
// Worktree commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn list_worktrees(repo_path: String) -> Result<Vec<Worktree>> {
    worktree::list(Path::new(&repo_path))
}

/// Create a worktree on a new branch derived from `name`, placed in a
/// `<repo>-worktrees/` directory next to the repository.
#[tauri::command]
fn create_worktree(repo_path: String, name: String, base: String) -> Result<Worktree> {
    let repo = Path::new(&repo_path);
    let slug = worktree::slugify(&name);
    if slug.is_empty() {
        return Err(QuayError::Invalid("name produced an empty slug".into()));
    }
    let repo_name = repo
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "repo".into());
    let parent = repo
        .parent()
        .ok_or_else(|| QuayError::Invalid("repository has no parent directory".into()))?;
    let wt_root = parent.join(format!("{repo_name}-worktrees"));
    std::fs::create_dir_all(&wt_root)?;
    let path = wt_root.join(&slug);
    worktree::create(repo, &path, &slug, &base)
}

#[tauri::command]
fn remove_worktree(repo_path: String, path: String, force: bool) -> Result<()> {
    worktree::remove(Path::new(&repo_path), Path::new(&path), force)
}

// ---------------------------------------------------------------------------
// Diff + narration commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn diff_branch_vs_base(repo_path: String, base: String) -> Result<DiffSummary> {
    git::diff::branch_vs_base(Path::new(&repo_path), &base)
}

/// Compute the branch-vs-base diff and narrate it. Uses Haiku when
/// `ANTHROPIC_API_KEY` is set, otherwise the offline mock narrator.
#[tauri::command]
async fn narrate_diff(repo_path: String, base: String) -> Result<Narration> {
    let diff = git::diff::branch_vs_base(Path::new(&repo_path), &base)?;
    AnyNarrator::from_env().narrate(&diff).await
}

/// Commit-by-commit narrated timeline of `base..HEAD`.
#[tauri::command]
fn commit_timeline(repo_path: String, base: String) -> Result<Vec<TimelineEntry>> {
    git::timeline::commit_timeline(Path::new(&repo_path), &base)
}

/// Answer a free-form question about the branch-vs-base diff.
#[tauri::command]
async fn ask_diff(repo_path: String, base: String, question: String) -> Result<String> {
    let diff = git::diff::branch_vs_base(Path::new(&repo_path), &base)?;
    AnyNarrator::from_env().ask(&diff, &question).await
}

// ---------------------------------------------------------------------------
// Lifecycle commands: status -> commit -> push/PR -> land
// ---------------------------------------------------------------------------

#[tauri::command]
fn worktree_status(repo_path: String, base: String) -> Result<WorktreeStatus> {
    git::status::worktree_status(Path::new(&repo_path), &base)
}

/// Generate a commit message for the current branch-vs-base diff (Haiku or
/// offline mock) without committing.
#[tauri::command]
async fn suggest_commit_message(repo_path: String, base: String) -> Result<String> {
    let diff = git::diff::branch_vs_base(Path::new(&repo_path), &base)?;
    AnyNarrator::from_env().commit_message(&diff).await
}

/// Stage everything and commit with `message`; returns the new short sha.
#[tauri::command]
fn commit_worktree(repo_path: String, message: String) -> Result<String> {
    git::commit::stage_and_commit(Path::new(&repo_path), &message)
}

#[tauri::command]
fn push_branch(repo_path: String, remote: String, branch: String) -> Result<()> {
    git::remote::push(Path::new(&repo_path), &remote, &branch)
}

#[tauri::command]
fn open_pr(
    repo_path: String,
    title: String,
    body: String,
    base: String,
    head: String,
) -> Result<String> {
    git::remote::open_pr(Path::new(&repo_path), &title, &body, &base, &head)
}

#[tauri::command]
fn integrate_branch(repo_path: String, branch: String, base: String) -> Result<IntegrateResult> {
    git::integrate::integrate(Path::new(&repo_path), &branch, &base)
}

/// Merge a worktree's branch into base and, on success, remove the worktree.
#[tauri::command]
fn land_worktree(
    repo_path: String,
    worktree_path: String,
    branch: String,
    base: String,
) -> Result<IntegrateResult> {
    git::integrate::land(
        Path::new(&repo_path),
        Path::new(&worktree_path),
        &branch,
        &base,
    )
}

// ---------------------------------------------------------------------------
// Session persistence
// ---------------------------------------------------------------------------

fn state_path(app: &AppHandle) -> Result<std::path::PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| QuayError::Invalid(format!("no app data dir: {e}")))?;
    Ok(dir.join("state.json"))
}

#[tauri::command]
fn load_state(app: AppHandle) -> Result<PersistedState> {
    persist::load(&state_path(&app)?)
}

#[tauri::command]
fn save_state(app: AppHandle, state: PersistedState) -> Result<()> {
    persist::save(&state_path(&app)?, &state)
}

// ---------------------------------------------------------------------------
// PTY commands + manager state
// ---------------------------------------------------------------------------

/// Holds live PTYs keyed by a string id, so the frontend can address them.
#[derive(Default)]
struct PtyManager {
    next_id: AtomicU64,
    handles: Mutex<HashMap<String, pty::PtyHandle>>,
}

impl PtyManager {
    fn with_handle<R>(
        &self,
        id: &str,
        f: impl FnOnce(&mut pty::PtyHandle) -> Result<R>,
    ) -> Result<R> {
        let mut handles = self
            .handles
            .lock()
            .map_err(|_| QuayError::Pty("pty manager lock poisoned".into()))?;
        let handle = handles
            .get_mut(id)
            .ok_or_else(|| QuayError::Pty(format!("no pty with id {id}")))?;
        f(handle)
    }
}

/// Spawn a process in a PTY rooted at `cwd`. Output streams to the frontend
/// as `pty://output/<id>` events; an exit fires `pty://exit/<id>`.
#[tauri::command]
fn pty_spawn(
    app: AppHandle,
    state: State<PtyManager>,
    cwd: String,
    command: String,
    args: Vec<String>,
    cols: u16,
    rows: u16,
) -> Result<String> {
    let (handle, rx) = pty::spawn(Path::new(&cwd), &command, &args, cols, rows)?;
    let id = state.next_id.fetch_add(1, Ordering::Relaxed).to_string();

    let app_for_thread = app.clone();
    let id_for_thread = id.clone();
    std::thread::spawn(move || {
        while let Ok(chunk) = rx.recv() {
            let payload = String::from_utf8_lossy(&chunk).into_owned();
            let _ = app_for_thread.emit(&format!("pty://output/{id_for_thread}"), payload);
        }
        let _ = app_for_thread.emit(&format!("pty://exit/{id_for_thread}"), ());
    });

    state
        .handles
        .lock()
        .map_err(|_| QuayError::Pty("pty manager lock poisoned".into()))?
        .insert(id.clone(), handle);
    Ok(id)
}

#[tauri::command]
fn pty_write(state: State<PtyManager>, id: String, data: String) -> Result<()> {
    state.with_handle(&id, |h| h.write(data.as_bytes()))
}

#[tauri::command]
fn pty_resize(state: State<PtyManager>, id: String, cols: u16, rows: u16) -> Result<()> {
    state.with_handle(&id, |h| h.resize(cols, rows))
}

/// Liveness of a PTY: `None` exit code means still running, `Some(code)`
/// means the process has exited. Drives the agent deck's status badges.
#[derive(serde::Serialize)]
struct PtyStatus {
    running: bool,
    exit_code: Option<u32>,
}

/// Recent output of a PTY, for reattach/replay into a fresh terminal view.
#[tauri::command]
fn pty_scrollback(state: State<PtyManager>, id: String) -> Result<String> {
    state.with_handle(&id, |h| Ok(String::from_utf8_lossy(&h.scrollback()).into_owned()))
}

#[tauri::command]
fn pty_status(state: State<PtyManager>, id: String) -> Result<PtyStatus> {
    state.with_handle(&id, |h| {
        let exit_code = h.try_wait()?;
        Ok(PtyStatus {
            running: exit_code.is_none(),
            exit_code,
        })
    })
}

#[tauri::command]
fn pty_kill(state: State<PtyManager>, id: String) -> Result<()> {
    let mut handles = state
        .handles
        .lock()
        .map_err(|_| QuayError::Pty("pty manager lock poisoned".into()))?;
    if let Some(mut handle) = handles.remove(&id) {
        handle.kill()?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Agent SDK commands + manager (a more powerful alternative to the CLI
// terminal: runs an agent via the Agent SDK and streams structured events).
// ---------------------------------------------------------------------------

#[derive(Default)]
struct AgentManager {
    next_id: AtomicU64,
    handles: Mutex<HashMap<String, agent::AgentHandle>>,
}

/// Start an agent run in `cwd` with `prompt`. Streams the SDK's NDJSON messages
/// as `agent://event/<id>`; fires `agent://exit/<id>` when the run ends.
#[tauri::command]
fn agent_start(
    app: AppHandle,
    state: State<AgentManager>,
    cwd: String,
    prompt: String,
    model: Option<String>,
    resume: Option<String>,
) -> Result<String> {
    let (handle, rx) = agent::start(&prompt, Path::new(&cwd), model.as_deref(), resume.as_deref())?;
    let id = state.next_id.fetch_add(1, Ordering::Relaxed).to_string();

    let app_for_thread = app.clone();
    let id_for_thread = id.clone();
    std::thread::spawn(move || {
        while let Ok(line) = rx.recv() {
            let _ = app_for_thread.emit(&format!("agent://event/{id_for_thread}"), line);
        }
        let _ = app_for_thread.emit(&format!("agent://exit/{id_for_thread}"), ());
    });

    state
        .handles
        .lock()
        .map_err(|_| QuayError::Pty("agent manager lock poisoned".into()))?
        .insert(id.clone(), handle);
    Ok(id)
}

#[tauri::command]
fn agent_stop(state: State<AgentManager>, id: String) -> Result<()> {
    let mut handles = state
        .handles
        .lock()
        .map_err(|_| QuayError::Pty("agent manager lock poisoned".into()))?;
    if let Some(mut handle) = handles.remove(&id) {
        handle.kill()?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(PtyManager::default())
        .manage(AgentManager::default())
        .invoke_handler(tauri::generate_handler![
            list_worktrees,
            create_worktree,
            remove_worktree,
            diff_branch_vs_base,
            narrate_diff,
            commit_timeline,
            ask_diff,
            worktree_status,
            suggest_commit_message,
            commit_worktree,
            push_branch,
            open_pr,
            integrate_branch,
            land_worktree,
            load_state,
            save_state,
            pty_spawn,
            pty_write,
            pty_resize,
            pty_scrollback,
            pty_status,
            pty_kill,
            agent_start,
            agent_stop,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
