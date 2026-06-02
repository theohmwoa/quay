// Pure display helpers — no React, no Tauri. Unit-tested in format.test.ts.

import type { FileStatus } from "./api";

/** Single-letter badge for a file status, GitHub-style. */
export function statusBadge(status: FileStatus): string {
  switch (status) {
    case "added":
      return "A";
    case "modified":
      return "M";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "copied":
      return "C";
    default:
      return "•";
  }
}

/** Human label for a file status. */
export function statusLabel(status: FileStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/** Tailwind text-color class for a status badge. */
export function statusColor(status: FileStatus): string {
  switch (status) {
    case "added":
      return "text-[var(--color-add)]";
    case "deleted":
      return "text-[var(--color-del)]";
    case "renamed":
    case "copied":
      return "text-[var(--color-accent)]";
    default:
      return "text-[var(--color-fg-muted)]";
  }
}

/** "+12 −3" style stat string. Uses a real minus glyph for alignment. */
export function formatStat(additions: number, deletions: number): string {
  return `+${additions} −${deletions}`;
}

/** Final path segment (filename). */
export function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

/** Directory portion of a path, or "" for root-level files. */
export function dirname(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

/**
 * Render a fixed-width add/delete bar as filled/empty blocks (max `width`),
 * proportional to the share of additions. Used in the diff file list.
 */
export function statBar(additions: number, deletions: number, width = 5): string {
  const total = additions + deletions;
  if (total === 0) return "·".repeat(width);
  const greens = Math.max(
    additions > 0 ? 1 : 0,
    Math.round((additions / total) * width),
  );
  const reds = Math.max(0, width - greens);
  return "■".repeat(greens) + "□".repeat(reds);
}

/** Short label for a worktree row: branch name, or short head, or path tail. */
export function worktreeLabel(branch: string | null, head: string | null, path: string): string {
  if (branch) return branch;
  if (head) return head.slice(0, 8);
  return basename(path);
}
