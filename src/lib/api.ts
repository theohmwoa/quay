// Typed bridge to the Rust core. Each function maps 1:1 to a Tauri command;
// the types mirror the serde structs in src-tauri/src/*.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface Worktree {
  path: string;
  branch: string | null;
  head: string | null;
  is_main: boolean;
  locked: boolean;
}

export type FileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "other";

export interface DiffLine {
  origin: string; // "+", "-", or " "
  content: string;
  old_lineno: number | null;
  new_lineno: number | null;
}

export interface Hunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffFile {
  path: string;
  old_path: string | null;
  status: FileStatus;
  additions: number;
  deletions: number;
  binary: boolean;
  hunks: Hunk[];
}

export interface DiffSummary {
  base: string;
  head: string;
  files: DiffFile[];
  total_additions: number;
  total_deletions: number;
}

export interface Cluster {
  title: string;
  description: string;
  files: string[];
}

export interface FileNote {
  path: string;
  note: string;
}

export interface Narration {
  summary: string;
  clusters: Cluster[];
  file_notes: FileNote[];
  risks: string[];
  engine: string; // "mock" | "haiku"
}

export interface PtyStatus {
  running: boolean;
  exit_code: number | null;
}

// --- Worktrees -------------------------------------------------------------

export const listWorktrees = (repoPath: string) =>
  invoke<Worktree[]>("list_worktrees", { repoPath });

export const createWorktree = (repoPath: string, name: string, base: string) =>
  invoke<Worktree>("create_worktree", { repoPath, name, base });

export const removeWorktree = (repoPath: string, path: string, force = false) =>
  invoke<void>("remove_worktree", { repoPath, path, force });

// --- Diff + narration ------------------------------------------------------

export const diffBranchVsBase = (repoPath: string, base: string) =>
  invoke<DiffSummary>("diff_branch_vs_base", { repoPath, base });

export const narrateDiff = (repoPath: string, base: string) =>
  invoke<Narration>("narrate_diff", { repoPath, base });

// --- PTY -------------------------------------------------------------------

export const ptySpawn = (
  cwd: string,
  command: string,
  args: string[],
  cols: number,
  rows: number,
) => invoke<string>("pty_spawn", { cwd, command, args, cols, rows });

export const ptyWrite = (id: string, data: string) =>
  invoke<void>("pty_write", { id, data });

export const ptyResize = (id: string, cols: number, rows: number) =>
  invoke<void>("pty_resize", { id, cols, rows });

export const ptyStatus = (id: string) =>
  invoke<PtyStatus>("pty_status", { id });

export const ptyKill = (id: string) => invoke<void>("pty_kill", { id });

/** Subscribe to a PTY's output stream. Returns an unlisten function. */
export const onPtyOutput = (id: string, cb: (chunk: string) => void): Promise<UnlistenFn> =>
  listen<string>(`pty://output/${id}`, (e) => cb(e.payload));

/** Subscribe to a PTY exit. Returns an unlisten function. */
export const onPtyExit = (id: string, cb: () => void): Promise<UnlistenFn> =>
  listen(`pty://exit/${id}`, () => cb());

export const ptyScrollback = (id: string) =>
  invoke<string>("pty_scrollback", { id });

// --- Lifecycle: status / commit / push / PR / land -------------------------

export interface WorktreeStatus {
  branch: string | null;
  staged: string[];
  unstaged: string[];
  untracked: string[];
  ahead: number;
  behind: number;
  clean: boolean;
}

export type IntegrateResult =
  | { kind: "merged"; sha: string }
  | { kind: "uptodate"; sha: string }
  | { kind: "conflicts"; files: string[] };

export const worktreeStatus = (repoPath: string, base: string) =>
  invoke<WorktreeStatus>("worktree_status", { repoPath, base });

export const suggestCommitMessage = (repoPath: string, base: string) =>
  invoke<string>("suggest_commit_message", { repoPath, base });

export const commitWorktree = (repoPath: string, message: string) =>
  invoke<string>("commit_worktree", { repoPath, message });

export const pushBranch = (repoPath: string, remote: string, branch: string) =>
  invoke<void>("push_branch", { repoPath, remote, branch });

export const openPr = (
  repoPath: string,
  title: string,
  body: string,
  base: string,
  head: string,
) => invoke<string>("open_pr", { repoPath, title, body, base, head });

export const integrateBranch = (repoPath: string, branch: string, base: string) =>
  invoke<IntegrateResult>("integrate_branch", { repoPath, branch, base });

export const landWorktree = (
  repoPath: string,
  worktreePath: string,
  branch: string,
  base: string,
) => invoke<IntegrateResult>("land_worktree", { repoPath, worktreePath, branch, base });

// --- Diff review: timeline + ask -------------------------------------------

export interface TimelineEntry {
  sha: string;
  subject: string;
  author: string;
  diff: DiffSummary;
}

export const commitTimeline = (repoPath: string, base: string) =>
  invoke<TimelineEntry[]>("commit_timeline", { repoPath, base });

export const askDiff = (repoPath: string, base: string, question: string) =>
  invoke<string>("ask_diff", { repoPath, base, question });

// --- Session persistence ---------------------------------------------------

export interface PersistedSession {
  path: string;
  program: string;
  claude_session_id?: string;
}

export interface PersistedState {
  repo_path: string;
  base: string;
  sessions: PersistedSession[];
}

export const loadState = () => invoke<PersistedState>("load_state");

export const saveState = (state: PersistedState) =>
  invoke<void>("save_state", { state });

// --- Agent SDK runs (structured, more powerful alternative to the CLI) ------

export const agentStart = (cwd: string, prompt: string, resume?: string, model?: string) =>
  invoke<string>("agent_start", { cwd, prompt, model: model ?? null, resume: resume ?? null });

export const agentStop = (id: string) => invoke<void>("agent_stop", { id });

/** Subscribe to an agent run's NDJSON event stream. */
export const onAgentEvent = (id: string, cb: (line: string) => void): Promise<UnlistenFn> =>
  listen<string>(`agent://event/${id}`, (e) => cb(e.payload));

/** Subscribe to an agent run finishing. */
export const onAgentExit = (id: string, cb: () => void): Promise<UnlistenFn> =>
  listen(`agent://exit/${id}`, () => cb());
