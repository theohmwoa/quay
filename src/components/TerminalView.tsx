import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  onPtyExit,
  onPtyOutput,
  ptyKill,
  ptyResize,
  ptySpawn,
  ptyWrite,
} from "../lib/api";

interface Props {
  /** Working directory for the spawned process (a worktree path). */
  cwd: string;
  /** Program to run, e.g. "claude" or the shell. */
  command: string;
  args: string[];
  /** Stable key; one PTY exists per session for its whole lifetime. */
  sessionKey: string;
  /**
   * Whether this terminal should accept keyboard input and hold focus. Only
   * the visible, unobstructed terminal is interactive — hidden ones and any
   * terminal behind a modal are not, so keystrokes never leak.
   */
  interactive: boolean;
}

const THEME = {
  background: "#0b0b0d",
  foreground: "#e7e7ea",
  cursor: "#c8a978",
  selectionBackground: "#34343a",
  black: "#0b0b0d",
  brightBlack: "#6b6b73",
};

/**
 * A live terminal bound to a PTY running `command` in `cwd`. The PTY is
 * spawned once (keyed by `sessionKey`) and survives view/program switches —
 * the parent keeps this component mounted and merely hides it — so a running
 * Claude session is never lost. The PTY is only killed when this component is
 * truly unmounted (the session is closed or the app exits).
 */
export function TerminalView({ cwd, command, args, sessionKey, interactive }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  // Spawn + wiring. Keyed on sessionKey only: cwd/command/args are constant
  // for a given session, so this runs exactly once per terminal.
  useEffect(() => {
    let disposed = false;
    let ptyId: string | null = null;
    const unlisteners: UnlistenFn[] = [];

    const term = new Terminal({
      fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
      fontSize: 12,
      theme: THEME,
      cursorBlink: true,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    termRef.current = term;
    fitRef.current = fit;

    const el = containerRef.current;
    if (el) {
      term.open(el);
      try {
        fit.fit();
      } catch {
        /* not measurable yet */
      }
    }

    (async () => {
      try {
        const cols = term.cols || 80;
        const rows = term.rows || 24;
        const id = await ptySpawn(cwd, command, args, cols, rows);
        if (disposed) {
          void ptyKill(id);
          return;
        }
        ptyId = id;
        unlisteners.push(await onPtyOutput(id, (chunk) => term.write(chunk)));
        unlisteners.push(
          await onPtyExit(id, () => {
            term.write("\r\n\x1b[2m[process exited]\x1b[0m\r\n");
          }),
        );
        term.onData((data) => {
          void ptyWrite(id, data);
        });
      } catch (err) {
        term.write(`\r\n\x1b[31mfailed to start: ${String(err)}\x1b[0m\r\n`);
      }
    })();

    const onResize = () => {
      try {
        fit.fit();
        if (ptyId) void ptyResize(ptyId, term.cols, term.rows);
      } catch {
        /* container not measurable (e.g. hidden) */
      }
    };
    const ro = new ResizeObserver(onResize);
    if (el) ro.observe(el);

    return () => {
      disposed = true;
      ro.disconnect();
      unlisteners.forEach((u) => u());
      if (ptyId) void ptyKill(ptyId);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey]);

  // Toggle interactivity: disable stdin and blur when this terminal is hidden
  // or sitting behind a modal; re-enable, refit and focus when it's active.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.disableStdin = !interactive;
    if (interactive) {
      // Becoming visible/active: re-measure (it may have been hidden) and focus.
      requestAnimationFrame(() => {
        try {
          fitRef.current?.fit();
        } catch {
          /* not measurable */
        }
        term.focus();
      });
    } else {
      term.blur();
    }
  }, [interactive]);

  return <div ref={containerRef} className="h-full w-full px-2 py-1" />;
}
