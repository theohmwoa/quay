import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  commitTimeline,
  commitWorktree,
  createWorktree,
  diffBranchVsBase,
  landWorktree,
  listWorktrees,
  loadState,
  narrateDiff,
  openPr,
  pushBranch,
  removeWorktree,
  saveState,
  suggestCommitMessage,
  worktreeStatus,
  askDiff,
  type DiffSummary,
  type Narration,
  type TimelineEntry,
  type WorktreeStatus,
  type Worktree,
} from "./lib/api";
import { AgentDeck } from "./components/AgentDeck";
import { NarratedDiff } from "./components/NarratedDiff";
import { TerminalDeck } from "./components/TerminalDeck";
import { LandPanel } from "./components/LandPanel";
import { DiffTimeline } from "./components/DiffTimeline";
import { AskPanel } from "./components/AskPanel";
import { sessionKey, upsertSession, type Program, type Session, type View } from "./lib/sessions";

const VIEWS: View[] = ["terminal", "diff", "timeline", "ask"];

function App() {
  const [repoPath, setRepoPath] = useState("");
  const [repoInput, setRepoInput] = useState("");
  const [base, setBase] = useState("main");

  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  const [statuses, setStatuses] = useState<Record<string, WorktreeStatus>>({});
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [view, setView] = useState<View>("terminal");

  const [diff, setDiff] = useState<DiffSummary | null>(null);
  const [narration, setNarration] = useState<Narration | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const [commitMessage, setCommitMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const loadedRef = useRef(false);

  const selectedWorktree = worktrees.find((w) => w.path === selectedPath) ?? null;
  const selectedStatus = selectedPath ? statuses[selectedPath] ?? null : null;

  // --- persistence: restore on launch, save on change ----------------------
  useEffect(() => {
    loadState()
      .then((st) => {
        if (st.repo_path) {
          setRepoPath(st.repo_path);
          setRepoInput(st.repo_path);
        }
        if (st.base) setBase(st.base);
        const restored = st.sessions.map((s) => ({
          path: s.path,
          program: s.program as Program,
          claudeSessionId: s.claude_session_id,
          // Restored claude sessions resume their conversation on relaunch.
          resume: s.program === "claude" && !!s.claude_session_id,
        }));
        setSessions(restored);
        if (restored[0]) setActiveKey(sessionKey(restored[0].path, restored[0].program));
      })
      .catch(() => {})
      .finally(() => {
        loadedRef.current = true;
      });
  }, []);

  useEffect(() => {
    if (!loadedRef.current) return;
    void saveState({
      repo_path: repoPath,
      base,
      sessions: sessions.map((s) => ({
        path: s.path,
        program: s.program,
        claude_session_id: s.claudeSessionId,
      })),
    });
  }, [repoPath, base, sessions]);

  // --- worktrees + statuses ------------------------------------------------
  const refreshWorktrees = useCallback(async () => {
    if (!repoPath) return;
    try {
      const wts = await listWorktrees(repoPath);
      setWorktrees(wts);
      setError(null);
      setSelectedPath((cur) => cur ?? wts.find((w) => !w.is_main)?.path ?? wts[0]?.path ?? null);
      // Fetch status for each worktree (small N) for the deck badges.
      const entries = await Promise.all(
        wts.map(async (w) => {
          try {
            return [w.path, await worktreeStatus(w.path, base)] as const;
          } catch {
            return null;
          }
        }),
      );
      setStatuses(Object.fromEntries(entries.filter(Boolean) as [string, WorktreeStatus][]));
    } catch (e) {
      setError(String(e));
      setWorktrees([]);
    }
  }, [repoPath, base]);

  useEffect(() => {
    void refreshWorktrees();
  }, [refreshWorktrees]);

  // --- lazy data per view --------------------------------------------------
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

  useEffect(() => {
    if (view !== "timeline" || !selectedPath) return;
    let cancelled = false;
    commitTimeline(selectedPath, base)
      .then((t) => !cancelled && setTimeline(t))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [view, selectedPath, base]);

  // Reset reviewer notes when the selected worktree changes.
  useEffect(() => setNotes({}), [selectedPath]);

  // --- session / selection plumbing ----------------------------------------
  const openSession = (path: string, program: Program) => {
    // A new claude terminal gets a fresh Claude session id so it can be
    // resumed later; shells need nothing extra.
    const extra =
      program === "claude"
        ? { claudeSessionId: crypto.randomUUID(), resume: false }
        : undefined;
    setSessions((prev) => upsertSession(prev, path, program, extra));
    setActiveKey(sessionKey(path, program));
    setView("terminal");
  };

  const selectWorktree = (path: string) => {
    setSelectedPath(path);
    const existing = sessions.find((s) => s.path === path);
    if (existing) setActiveKey(sessionKey(existing.path, existing.program));
    else if (view === "terminal") openSession(path, "shell");
  };

  const activateSession = (key: string) => {
    setActiveKey(key);
    const s = sessions.find((x) => sessionKey(x.path, x.program) === key);
    if (s) setSelectedPath(s.path);
  };

  const closeSession = (key: string) => {
    setSessions((prev) => prev.filter((s) => sessionKey(s.path, s.program) !== key));
    setActiveKey((cur) => {
      if (cur !== key) return cur;
      const remaining = sessions.filter((s) => sessionKey(s.path, s.program) !== key);
      return remaining[0] ? sessionKey(remaining[0].path, remaining[0].program) : null;
    });
  };

  // --- lifecycle actions ---------------------------------------------------
  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    try {
      const msg = await fn();
      setNotice(msg);
      await refreshWorktrees();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const branch = selectedWorktree?.branch ?? "";

  const onSuggest = () =>
    run(async () => {
      if (!selectedPath) return null;
      setCommitMessage(await suggestCommitMessage(selectedPath, base));
      return "Suggested a commit message.";
    });

  const onCommit = () =>
    run(async () => {
      if (!selectedPath) return null;
      const sha = await commitWorktree(selectedPath, commitMessage);
      setCommitMessage("");
      return `Committed ${sha}.`;
    });

  const onPush = () =>
    run(async () => {
      if (!selectedPath || !branch) return null;
      await pushBranch(selectedPath, "origin", branch);
      return `Pushed ${branch} to origin.`;
    });

  const onOpenPr = () =>
    run(async () => {
      if (!selectedPath || !branch) return null;
      const title = commitMessage.split("\n")[0].trim() || branch;
      const url = await openPr(selectedPath, title, commitMessage, base, branch);
      return `PR: ${url}`;
    });

  const onLand = () =>
    run(async () => {
      if (!selectedPath || !branch) return null;
      const result = await landWorktree(repoPath, selectedPath, branch, base);
      if (result.kind === "conflicts") {
        return `Conflicts in: ${result.files.join(", ")}`;
      }
      // Worktree was removed; clean up its sessions and selection.
      sessions
        .filter((s) => s.path === selectedPath)
        .forEach((s) => closeSession(sessionKey(s.path, s.program)));
      setSelectedPath(null);
      return result.kind === "merged" ? `Landed ${branch} → ${base} (${result.sha}).` : "Already up to date.";
    });

  const onDiscard = () =>
    run(async () => {
      if (!selectedPath) return null;
      const path = selectedPath;
      await removeWorktree(repoPath, path, true);
      sessions
        .filter((s) => s.path === path)
        .forEach((s) => closeSession(sessionKey(s.path, s.program)));
      setSelectedPath(null);
      return "Worktree discarded.";
    });

  // --- new agent -----------------------------------------------------------
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
      openSession(wt.path, "claude");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const openRepo = () => {
    const p = repoInput.trim();
    setRepoPath(p);
    setSelectedPath(null);
  };

  return (
    <div className="relative flex h-full flex-col bg-[var(--color-bg)] text-[var(--color-fg)]">
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
            onChange={(e) => setBase(e.target.value)}
            spellCheck={false}
            className="w-24 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-panel)] px-2 py-1 font-mono text-[12px] outline-none focus:border-[var(--color-accent-dim)]"
          />
        </label>

        <div className="ml-auto flex overflow-hidden rounded-[var(--radius)] border border-[var(--color-border-strong)]">
          {VIEWS.map((v) => (
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
        <aside className="w-64 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-panel)]">
          <AgentDeck
            worktrees={worktrees}
            selectedPath={selectedPath}
            statuses={statuses}
            busy={busy}
            onSelect={selectWorktree}
            onNewAgent={() => setShowNew(true)}
            onRefresh={() => void refreshWorktrees()}
          />
        </aside>

        <main className="relative min-w-0 flex-1">
          {!repoPath ? (
            <Empty>Set a repository path above to begin.</Empty>
          ) : (
            <>
              {/* TerminalDeck is ALWAYS mounted (hidden when not the active
                  view) so PTYs — and running Claude agents — survive switching
                  to the diff/timeline/ask views and back. */}
              <div
                className="absolute inset-0"
                style={{ display: view === "terminal" ? "block" : "none" }}
              >
                <TerminalDeck
                  sessions={sessions}
                  activeKey={activeKey}
                  onActivate={activateSession}
                  onClose={closeSession}
                  onNew={(p) => selectedPath && openSession(selectedPath, p)}
                  canOpen={!!selectedPath}
                  visible={view === "terminal"}
                  modalOpen={showNew}
                />
              </div>

              {view !== "terminal" && (
                <div className="absolute inset-0">
                  {!selectedPath ? (
                    <Empty>Select an agent in the deck.</Empty>
                  ) : view === "diff" ? (
                    <div className="flex h-full flex-col">
                      <LandPanel
                        status={selectedStatus}
                        busy={busy}
                        message={commitMessage}
                        onMessageChange={setCommitMessage}
                        onSuggest={onSuggest}
                        onCommit={onCommit}
                        onPush={onPush}
                        onOpenPr={onOpenPr}
                        onLand={onLand}
                        onDiscard={onDiscard}
                        notice={notice}
                      />
                      <div className="min-h-0 flex-1">
                        {diffLoading ? (
                          <Empty>Computing diff against {base}…</Empty>
                        ) : diff && narration ? (
                          <NarratedDiff
                            diff={diff}
                            narration={narration}
                            notes={notes}
                            onNote={(path, note) => setNotes((n) => ({ ...n, [path]: note }))}
                          />
                        ) : (
                          <Empty>No diff to show.</Empty>
                        )}
                      </div>
                    </div>
                  ) : view === "timeline" ? (
                    <DiffTimeline entries={timeline} />
                  ) : (
                    <AskPanel ask={(q) => askDiff(selectedPath, base, q)} />
                  )}
                </div>
              )}
            </>
          )}
        </main>
      </div>

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
              Creates a worktree on a new branch off <code>{base}</code>, and opens Claude in it.
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
