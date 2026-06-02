import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  createWorktree,
  diffBranchVsBase,
  listWorktrees,
  narrateDiff,
  type DiffSummary,
  type Narration,
  type Worktree,
} from "./lib/api";
import { AgentDeck } from "./components/AgentDeck";
import { NarratedDiff } from "./components/NarratedDiff";
import { TerminalView } from "./components/TerminalView";
import {
  commandFor,
  isSessionActive,
  sessionKey,
  upsertSession,
  type Program,
  type Session,
  type View,
} from "./lib/sessions";

const LS_REPO = "quay.repoPath";
const LS_BASE = "quay.base";
const NO_ARGS: string[] = [];

function App() {
  const [repoPath, setRepoPath] = useState(() => localStorage.getItem(LS_REPO) ?? "");
  const [repoInput, setRepoInput] = useState(repoPath);
  const [base, setBase] = useState(() => localStorage.getItem(LS_BASE) ?? "main");

  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [view, setView] = useState<View>("terminal");
  const [program, setProgram] = useState<Program>("shell");

  // Every terminal the user has opened stays mounted (and its PTY alive) so
  // switching view/program/worktree never kills a running session.
  const [sessions, setSessions] = useState<Session[]>([]);

  const [diff, setDiff] = useState<DiffSummary | null>(null);
  const [narration, setNarration] = useState<Narration | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  const refreshWorktrees = useCallback(async () => {
    if (!repoPath) return;
    try {
      const wts = await listWorktrees(repoPath);
      setWorktrees(wts);
      setError(null);
      setSelectedPath((cur) => cur ?? wts.find((w) => !w.is_main)?.path ?? wts[0]?.path ?? null);
    } catch (e) {
      setError(String(e));
      setWorktrees([]);
    }
  }, [repoPath]);

  useEffect(() => {
    void refreshWorktrees();
  }, [refreshWorktrees]);

  // Lazily open (and thereafter keep) a terminal session for the active
  // worktree + program once the terminal view is shown for it.
  useEffect(() => {
    if (view !== "terminal" || !selectedPath) return;
    setSessions((prev) => upsertSession(prev, selectedPath, program));
  }, [view, selectedPath, program]);

  // Load the narrated diff whenever the diff view is shown for a selection.
  useEffect(() => {
    if (view !== "diff" || !selectedPath) return;
    let cancelled = false;
    setDiffLoading(true);
    setError(null);
    Promise.all([diffBranchVsBase(selectedPath, base), narrateDiff(selectedPath, base)])
      .then(([d, n]) => {
        if (cancelled) return;
        setDiff(d);
        setNarration(n);
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setDiffLoading(false));
    return () => {
      cancelled = true;
    };
  }, [view, selectedPath, base]);

  const openRepo = () => {
    const p = repoInput.trim();
    setRepoPath(p);
    localStorage.setItem(LS_REPO, p);
    setSelectedPath(null);
  };

  const submitNewAgent = async () => {
    if (!repoPath || !newName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const wt = await createWorktree(repoPath, newName.trim(), base);
      setShowNew(false);
      setNewName("");
      await refreshWorktrees();
      setSelectedPath(wt.path);
      setProgram("claude");
      setView("terminal");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex h-full flex-col bg-[var(--color-bg)] text-[var(--color-fg)]">
      {/* Top bar */}
      <header className="flex items-center gap-3 border-b border-[var(--color-border)] px-3 py-2">
        <span className="font-mono text-[13px] font-semibold tracking-tight text-[var(--color-accent)]">
          quay
        </span>
        <input
          value={repoInput}
          onChange={(e) => setRepoInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && openRepo()}
          placeholder="/path/to/repo"
          spellCheck={false}
          className="w-96 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-panel)] px-2 py-1 font-mono text-[12px] outline-none focus:border-[var(--color-accent-dim)]"
        />
        <button
          type="button"
          onClick={openRepo}
          className="rounded-[var(--radius)] border border-[var(--color-border-strong)] bg-[var(--color-panel-2)] px-2.5 py-1 text-[12px] hover:border-[var(--color-accent-dim)]"
        >
          Open
        </button>
        <label className="flex items-center gap-1.5 text-[12px] text-[var(--color-fg-subtle)]">
          base
          <input
            value={base}
            onChange={(e) => {
              setBase(e.target.value);
              localStorage.setItem(LS_BASE, e.target.value);
            }}
            spellCheck={false}
            className="w-24 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-panel)] px-2 py-1 font-mono text-[12px] outline-none focus:border-[var(--color-accent-dim)]"
          />
        </label>

        <div className="ml-auto flex overflow-hidden rounded-[var(--radius)] border border-[var(--color-border-strong)]">
          {(["terminal", "diff"] as View[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`px-3 py-1 text-[12px] capitalize ${
                view === v
                  ? "bg-[var(--color-panel-2)] text-[var(--color-fg)]"
                  : "text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </header>

      {error && (
        <div className="border-b border-[var(--color-del)] bg-[var(--color-del-bg)] px-3 py-1.5 font-mono text-[12px] text-[var(--color-del)]">
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <aside className="w-64 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-panel)]">
          <AgentDeck
            worktrees={worktrees}
            selectedPath={selectedPath}
            busy={busy}
            onSelect={(p) => setSelectedPath(p)}
            onNewAgent={() => setShowNew(true)}
            onRefresh={() => void refreshWorktrees()}
          />
        </aside>

        {/* Main */}
        <main className="relative min-w-0 flex-1">
          {!repoPath ? (
            <Empty>Set a repository path above to begin.</Empty>
          ) : !selectedPath ? (
            <Empty>Select or create an agent in the deck.</Empty>
          ) : (
            <div className="flex h-full flex-col">
              {view === "terminal" && (
                <div className="flex items-center gap-1 border-b border-[var(--color-border)] px-2 py-1.5">
                  {(["shell", "claude"] as Program[]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setProgram(p)}
                      className={`rounded-[var(--radius)] px-2 py-0.5 text-[11px] capitalize ${
                        program === p
                          ? "bg-[var(--color-panel-2)] text-[var(--color-fg)]"
                          : "text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                  <span className="ml-2 truncate font-mono text-[11px] text-[var(--color-fg-subtle)]">
                    {selectedPath}
                  </span>
                </div>
              )}

              {/* Stage: terminals stay mounted; the diff view overlays them. */}
              <div className="relative min-h-0 flex-1">
                {sessions.map((s) => {
                  const key = sessionKey(s.path, s.program);
                  const active = isSessionActive(s, view, selectedPath, program);
                  return (
                    <div
                      key={key}
                      className="absolute inset-0"
                      style={{ display: active ? "block" : "none" }}
                    >
                      <TerminalView
                        cwd={s.path}
                        command={commandFor(s.program)}
                        args={NO_ARGS}
                        sessionKey={key}
                        interactive={active && !showNew}
                      />
                    </div>
                  );
                })}

                {view === "diff" && (
                  <div className="absolute inset-0 bg-[var(--color-bg)]">
                    {diffLoading ? (
                      <Empty>Computing diff against {base}…</Empty>
                    ) : diff && narration ? (
                      <NarratedDiff diff={diff} narration={narration} />
                    ) : (
                      <Empty>No diff to show.</Empty>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* New agent overlay */}
      {showNew && (
        <div
          className="absolute inset-0 z-10 flex items-start justify-center bg-black/50 pt-32"
          onClick={() => setShowNew(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-96 rounded-[var(--radius)] border border-[var(--color-border-strong)] bg-[var(--color-panel)] p-4"
          >
            <h2 className="mb-3 text-[13px] font-semibold">New agent</h2>
            <p className="mb-2 text-[12px] text-[var(--color-fg-muted)]">
              Creates a worktree on a new branch off <code>{base}</code>.
            </p>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitNewAgent();
                if (e.key === "Escape") setShowNew(false);
              }}
              placeholder="what is this agent working on?"
              className="mb-3 w-full rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-panel-2)] px-2 py-1.5 text-[13px] outline-none focus:border-[var(--color-accent-dim)]"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowNew(false)}
                className="rounded-[var(--radius)] px-3 py-1 text-[12px] text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitNewAgent()}
                disabled={busy || !newName.trim()}
                className="rounded-[var(--radius)] border border-[var(--color-accent-dim)] bg-[var(--color-panel-2)] px-3 py-1 text-[12px] text-[var(--color-accent)] disabled:opacity-50"
              >
                {busy ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center text-[13px] text-[var(--color-fg-subtle)]">
      {children}
    </div>
  );
}

export default App;
