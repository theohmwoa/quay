import { useState } from "react";
import type { AgentEvent, Chat } from "../lib/agent";

interface Props {
  chat: Chat | undefined;
  busy: boolean;
  onSend: (message: string) => void;
  onStop: () => void;
}

/**
 * A multi-turn chat with Claude in the selected worktree, powered by the Agent
 * SDK (which runs on your Claude subscription). Each turn streams the agent's
 * steps — assistant text, tool calls, and a final result — and the next turn
 * resumes the same Claude session.
 */
export function ChatPanel({ chat, busy, onSend, onStop }: Props) {
  const [input, setInput] = useState("");
  const running = chat?.running ?? false;
  const turns = chat?.turns ?? [];

  const send = () => {
    const m = input.trim();
    if (!m || running) return;
    setInput("");
    onSend(m);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {turns.length === 0 && !running && (
          <p className="text-[13px] text-[var(--color-fg-subtle)]">
            Chat with Claude in this worktree. It can read, edit, and run
            things here; review and land its changes from the Diff view.
          </p>
        )}
        {turns.map((turn, i) => (
          <div key={i} className="space-y-2">
            <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2 text-[13px] text-[var(--color-fg)]">
              {turn.question}
            </div>
            <div className="space-y-1.5 pl-1">
              {turn.events.map((e, j) => (
                <FeedLine key={j} event={e} />
              ))}
            </div>
          </div>
        ))}
        {running && <div className="pl-1 text-[13px] text-[var(--color-fg-subtle)]">…</div>}
      </div>

      <div className="flex items-end gap-2 border-t border-[var(--color-border)] px-5 py-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={running ? "Claude is working…" : "Message Claude…  (Enter to send, Shift+Enter for newline)"}
          rows={1}
          disabled={running}
          className="max-h-40 min-h-[2.2rem] flex-1 resize-y rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-panel-2)] px-2 py-1.5 text-[13px] outline-none focus:border-[var(--color-accent-dim)] disabled:opacity-60"
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
            onClick={send}
            disabled={busy || !input.trim()}
            className="rounded-[var(--radius)] border border-[var(--color-accent-dim)] bg-[var(--color-panel-2)] px-3 py-1.5 text-[12px] text-[var(--color-accent)] disabled:opacity-50"
          >
            Send
          </button>
        )}
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
        <div className="text-[11px] text-[var(--color-fg-subtle)]">
          {event.turns != null && `${event.turns} turns`}
          {event.costUsd != null && ` · $${event.costUsd.toFixed(4)}`}
        </div>
      );
    case "error":
      return <div className="font-mono text-[12px] text-[var(--color-del)]">{event.text}</div>;
    default:
      return null;
  }
}
