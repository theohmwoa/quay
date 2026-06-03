// Node sidecar: runs a Claude agent via the Agent SDK in a worktree and
// streams every SDK message to stdout as NDJSON (one JSON object per line).
//
// The Rust backend spawns this with a JSON payload and forwards each line to
// the frontend. Kept deliberately thin — all UI interpretation happens there.
//
// Payload (argv[2], JSON):
//   { prompt, cwd, model?, maxTurns?, permissionMode?, resume? }
// `resume` is a Claude session id — pass it to continue an existing chat.
//
// Auth: the SDK runs through the logged-in `claude` CLI, so this uses your
// Claude subscription. No API key required.

import { query } from "@anthropic-ai/claude-agent-sdk";

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

async function main() {
  let payload;
  try {
    payload = JSON.parse(process.argv[2] ?? "{}");
  } catch (e) {
    emit({ type: "quay_error", error: `bad payload: ${String(e)}` });
    process.exit(1);
    return;
  }

  const {
    prompt,
    cwd,
    model,
    maxTurns = 24,
    permissionMode = "bypassPermissions",
    resume,
  } = payload;
  if (!prompt || !cwd) {
    emit({ type: "quay_error", error: "payload requires { prompt, cwd }" });
    process.exit(1);
    return;
  }

  emit({ type: "quay_start", cwd, model: model ?? null, resumed: !!resume });

  try {
    for await (const message of query({
      prompt,
      options: {
        cwd,
        ...(model ? { model } : {}),
        ...(resume ? { resume } : {}),
        permissionMode,
        maxTurns,
      },
    })) {
      emit(message);
    }
    emit({ type: "quay_done" });
  } catch (e) {
    emit({ type: "quay_error", error: String(e?.stack || e) });
    process.exit(1);
  }
}

main();
