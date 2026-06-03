// Turn the Agent SDK's raw NDJSON messages into a tidy stream of UI events.
// Pure and unit-tested — the AgentRunPanel just renders what this returns.

export type AgentEventKind =
  | "start"
  | "system"
  | "assistant"
  | "tool"
  | "result"
  | "done"
  | "error"
  | "raw";

export interface AgentEvent {
  kind: AgentEventKind;
  text: string;
  /** For tool events: the tool name. */
  tool?: string;
  /** For result events: cost in USD and turn count, when present. */
  costUsd?: number;
  turns?: number;
}

/** One exchange in a chat: the user's message and the streamed events back. */
export interface ChatTurn {
  question: string;
  events: AgentEvent[];
}

/** A multi-turn chat with Claude in a worktree. Owned by App so it survives
 *  view switches. `sessionId` (captured from the stream) lets the next turn
 *  resume the same Claude conversation. */
export interface Chat {
  /** Current agent run id (the in-flight turn), or null when idle. */
  runId: string | null;
  /** Claude session id to resume; captured from streamed messages. */
  sessionId: string | null;
  turns: ChatTurn[];
  running: boolean;
}

/** Pull a Claude session id out of a raw SDK message line, if present. */
export function extractSessionId(raw: string): string | null {
  try {
    const msg = JSON.parse(raw);
    return typeof msg.session_id === "string" ? msg.session_id : null;
  } catch {
    return null;
  }
}

/** Short, human description of a tool_use block's input. */
function describeToolInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const o = input as Record<string, unknown>;
  // Pick the most informative common field.
  for (const key of ["file_path", "path", "command", "pattern", "query", "url"]) {
    if (typeof o[key] === "string") return o[key] as string;
  }
  return "";
}

/**
 * Map one raw NDJSON line from the sidecar to zero or more UI events.
 * An `assistant` message can yield several (text + each tool call).
 */
export function summarizeAgentEvent(raw: string): AgentEvent[] {
  const line = raw.trim();
  if (!line) return [];

  let msg: any;
  try {
    msg = JSON.parse(line);
  } catch {
    return [{ kind: "raw", text: line }];
  }

  switch (msg.type) {
    case "quay_start":
      return [{ kind: "start", text: msg.model ? `Started · ${msg.model}` : "Started" }];
    case "quay_done":
      return [{ kind: "done", text: "Agent finished." }];
    case "quay_error":
      return [{ kind: "error", text: String(msg.error ?? "agent error") }];

    case "system":
      if (msg.subtype === "init") {
        return [{ kind: "system", text: `Model ${msg.model ?? "?"}` }];
      }
      return [];

    case "assistant": {
      const blocks: any[] = msg.message?.content ?? [];
      const events: AgentEvent[] = [];
      for (const b of blocks) {
        if (b.type === "text" && b.text?.trim()) {
          events.push({ kind: "assistant", text: b.text.trim() });
        } else if (b.type === "tool_use") {
          const detail = describeToolInput(b.input);
          events.push({
            kind: "tool",
            tool: b.name,
            text: detail ? `${b.name}: ${detail}` : b.name,
          });
        }
      }
      return events;
    }

    case "result":
      return [
        {
          kind: "result",
          text: msg.result ?? msg.subtype ?? "done",
          costUsd: typeof msg.total_cost_usd === "number" ? msg.total_cost_usd : undefined,
          turns: typeof msg.num_turns === "number" ? msg.num_turns : undefined,
        },
      ];

    default:
      return [];
  }
}
