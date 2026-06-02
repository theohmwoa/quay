import { useState } from "react";
import type { TimelineEntry } from "../lib/api";
import { basename, dirname, formatStat, statusBadge, statusColor } from "../lib/format";

interface Props {
  entries: TimelineEntry[];
}

/**
 * The branch as a sequence of commits, each expandable to the files it
 * touched. Reads the work as intentful steps rather than one blob — the commit
 * subject is the author's own narration of the step.
 */
export function DiffTimeline({ entries }: Props) {
  if (entries.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-[var(--color-fg-subtle)]">
        No commits on this branch yet.
      </div>
    );
  }
  return (
    <div className="h-full overflow-y-auto px-5 py-4">
      <h2 className="mb-3 text-[11px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
        {entries.length} commit{entries.length === 1 ? "" : "s"}
      </h2>
      <ol className="space-y-2">
        {entries.map((e) => (
          <CommitRow key={e.sha} entry={e} />
        ))}
      </ol>
    </div>
  );
}

function CommitRow({ entry }: { entry: TimelineEntry }) {
  const [open, setOpen] = useState(false);
  const { diff } = entry;
  return (
    <li className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-panel)]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-[var(--color-panel-2)]"
      >
        <span className="font-mono text-[11px] text-[var(--color-accent)]">{entry.sha}</span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--color-fg)]">
          {entry.subject || "(no subject)"}
        </span>
        <span className="hidden text-[11px] text-[var(--color-fg-subtle)] md:inline">
          {entry.author}
        </span>
        <span className="font-mono text-[11px] text-[var(--color-fg-subtle)]">
          {formatStat(diff.total_additions, diff.total_deletions)}
        </span>
      </button>
      {open && (
        <ul className="border-t border-[var(--color-border)] px-3 py-2">
          {diff.files.map((f) => {
            const dir = dirname(f.path);
            return (
              <li key={f.path} className="flex items-center gap-2 py-0.5 font-mono text-[12px]">
                <span className={`w-3 ${statusColor(f.status)}`}>{statusBadge(f.status)}</span>
                <span className="min-w-0 flex-1 truncate">
                  {dir && <span className="text-[var(--color-fg-subtle)]">{dir}/</span>}
                  <span className="text-[var(--color-fg)]">{basename(f.path)}</span>
                </span>
                <span className="text-[var(--color-fg-subtle)]">
                  {formatStat(f.additions, f.deletions)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
