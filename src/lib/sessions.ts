// Terminal-session bookkeeping — the rules that keep PTYs alive across
// view/program/worktree switches, and tie a Claude terminal to a specific
// Claude session id so it can be resumed. Pure and unit-tested.

import { basename } from "./format";

export type View = "terminal" | "diff" | "timeline" | "ask";
export type Program = "shell" | "claude";

/** A live terminal: one PTY per (worktree path, program). */
export interface Session {
  path: string;
  program: Program;
  /** For claude sessions: the Claude session UUID this terminal is bound to. */
  claudeSessionId?: string;
  /** True when this session was restored from disk and should be resumed
   *  (rather than started fresh). Transient — not persisted. */
  resume?: boolean;
}

/** Stable identity for a session (used as the React key and PTY session key). */
export const sessionKey = (path: string, program: Program): string =>
  `${path} ${program}`;

/** The program's launch command. */
export const commandFor = (program: Program): string =>
  program === "claude" ? "claude" : "zsh";

/**
 * CLI arguments for launching a session's program.
 *
 * For a Claude terminal bound to a session id:
 *   - fresh this run → `--session-id <id> --name <branch>` (creates that id)
 *   - restored from disk → `--resume <id>` (drops back into the conversation)
 * Shell terminals (and unbound claude) take no special args.
 */
export function programArgs(s: Session): string[] {
  if (s.program !== "claude" || !s.claudeSessionId) return [];
  if (s.resume) return ["--resume", s.claudeSessionId];
  return ["--session-id", s.claudeSessionId, "--name", basename(s.path)];
}

/**
 * Ensure a session for (path, program) exists, returning the same array
 * reference when it already does. Opening never removes existing sessions —
 * that's what keeps a running Claude alive when you switch away and back.
 */
export function upsertSession(
  sessions: Session[],
  path: string,
  program: Program,
  extra?: Partial<Session>,
): Session[] {
  if (sessions.some((s) => s.path === path && s.program === program)) {
    return sessions;
  }
  return [...sessions, { path, program, ...extra }];
}

/**
 * Whether a session is the one currently shown and driven. Only the active
 * session is visible and interactive; everything else is mounted-but-hidden
 * (alive) and must not receive input.
 */
export function isSessionActive(
  s: Session,
  view: View,
  selectedPath: string | null,
  program: Program,
): boolean {
  return view === "terminal" && s.path === selectedPath && s.program === program;
}
