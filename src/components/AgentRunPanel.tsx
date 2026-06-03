import { useState } from "react";
import type { AgentEvent, AgentRun } from "../lib/agent";

interface Props {
  run: AgentRun | undefined;
  busy: boolean;
  onStart: (task: string) => void;
  onStop: () => void;
}

/**
 * Agent mode: give the worktree's agent a task and watch the SDK run it as a
 * structured feed — assistant messages, each tool call, and a final result
 * with cost/turns. More powerful than the raw CLI terminal; uses API credits.
 */
export function AgentRunPanel({ run, busy, onStart, onStop }: Props) {
  const [task, setTask] = useState("");
  const running = run?.running ?? false;
  const events = run?.events ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start gap-2 border-b border-[var(--color-border)] px-5 py-3">
        <textarea
          value={task}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onStart(task);
          }}
          placeholder="give this agent a task…  (⌘/Ctrl+Enter to run)"
          rows={2}
          className="min-h-[2.4rem] flex-1 resize-y rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-panel-2)] px-2 py-1.5 text-[13px] outline-none focus:border-[var(--color-accent-dim)]"
        />
        {running ? (
          <button
            type="button"
            onClick={onStop}
            className="rounded-[var(--radius)] border border-[var(--color-del)] px-3 py-1.5 text-[12px] text-[var(--color-del)]"
          >
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onStart(task)}
            disabled={busy || !task.trim()}
            className="rounded-[var(--radius)] border border-[var(--color-accent-dim)] bg-[var(--color-panel-2)] px-3 py-1.5 text-[12px] text-[var(--color-accent)] disabled:opacity-50"
          >
            ▸ Run
          </button>
        )}
      </div>

      <div className="flex-1 space-y-1.5 overflow-y-auto px-5 py-4">
        {events.length === 0 && !running && (
          <p className="text-[13px] text-[var(--color-fg-subtle)]">
            The agent will work autonomously in this worktree and stream its
            steps here. Review and land its changes from the Diff view.
          </p>
        )}
        {events.map((e, i) => (
          <FeedLine key={i} event={e} />
        ))}
        {running && <div className="text-[13px] text-[var(--color-fg-subtle)]">working…</div>}
      </div>
    </div>
  );
}

function FeedLine({ event }: { event: AgentEvent }) {
  switch (event.kind) {
    case "assistant":
      return (
        <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--color-fg)]">
          {event.text}
        </div>
      );
    case "tool":
      return (
        <div className="flex items-baseline gap-2 font-mono text-[12px]">
          <span className="rounded-[var(--radius)] bg-[var(--color-panel-2)] px-1.5 py-0.5 text-[var(--color-accent)]">
            {event.tool}
          </span>
          <span className="truncate text-[var(--color-fg-subtle)]">
            {event.text.replace(`${event.tool}: `, "")}
          </span>
        </div>
      );
    case "result":
      return (
        <div className="mt-1 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 text-[13px]">
          <div className="text-[var(--color-fg)]">{event.text}</div>
          {(event.costUsd != null || event.turns != null) && (
            <div className="mt-1 font-mono text-[11px] text-[var(--color-fg-subtle)]">
              {event.turns != null && `${event.turns} turns`}
              {event.costUsd != null && ` · $${event.costUsd.toFixed(4)}`}
            </div>
          )}
        </div>
      );
    case "error":
      return <div className="font-mono text-[12px] text-[var(--color-del)]">{event.text}</div>;
    case "start":
    case "system":
    case "done":
      return (
        <div className="text-[11px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
          {event.text}
        </div>
      );
    default:
      return (
        <div className="font-mono text-[11px] text-[var(--color-fg-subtle)]">{event.text}</div>
      );
  }
}
