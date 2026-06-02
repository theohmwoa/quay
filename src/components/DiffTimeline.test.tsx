import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DiffTimeline } from "./DiffTimeline";
import type { TimelineEntry } from "../lib/api";

const entries: TimelineEntry[] = [
  {
    sha: "aaa1111",
    subject: "add login",
    author: "Agent",
    diff: {
      base: "∅",
      head: "aaa1111",
      total_additions: 3,
      total_deletions: 0,
      files: [
        { path: "src/login.rs", old_path: null, status: "added", additions: 3, deletions: 0, binary: false, hunks: [] },
      ],
    },
  },
];

describe("DiffTimeline", () => {
  it("renders an empty state when there are no commits", () => {
    render(<DiffTimeline entries={[]} />);
    expect(screen.getByText(/No commits on this branch/i)).toBeInTheDocument();
  });

  it("lists commits and reveals files on expand", () => {
    render(<DiffTimeline entries={entries} />);
    expect(screen.getByText("1 commit")).toBeInTheDocument();
    expect(screen.getByText("add login")).toBeInTheDocument();
    // file hidden until the commit row is expanded
    expect(screen.queryByText("login.rs")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("add login"));
    expect(screen.getByText("login.rs")).toBeInTheDocument();
  });
});
