import { describe, it, expect } from "vitest";
import {
  sessionKey,
  commandFor,
  programArgs,
  upsertSession,
  isSessionActive,
  type Session,
} from "./sessions";

describe("programArgs", () => {
  it("shell sessions take no args", () => {
    expect(programArgs({ path: "/r/wt", program: "shell" })).toEqual([]);
  });

  it("a fresh claude session creates a specific session id and name", () => {
    const args = programArgs({ path: "/r/feat-x", program: "claude", claudeSessionId: "abc-123" });
    expect(args).toEqual(["--session-id", "abc-123", "--name", "feat-x"]);
  });

  it("a restored claude session resumes that id", () => {
    const args = programArgs({
      path: "/r/feat-x",
      program: "claude",
      claudeSessionId: "abc-123",
      resume: true,
    });
    expect(args).toEqual(["--resume", "abc-123"]);
  });

  it("claude without a bound id falls back to no args", () => {
    expect(programArgs({ path: "/r/wt", program: "claude" })).toEqual([]);
  });
});

describe("sessionKey / commandFor", () => {
  it("keys are stable and distinguish program per path", () => {
    expect(sessionKey("/repo/wt", "shell")).toBe("/repo/wt shell");
    expect(sessionKey("/repo/wt", "claude")).not.toBe(sessionKey("/repo/wt", "shell"));
  });

  it("maps programs to commands", () => {
    expect(commandFor("claude")).toBe("claude");
    expect(commandFor("shell")).toBe("zsh");
  });
});

describe("upsertSession — persistence rule", () => {
  it("adds a new session", () => {
    const next = upsertSession([], "/a", "shell");
    expect(next).toEqual([{ path: "/a", program: "shell" }]);
  });

  it("returns the SAME array reference when the session already exists", () => {
    const sessions: Session[] = [{ path: "/a", program: "shell" }];
    expect(upsertSession(sessions, "/a", "shell")).toBe(sessions);
  });

  it("keeps existing sessions when adding another (nothing is dropped)", () => {
    let s: Session[] = [];
    s = upsertSession(s, "/a", "shell");
    s = upsertSession(s, "/a", "claude"); // toggling program keeps shell alive
    s = upsertSession(s, "/b", "shell"); // switching worktree keeps /a alive
    expect(s).toHaveLength(3);
    expect(s).toContainEqual({ path: "/a", program: "shell" });
    expect(s).toContainEqual({ path: "/a", program: "claude" });
    expect(s).toContainEqual({ path: "/b", program: "shell" });
  });
});

describe("isSessionActive", () => {
  const s: Session = { path: "/a", program: "claude" };

  it("is active only for the selected path + program in terminal view", () => {
    expect(isSessionActive(s, "terminal", "/a", "claude")).toBe(true);
  });

  it("is inactive in diff view (terminals hidden but alive)", () => {
    expect(isSessionActive(s, "diff", "/a", "claude")).toBe(false);
  });

  it("is inactive when another program is selected", () => {
    expect(isSessionActive(s, "terminal", "/a", "shell")).toBe(false);
  });

  it("is inactive when another worktree is selected", () => {
    expect(isSessionActive(s, "terminal", "/b", "claude")).toBe(false);
  });
});
