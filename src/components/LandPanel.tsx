import type { WorktreeStatus } from "../lib/api";
import { canCommit, canLand, landBlockedReason, statusSummary } from "../lib/status";

interface Props {
  status: WorktreeStatus | null;
  busy: boolean;
  message: string;
  onMessageChange: (m: string) => void;
  onSuggest: () => void;
  onCommit: () => void;
  onPush: () => void;
  onOpenPr: () => void;
  onLand: () => void;
  onDiscard: () => void;
  /** Last action outcome (PR url, landed sha, conflict note…). */
  notice: string | null;
}

/**
 * The "land the work" surface: shows worktree status and the lifecycle
 * actions — commit (with a suggested message), push, open PR, merge into base
 * (land), or discard the worktree. Buttons enable/disable from the status.
 */
export function LandPanel({
  status,
  busy,
  message,
  onMessageChange,
  onSuggest,
  onCommit,
  onPush,
  onOpenPr,
  onLand,
  onDiscard,
  notice,
}: Props) {
  const commitOk = !!status && canCommit(status);
  const landOk = !!status && canLand(status);
  const landReason = status ? landBlockedReason(status) : "";

  return (
    <div className="flex flex-col gap-3 border-b border-[var(--color-border)] bg-[var(--color-panel)] px-5 py-3">
      <div className="flex items-center gap-3">
        <span className="text-[11px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
          {status?.branch ?? "—"}
        </span>
        <span className="font-mono text-[12px] text-[var(--color-fg-muted)]">
          {status ? statusSummary(status) : "…"}
        </span>
        <button
          type="button"
          onClick={onDiscard}
          disabled={busy}
          className="ml-auto rounded-[var(--radius)] px-2 py-1 text-[12px] text-[var(--color-fg-subtle)] hover:text-[var(--color-del)] disabled:opacity-50"
        >
          Discard worktree
        </button>
      </div>

      <div className="flex items-start gap-2">
        <textarea
          value={message}
          onChange={(e) => onMessageChange(e.target.value)}
          placeholder="commit message…"
          rows={2}
          className="min-h-[2.2rem] flex-1 resize-y rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-panel-2)] px-2 py-1.5 font-mono text-[12px] outline-none focus:border-[var(--color-accent-dim)]"
        />
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={onSuggest}
            disabled={busy}
            title="Generate a commit message"
            className="rounded-[var(--radius)] border border-[var(--color-border-strong)] bg-[var(--color-panel-2)] px-2 py-1 text-[12px] text-[var(--color-accent)] hover:border-[var(--color-accent-dim)] disabled:opacity-50"
          >
            ✦ Suggest
          </button>
          <button
            type="button"
            onClick={onCommit}
            disabled={busy || !commitOk || !message.trim()}
            className="rounded-[var(--radius)] border border-[var(--color-border-strong)] bg-[var(--color-panel-2)] px-2 py-1 text-[12px] disabled:opacity-50"
          >
            Commit
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPush}
          disabled={busy}
          className="rounded-[var(--radius)] border border-[var(--color-border)] px-2.5 py-1 text-[12px] text-[var(--color-fg-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-fg)] disabled:opacity-50"
        >
          Push
        </button>
        <button
          type="button"
          onClick={onOpenPr}
          disabled={busy}
          className="rounded-[var(--radius)] border border-[var(--color-border)] px-2.5 py-1 text-[12px] text-[var(--color-fg-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-fg)] disabled:opacity-50"
        >
          Open PR
        </button>
        <button
          type="button"
          onClick={onLand}
          disabled={busy || !landOk}
          title={landReason}
          className="rounded-[var(--radius)] border border-[var(--color-accent-dim)] bg-[var(--color-panel-2)] px-2.5 py-1 text-[12px] text-[var(--color-accent)] disabled:opacity-50"
        >
          Land → base
        </button>
        {landReason && !landOk && (
          <span className="text-[11px] text-[var(--color-fg-subtle)]">{landReason}</span>
        )}
      </div>

      {notice && (
        <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-panel-2)] px-2 py-1 font-mono text-[11px] text-[var(--color-fg-muted)]">
          {notice}
        </div>
      )}
    </div>
  );
}
