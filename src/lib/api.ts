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
