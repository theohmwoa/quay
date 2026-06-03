import { useState } from "react";
import { TerminalView } from "./TerminalView";
import { basename } from "../lib/format";
import { commandFor, programArgs, sessionKey, type Program, type Session } from "../lib/sessions";

interface Props {
  sessions: Session[];
  activeKey: string | null;
  onActivate: (key: string) => void;
  onClose: (key: string) => void;
  onNew: (program: Program) => void;
  /** True when a worktree is selected, so new sessions can be opened. */
  canOpen: boolean;
  /** Terminal view is the visible top-level view. */
  visible: boolean;
  /** A modal is open — terminals must not capture input. */
  modalOpen: boolean;
}

type Slot = "a" | "b" | "hidden";

const label = (s: Session) => `${basename(s.path)} · ${s.program}`;

/**
 * Multi-terminal workspace: tabs across open sessions, an optional 2-pane
 * split, and persistent mounting (every session's PTY stays alive; we only
 * change which are visible/interactive).
 */
export function TerminalDeck({
  sessions,
  activeKey,
  onActivate,
  onClose,
  onNew,
  canOpen,
  visible,
  modalOpen,
}: Props) {
  const [split, setSplit] = useState(false);
  const [focusedPane, setFocusedPane] = useState<"a" | "b">("a");

  // In split mode, the second pane shows the first session that isn't active.
  const secondSession =
    split && sessions.length > 1
      ? sessions.find((s) => sessionKey(s.path, s.program) !== activeKey)
      : undefined;
  const effectiveSecondary = secondSession
    ? sessionKey(secondSession.path, secondSession.program)
    : null;

  const slotFor = (key: string): Slot => {
    if (key === activeKey) return "a";
    if (split && key === effectiveSecondary) return "b";
    return "hidden";
  };

  const styleFor = (slot: Slot): React.CSSProperties => {
    if (slot === "hidden") return { display: "none" };
    if (!split || !effectiveSecondary) return { inset: 0 };
    return slot === "a"
      ? { top: 0, bottom: 0, left: 0, width: "50%" }
      : { top: 0, bottom: 0, left: "50%", right: 0 };
  };

  const interactiveFor = (slot: Slot): boolean => {
    if (slot === "hidden" || !visible || modalOpen) return false;
    if (!split || !effectiveSecondary) return true; // single pane = active
    return slot === "a" ? focusedPane === "a" : focusedPane === "b";
  };

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-[var(--color-border)] px-2 py-1.5">
        {sessions.map((s) => {
          const key = sessionKey(s.path, s.program);
          const active = key === activeKey;
          return (
            <div
              key={key}
              className={`flex shrink-0 items-center gap-1 rounded-[var(--radius)] border px-2 py-0.5 text-[11px] ${
                active
                  ? "border-[var(--color-accent-dim)] bg-[var(--color-panel-2)] text-[var(--color-fg)]"
                  : "border-[var(--color-border)] text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
              }`}
            >
              <button type="button" onClick={() => onActivate(key)} className="font-mono">
                {label(s)}
              </button>
              <button
                type="button"
                onClick={() => onClose(key)}
                title="Close terminal"
                className="text-[var(--color-fg-subtle)] hover:text-[var(--color-del)]"
              >
                ✕
              </button>
            </div>
          );
        })}

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            disabled={!canOpen}
            onClick={() => onNew("shell")}
            className="rounded-[var(--radius)] px-1.5 py-0.5 text-[11px] text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] disabled:opacity-40"
          >
            + shell
          </button>
          <button
            type="button"
            disabled={!canOpen}
            onClick={() => onNew("claude")}
            className="rounded-[var(--radius)] px-1.5 py-0.5 text-[11px] text-[var(--color-accent)] hover:opacity-80 disabled:opacity-40"
          >
            + claude
          </button>
          <button
            type="button"
            disabled={sessions.length < 2}
            onClick={() => setSplit((v) => !v)}
            title="Split view"
            className={`rounded-[var(--radius)] border px-1.5 py-0.5 text-[11px] disabled:opacity-40 ${
              split
                ? "border-[var(--color-accent-dim)] text-[var(--color-accent)]"
                : "border-[var(--color-border)] text-[var(--color-fg-subtle)]"
            }`}
          >
            ⊟ split
          </button>
        </div>
      </div>

      {/* Panes — every session stays mounted; slots control visibility. */}
      <div className="relative min-h-0 flex-1">
        {sessions.length === 0 && (
          <div className="flex h-full items-center justify-center text-[13px] text-[var(--color-fg-subtle)]">
            {canOpen ? "Open a terminal with + shell or + claude." : "Select an agent first."}
          </div>
        )}
        {sessions.map((s) => {
          const key = sessionKey(s.path, s.program);
          const slot = slotFor(key);
          return (
            <div
              key={key}
              className={`absolute ${
                split && effectiveSecondary && slot === "b"
                  ? "border-l border-[var(--color-border)]"
                  : ""
              }`}
              style={styleFor(slot)}
              onMouseDown={() => slot !== "hidden" && setFocusedPane(slot === "b" ? "b" : "a")}
            >
              <TerminalView
                cwd={s.path}
                command={commandFor(s.program)}
                args={programArgs(s)}
                sessionKey={key}
                visible={slot !== "hidden"}
                interactive={interactiveFor(slot)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
