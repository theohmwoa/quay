# quay

A personal terminal / agent-deck for driving **Claude Code across git worktrees**,
with a **narrated** branch-vs-base diff — built so the value lives in the
orchestration layer, not in re-implementing a terminal emulator.

> Codename `quay` (where boats dock — agents berth here). Rename freely.

## Why

Warp can't easily spin up a Claude terminal bound to a worktree, and its diff
is "vs remote" rather than "the whole feature vs `main`". quay is the opposite:
the terminal is just one panel; the point is **worktrees + agents + an
understandable diff**.

## The central loop

```
create a worktree  ->  spawn Claude in it  ->  see a narrated branch-vs-main diff
```

The end-to-end loop is verified by a single core test:
`src-tauri/src/integration_tests.rs`.

## Architecture

Tauri v2 — a Rust core with a web UI you fully own (no Zed/editor framework
underneath).

### Rust core (`src-tauri/src/`) — all unit-tested

| Module          | Responsibility                                                        |
| --------------- | --------------------------------------------------------------------- |
| `git/worktree`  | list / create / remove worktrees (shells out to `git`) + `slugify`    |
| `git/diff`      | structured `base...HEAD` diff via `git2` (merge-base, hunks, stats)    |
| `pty`           | spawn a process in a PTY, stream output, write / resize / kill         |
| `narrate`       | turn a diff into a `Narration` (summary, intent clusters, risks)       |
| `lib.rs`        | thin Tauri commands + `PtyManager` state + output event streaming      |

### Frontend (`src/`)

- `lib/api.ts` — typed 1:1 bridge to the Rust commands
- `lib/format.ts` — pure display helpers (unit-tested)
- `components/AgentDeck` — every worktree at a glance
- `components/TerminalView` — xterm.js bound to a worktree's PTY
- `components/NarratedDiff` — the "understand what happened" view

## The narrated diff

Not a raw git diff — a **narrated change review**:

- scope is the worktree vs `main`'s merge-base → the whole feature, including
  **uncommitted** work (staged, unstaged, and untracked) — no commit required
- a one-paragraph summary of what the change accomplishes
- changes grouped **by intent**, not alphabetically by file
- risk flags ("files deleted", "large change in X")
- a plain-English note per file, raw hunks one click away

## Two brains (deliberate cost model)

- **Heavy work → `claude` CLI in a PTY.** Runs on your Claude subscription;
  spends no API credits. This is the actual coding.
- **Cheap smart sprinkles → Haiku via the Anthropic API.** Narrating diffs,
  (soon) naming worktrees. Set `ANTHROPIC_API_KEY` to enable; otherwise quay
  uses a deterministic **offline** narrator. Optional `QUAY_NARRATOR_MODEL`
  overrides the model.

The test suite never hits the network or spends credits — the narrator is
behind a trait with an offline mock, and prompt-building / response-parsing are
pure, separately tested functions.

## Develop

```sh
pnpm install
pnpm tauri dev        # run the app in development mode
```

## Test & verify

```sh
# Rust core
cd src-tauri && cargo test && cargo clippy --all-targets

# Frontend
pnpm typecheck && pnpm test && pnpm build

# Whole app (release binary)
pnpm tauri build --no-bundle
```

## Features

**Agent loop (task → review → land).** Each worktree shows live status
(changed / ↑ahead / ↓behind). The diff view's land panel lets you generate a
commit message (Haiku or offline), commit, push, open a PR via `gh`, or **land**
the branch — merge it into base (with conflict detection) and remove the
worktree. Conflicts are detected up front and the merge aborted cleanly.

**Multi-terminal deck.** Open multiple terminals (shell or `claude`) per
worktree as **tabs**; every PTY stays alive when you switch views or tabs —
never resets a running Claude. **Split** view shows two panes side by side.
Each terminal has **scrollback search** (Cmd/Ctrl+F). A `claude` terminal is
bound to a **Claude session id** (`--session-id`), persisted and **resumed**
(`--resume`) on relaunch so it drops back into the same conversation. The deck
(repo, base, open sessions) **persists across app restarts**.

**Chat mode (Agent SDK).** A real, multi-turn **chat with Claude** in the
selected worktree — the primary way to drive an agent (the CLI `claude` terminal
stays available on the side). Each turn streams the agent's steps — assistant
text, every tool call (Read/Edit/Bash…), and a final result with turns — and the
next turn resumes the same Claude session. Runs via the **Claude Agent SDK**
(Node sidecar `sidecar/agent-runner.mjs`), which authenticates through the
logged-in `claude` CLI, so it uses your **Claude subscription** — no API key.
The chat (and its event subscriptions) survives view switches. New agents open
straight into a chat. Delete a worktree from the sidebar (hover → 🗑 → confirm).

**Diff review.** Narrated branch-vs-base diff with intent clusters and risks;
**syntax-highlighted** hunks, per-file navigation, and reviewer notes. A
**commit-by-commit timeline** reads the branch as steps, and **Ask** lets you
interrogate the diff in natural language (Haiku).

## v1 limitations / next up

- Split view is two panes; arbitrary grids/nesting are future work.
- Per-commit timeline shows each commit's own diff; per-commit Haiku narration
  (vs. the author's subject) is a possible enhancement.
- A native folder picker for the repo path (currently a text field).
- Diff/timeline caching so views don't recompute on every visit.
- Reattach replay (`pty_scrollback`) is wired in the backend; the frontend
  currently keeps PTYs alive in-process rather than replaying after a restart.
- Chat mode resolves the sidecar relative to the executable (dev/`--no-bundle`);
  bundling it as a Tauri resource for a packaged `.app` is a follow-up.
- Each chat turn spawns a fresh sidecar that resumes the session (simple +
  correct); a single long-lived streaming-input process is a latency follow-up.

---

> The quick brown fox jumps over the lazy dog while a curious cat watches from
> the quay, sipping coffee and contemplating the gentle hum of distant ships.
