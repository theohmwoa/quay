import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

// Track how many times the terminal deck mounts/unmounts. The bug we guard
// against: leaving the terminal view unmounted the deck (killing every PTY,
// resetting Claude). The deck must stay mounted across view switches.
const deck = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }));

vi.mock("./components/TerminalDeck", async () => {
  const { useEffect, createElement } = await import("react");
  return {
    TerminalDeck: () => {
      useEffect(() => {
        deck.mounts++;
        return () => {
          deck.unmounts++;
        };
      }, []);
      return createElement("div", { "data-testid": "deck" });
    },
  };
});

// Stub the Tauri-backed API so App can mount in jsdom without a backend.
vi.mock("./lib/api", () => ({
  loadState: vi.fn().mockResolvedValue({ repo_path: "/repo", base: "main", sessions: [] }),
  saveState: vi.fn().mockResolvedValue(undefined),
  listWorktrees: vi.fn().mockResolvedValue([]),
  worktreeStatus: vi.fn().mockResolvedValue({
    branch: "main",
    staged: [],
    unstaged: [],
    untracked: [],
    ahead: 0,
    behind: 0,
    clean: true,
  }),
  diffBranchVsBase: vi.fn(),
  narrateDiff: vi.fn(),
  commitTimeline: vi.fn().mockResolvedValue([]),
  askDiff: vi.fn(),
  createWorktree: vi.fn(),
  removeWorktree: vi.fn(),
  landWorktree: vi.fn(),
  suggestCommitMessage: vi.fn(),
  commitWorktree: vi.fn(),
  pushBranch: vi.fn(),
  openPr: vi.fn(),
}));

import App from "./App";

describe("App — terminal persistence across view switches", () => {
  beforeEach(() => {
    deck.mounts = 0;
    deck.unmounts = 0;
    cleanup();
  });

  it("never unmounts the terminal deck when switching to diff and back", async () => {
    render(<App />);
    // Deck mounts once the persisted repo path is restored.
    await screen.findByTestId("deck");
    expect(deck.mounts).toBe(1);

    fireEvent.click(screen.getByText("diff"));
    // Still in the DOM (hidden), not unmounted.
    expect(screen.getByTestId("deck")).toBeInTheDocument();

    fireEvent.click(screen.getByText("timeline"));
    fireEvent.click(screen.getByText("terminal"));

    // The whole point: one mount, zero unmounts — PTYs (and Claude) survive.
    expect(deck.mounts).toBe(1);
    expect(deck.unmounts).toBe(0);
  });
});
