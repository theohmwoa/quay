// Pure helpers over WorktreeStatus — what the badges show and which lifecycle
// actions are allowed. Unit-tested.

import type { WorktreeStatus } from "./api";

/** Total number of changed paths (staged + unstaged + untracked). */
export function changedCount(st: WorktreeStatus): number {
  return st.staged.length + st.unstaged.length + st.untracked.length;
}

/** A compact one-line status, e.g. "3 changed · ↑2 ↓1" or "clean · ↑2". */
export function statusSummary(st: WorktreeStatus): string {
  const parts: string[] = [];
  const changed = changedCount(st);
  parts.push(changed === 0 ? "clean" : `${changed} changed`);
  const arrows: string[] = [];
  if (st.ahead > 0) arrows.push(`↑${st.ahead}`);
  if (st.behind > 0) arrows.push(`↓${st.behind}`);
  if (arrows.length) parts.push(arrows.join(" "));
  return parts.join(" · ");
}

/** Can we make a commit? Only if there's something changed to commit. */
export function canCommit(st: WorktreeStatus): boolean {
  return changedCount(st) > 0;
}

/** Can we land (merge to base)? Need commits ahead and a clean tree. */
export function canLand(st: WorktreeStatus): boolean {
  return st.ahead > 0 && st.clean;
}

/** Why landing is blocked, for a helpful tooltip (empty string if allowed). */
export function landBlockedReason(st: WorktreeStatus): string {
  if (!st.clean) return "Commit or discard your changes first.";
  if (st.ahead === 0) return "Nothing to land — no commits ahead of base.";
  return "";
}
