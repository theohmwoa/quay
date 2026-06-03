import { describe, it, expect } from "vitest";
import { summarizeAgentEvent } from "./agent";

describe("summarizeAgentEvent", () => {
  it("ignores blank lines", () => {
    expect(summarizeAgentEvent("   ")).toEqual([]);
  });

  it("returns a raw event for non-JSON", () => {
    expect(summarizeAgentEvent("not json")).toEqual([{ kind: "raw", text: "not json" }]);
  });

  it("maps sidecar lifecycle markers", () => {
    expect(summarizeAgentEvent('{"type":"quay_start","model":"claude-haiku-4-5"}')).toEqual([
      { kind: "start", text: "Started · claude-haiku-4-5" },
    ]);
    expect(summarizeAgentEvent('{"type":"quay_done"}')).toEqual([
      { kind: "done", text: "Agent finished." },
    ]);
    expect(summarizeAgentEvent('{"type":"quay_error","error":"boom"}')).toEqual([
      { kind: "error", text: "boom" },
    ]);
  });

  it("summarizes a system init message", () => {
    const out = summarizeAgentEvent('{"type":"system","subtype":"init","model":"sonnet"}');
    expect(out).toEqual([{ kind: "system", text: "Model sonnet" }]);
  });

  it("splits an assistant message into text and tool events", () => {
    const msg = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Let me read the file." },
          { type: "tool_use", name: "Read", input: { file_path: "src/main.rs" } },
          { type: "tool_use", name: "Bash", input: { command: "cargo test" } },
        ],
      },
    });
    const out = summarizeAgentEvent(msg);
    expect(out).toEqual([
      { kind: "assistant", text: "Let me read the file." },
      { kind: "tool", tool: "Read", text: "Read: src/main.rs" },
      { kind: "tool", tool: "Bash", text: "Bash: cargo test" },
    ]);
  });

  it("extracts cost and turns from a result", () => {
    const out = summarizeAgentEvent(
      '{"type":"result","subtype":"success","result":"Done.","total_cost_usd":0.012,"num_turns":4}',
    );
    expect(out).toEqual([
      { kind: "result", text: "Done.", costUsd: 0.012, turns: 4 },
    ]);
  });

  it("ignores unknown message types", () => {
    expect(summarizeAgentEvent('{"type":"stream_event"}')).toEqual([]);
  });
});
