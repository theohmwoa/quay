import type { Worktree } from "../lib/api";
import { basename, worktreeLabel } from "../lib/format";

interface Props {
  worktrees: Worktree[];
  selectedPath: string | null;
  busy?: boolean;
  onSelect: (path: string) => void;
  onNewAgent: () => void;
  onRefresh: () => void;
}

/**
 * The agent deck: every worktree at a glance. The primary worktree is tagged;
 * the rest are agent berths you can select to drive a terminal + see its diff.
 */
export function AgentDeck({
  worktrees,
  selectedPath,
  busy,
  onSelect,
  onNewAgent,
  onRefresh,
}: Props) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]">
          Agent Deck
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onRefresh}
            title="Refresh worktrees"
            className="rounded-[var(--radius)] px-1.5 py-0.5 text-[var(--color-fg-subtle)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-fg)]"
          >
            ↻
          </button>
          <button
            type="button"
            onClick={onNewAgent}
            disabled={busy}
            title="New agent (worktree + branch)"
            className="rounded-[var(--radius)] border border-[var(--color-border-strong)] bg-[var(--color-panel-2)] px-2 py-0.5 text-[12px] text-[var(--color-fg)] hover:border-[var(--color-accent-dim)] disabled:opacity-50"
          >
            + New
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-1.5">
        {worktrees.length === 0 ? (
          <p className="px-2 py-6 text-center text-[12px] text-[var(--color-fg-subtle)]">
            No worktrees yet.
          </p>
        ) : (
          <ul className="space-y-1">
            {worktrees.map((wt) => {
              const selected = wt.path === selectedPath;
              return (
                <li key={wt.path}>
                  <button
                    type="button"
                    onClick={() => onSelect(wt.path)}
                    className={`flex w-full items-center gap-2 rounded-[var(--radius)] border px-2.5 py-2 text-left ${
                      selected
                        ? "border-[var(--color-accent-dim)] bg-[var(--color-panel-2)]"
                        : "border-transparent hover:border-[var(--color-border)] hover:bg-[var(--color-panel)]"
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        wt.is_main
                          ? "bg-[var(--color-fg-subtle)]"
                          : "bg-[var(--color-accent)]"
                      }`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[12px] text-[var(--color-fg)]">
                        {worktreeLabel(wt.branch, wt.head, wt.path)}
                      </span>
                      <span className="block truncate text-[11px] text-[var(--color-fg-subtle)]">
                        {basename(wt.path)}
                      </span>
                    </span>
                    {wt.is_main && (
                      <span className="shrink-0 rounded-[var(--radius)] bg-[var(--color-panel-2)] px-1 py-0.5 text-[10px] uppercase tracking-wide text-[var(--color-fg-subtle)]">
                        main
                      </span>
                    )}
                    {wt.locked && (
                      <span title="locked" aria-hidden className="text-[var(--color-fg-subtle)]">
                        🔒
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
