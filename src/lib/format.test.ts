import { describe, it, expect } from "vitest";
import {
  statusBadge,
  statusLabel,
  statusColor,
  formatStat,
  basename,
  dirname,
  statBar,
  worktreeLabel,
} from "./format";

describe("status helpers", () => {
  it("maps statuses to single-letter badges", () => {
    expect(statusBadge("added")).toBe("A");
    expect(statusBadge("modified")).toBe("M");
    expect(statusBadge("deleted")).toBe("D");
    expect(statusBadge("renamed")).toBe("R");
    expect(statusBadge("other")).toBe("•");
  });

  it("labels are capitalized", () => {
    expect(statusLabel("added")).toBe("Added");
    expect(statusLabel("modified")).toBe("Modified");
  });

  it("colors added green and deleted red", () => {
    expect(statusColor("added")).toContain("add");
    expect(statusColor("deleted")).toContain("del");
    expect(statusColor("modified")).toContain("muted");
  });
});

describe("path helpers", () => {
  it("basename returns the final segment", () => {
    expect(basename("src/auth/login.rs")).toBe("login.rs");
    expect(basename("README.md")).toBe("README.md");
  });

  it("dirname returns the directory or empty", () => {
    expect(dirname("src/auth/login.rs")).toBe("src/auth");
    expect(dirname("README.md")).toBe("");
  });
});

describe("formatStat", () => {
  it("renders additions and deletions", () => {
    expect(formatStat(12, 3)).toBe("+12 −3");
    expect(formatStat(0, 0)).toBe("+0 −0");
  });
});

describe("statBar", () => {
  it("is exactly `width` glyphs wide", () => {
    expect(statBar(10, 0, 5)).toHaveLength(5);
    expect(statBar(0, 0, 5)).toHaveLength(5);
    expect(statBar(3, 7, 8)).toHaveLength(8);
  });

  it("shows dots for an empty change", () => {
    expect(statBar(0, 0, 4)).toBe("····");
  });

  it("leans green when additions dominate", () => {
    const bar = statBar(100, 0, 5);
    expect(bar).toBe("■■■■■");
  });

  it("shows at least one green block when there is any addition", () => {
    const bar = statBar(1, 999, 5);
    expect(bar.startsWith("■")).toBe(true);
  });
});

describe("worktreeLabel", () => {
  it("prefers branch, then head, then path tail", () => {
    expect(worktreeLabel("feature-x", "abcdef12", "/repo/wt")).toBe("feature-x");
    expect(worktreeLabel(null, "abcdef1234", "/repo/wt")).toBe("abcdef12");
    expect(worktreeLabel(null, null, "/repo/wt-foo")).toBe("wt-foo");
  });
});
