import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
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
  cwd: string;
  command: string;
  args: string[];
  /** Stable key; one PTY exists per session for its whole lifetime. */
  sessionKey: string;
  /** Accept input and hold focus only when active and unobstructed. */
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
 * A live terminal bound to a PTY. The PTY is spawned once per `sessionKey` and
 * kept alive across view/program/worktree switches (the parent hides rather
 * than unmounts it). Includes an in-terminal scrollback search (Cmd/Ctrl+F).
 */
export function TerminalView({ cwd, command, args, sessionKey, interactive }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");

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
      scrollback: 10000,
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    termRef.current = term;
    fitRef.current = fit;
    searchRef.current = search;

    // Intercept Cmd/Ctrl+F to open our search bar instead of the browser's.
    term.attachCustomKeyEventHandler((e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        if (e.type === "keydown") setSearchOpen(true);
        return false;
      }
      return true;
    });

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
        const id = await ptySpawn(cwd, command, args, term.cols || 80, term.rows || 24);
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
      searchRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.disableStdin = !interactive;
    if (interactive) {
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

  const runSearch = (forward: boolean) => {
    if (!query) return;
    if (forward) searchRef.current?.findNext(query);
    else searchRef.current?.findPrevious(query);
  };

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full px-2 py-1" />
      {searchOpen && (
        <div className="absolute right-3 top-2 flex items-center gap-1 rounded-[var(--radius)] border border-[var(--color-border-strong)] bg-[var(--color-panel)] px-1.5 py-1">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") runSearch(!e.shiftKey);
              if (e.key === "Escape") setSearchOpen(false);
            }}
            placeholder="find…"
            className="w-40 bg-transparent px-1 text-[12px] outline-none"
          />
          <button
            type="button"
            onClick={() => runSearch(false)}
            className="px-1 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
            title="Previous (Shift+Enter)"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => runSearch(true)}
            className="px-1 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
            title="Next (Enter)"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={() => setSearchOpen(false)}
            className="px-1 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
