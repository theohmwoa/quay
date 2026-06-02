// Terminal-session bookkeeping — the rules that keep PTYs alive across
// view/program/worktree switches. Pure and unit-tested; App holds the state.

export type View = "terminal" | "diff";
export type Program = "shell" | "claude";

/** A live terminal: one PTY per (worktree path, program). */
export interface Session {
  path: string;
  program: Program;
}

/** Stable identity for a session (used as the React key and PTY session key). */
export const sessionKey = (path: string, program: Program): string =>
  `${path} ${program}`;

/** The program's launch command. */
export const commandFor = (program: Program): string =>
  program === "claude" ? "claude" : "zsh";

/**
 * Ensure a session for (path, program) exists, returning the same array
 * reference when it already does (so React doesn't re-render needlessly).
 * Opening a session never removes existing ones — that's what keeps a running
 * Claude alive when you switch away and back.
 */
export function upsertSession(
  sessions: Session[],
  path: string,
  program: Program,
): Session[] {
  if (sessions.some((s) => s.path === path && s.program === program)) {
    return sessions;
  }
  return [...sessions, { path, program }];
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
