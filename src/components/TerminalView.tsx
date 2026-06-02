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
  /** Stable key so a new terminal is created per agent/worktree. */
  sessionKey: string;
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
 * A live terminal bound to a PTY running `command` in `cwd`. Self-contained:
 * spawns on mount, wires xterm <-> the Rust PTY, and tears everything down on
 * unmount or when `sessionKey` changes.
 */
export function TerminalView({ cwd, command, args, sessionKey }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);

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

    const el = containerRef.current;
    if (el) {
      term.open(el);
      fit.fit();
    }

    (async () => {
      try {
        const cols = term.cols || 80;
        const rows = term.rows || 24;
        const id = await ptySpawn(cwd, command, args, cols, rows);
        if (disposed) {
          // Unmounted before spawn resolved — clean up the orphan.
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
        /* container not measurable yet */
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
    };
  }, [cwd, command, args, sessionKey]);

  return <div ref={containerRef} className="h-full w-full px-2 py-1" />;
}
