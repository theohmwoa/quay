import { describe, it, expect } from "vitest";
import {
  changedCount,
  statusSummary,
  canCommit,
  canLand,
  landBlockedReason,
} from "./status";
import type { WorktreeStatus } from "./api";

const make = (o: Partial<WorktreeStatus>): WorktreeStatus => ({
  branch: "feature",
  staged: [],
  unstaged: [],
  untracked: [],
  ahead: 0,
  behind: 0,
  clean: true,
  ...o,
});

describe("changedCount", () => {
  it("sums staged, unstaged and untracked", () => {
    expect(changedCount(make({ staged: ["a"], unstaged: ["b"], untracked: ["c", "d"] }))).toBe(4);
  });
});

describe("statusSummary", () => {
  it("says clean with no changes", () => {
    expect(statusSummary(make({}))).toBe("clean");
  });
  it("counts changes and shows ahead/behind arrows", () => {
    const st = make({ unstaged: ["x"], ahead: 2, behind: 1, clean: false });
    expect(statusSummary(st)).toBe("1 changed · ↑2 ↓1");
  });
  it("shows only ahead when not behind", () => {
    expect(statusSummary(make({ ahead: 3 }))).toBe("clean · ↑3");
  });
});

describe("canCommit / canLand", () => {
  it("can commit only when there are changes", () => {
    expect(canCommit(make({}))).toBe(false);
    expect(canCommit(make({ untracked: ["x"], clean: false }))).toBe(true);
  });

  it("can land only when ahead and clean", () => {
    expect(canLand(make({ ahead: 2, clean: true }))).toBe(true);
    expect(canLand(make({ ahead: 0, clean: true }))).toBe(false);
    expect(canLand(make({ ahead: 2, clean: false }))).toBe(false);
  });

  it("explains why landing is blocked", () => {
    expect(landBlockedReason(make({ ahead: 2, clean: true }))).toBe("");
    expect(landBlockedReason(make({ clean: false, unstaged: ["x"] }))).toContain("Commit");
    expect(landBlockedReason(make({ ahead: 0 }))).toContain("Nothing to land");
  });
});
