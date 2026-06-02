import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NarratedDiff } from "./NarratedDiff";
import type { DiffSummary, Narration } from "../lib/api";

const diff: DiffSummary = {
  base: "main",
  head: "abc1234",
  total_additions: 21,
  total_deletions: 5,
  files: [
    {
      path: "src/auth.rs",
      old_path: null,
      status: "modified",
      additions: 20,
      deletions: 5,
      binary: false,
      hunks: [
        {
          header: "@@ -1,3 +1,4 @@",
          lines: [
            { origin: "+", content: "let token = mint();", old_lineno: null, new_lineno: 2 },
            { origin: " ", content: "return token;", old_lineno: 2, new_lineno: 3 },
          ],
        },
      ],
    },
    {
      path: "README.md",
      old_path: null,
      status: "added",
      additions: 1,
      deletions: 0,
      binary: false,
      hunks: [],
    },
  ],
};

const narration: Narration = {
  summary: "Adds token minting to the auth flow.",
  clusters: [
    { title: "auth", description: "token work", files: ["src/auth.rs"] },
  ],
  file_notes: [{ path: "src/auth.rs", note: "now mints a token before returning" }],
  risks: ["touches the auth path"],
  engine: "haiku",
};

describe("NarratedDiff", () => {
  it("renders the summary, engine badge, risks and clusters", () => {
    render(<NarratedDiff diff={diff} narration={narration} />);
    expect(screen.getByText("Adds token minting to the auth flow.")).toBeInTheDocument();
    expect(screen.getByText("haiku")).toBeInTheDocument();
    expect(screen.getByText("touches the auth path")).toBeInTheDocument();
    expect(screen.getByText("token work")).toBeInTheDocument();
  });

  it("shows the per-file note and file count", () => {
    render(<NarratedDiff diff={diff} narration={narration} />);
    expect(screen.getByText("now mints a token before returning")).toBeInTheDocument();
    expect(screen.getByText("2 files")).toBeInTheDocument();
  });

  it("reveals raw hunk lines when a file row is expanded", () => {
    render(<NarratedDiff diff={diff} narration={narration} />);
    // Hidden until expanded.
    expect(screen.queryByText("@@ -1,3 +1,4 @@")).not.toBeInTheDocument();
    // "auth.rs" appears both as a cluster chip and the file row; the file row
    // (last occurrence) is the expandable one.
    const occurrences = screen.getAllByText("auth.rs");
    fireEvent.click(occurrences[occurrences.length - 1]);
    expect(screen.getByText("@@ -1,3 +1,4 @@")).toBeInTheDocument();
    expect(screen.getByText("let token = mint();")).toBeInTheDocument();
  });
});
