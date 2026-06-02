import { useState } from "react";

interface QA {
  question: string;
  answer: string;
}

interface Props {
  /** Ask a question about the current diff; resolves with the answer. */
  ask: (question: string) => Promise<string>;
}

/**
 * "Ask Haiku about this diff" — a small Q&A chat over the current branch diff.
 * Useful for interrogating a change ("why did it touch X?", "is this safe?").
 */
export function AskPanel({ ask }: Props) {
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<QA[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const q = input.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    setInput("");
    try {
      const answer = await ask(q);
      setHistory((h) => [...h, { question: q, answer }]);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {history.length === 0 && !busy && (
          <p className="text-[13px] text-[var(--color-fg-subtle)]">
            Ask a question about this change — e.g. “what's the risk here?”
          </p>
        )}
        {history.map((qa, i) => (
          <div key={i} className="space-y-1">
            <div className="text-[13px] font-medium text-[var(--color-accent)]">{qa.question}</div>
            <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--color-fg-muted)]">
              {qa.answer}
            </div>
          </div>
        ))}
        {busy && <div className="text-[13px] text-[var(--color-fg-subtle)]">thinking…</div>}
        {error && (
          <div className="font-mono text-[12px] text-[var(--color-del)]">{error}</div>
        )}
      </div>
      <div className="flex gap-2 border-t border-[var(--color-border)] px-5 py-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
          placeholder="ask about this diff…"
          className="flex-1 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-panel-2)] px-2 py-1.5 text-[13px] outline-none focus:border-[var(--color-accent-dim)]"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !input.trim()}
          className="rounded-[var(--radius)] border border-[var(--color-accent-dim)] bg-[var(--color-panel-2)] px-3 py-1 text-[12px] text-[var(--color-accent)] disabled:opacity-50"
        >
          Ask
        </button>
      </div>
    </div>
  );
}
