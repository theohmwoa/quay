import { useRef, useState } from "react";
import type { DiffFile, DiffSummary, Narration } from "../lib/api";
import {
  basename,
  dirname,
  formatStat,
  statBar,
  statusBadge,
  statusColor,
} from "../lib/format";
import { highlightLine, type TokenKind } from "../lib/highlight";

interface Props {
  diff: DiffSummary;
  narration: Narration;
  /** Optional reviewer notes per file path. */
  notes?: Record<string, string>;
  onNote?: (path: string, note: string) => void;
}

/**
 * The "understand what happened" view: a narrated change review with intent
 * clusters, risks, per-file notes, syntax-highlighted hunks, per-file
 * navigation, and reviewer notes.
 */
export function NarratedDiff({ diff, narration, notes, onNote }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const navIndex = useRef(0);

  const noteFor = (path: string) =>
    narration.file_notes.find((n) => n.path === path)?.note;

  const toggle = (path: string) =>
    setExpanded((e) => ({ ...e, [path]: !e[path] }));

  // Jump to the next/previous file, expanding and scrolling it into view.
  const navigate = (dir: 1 | -1) => {
    if (diff.files.length === 0) return;
    navIndex.current =
      (navIndex.current + dir + diff.files.length) % diff.files.length;
    const file = diff.files[navIndex.current];
    setExpanded((e) => ({ ...e, [file.path]: true }));
    rowRefs.current[file.path]?.scrollIntoView({ block: "center" });
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <header className="border-b border-[var(--color-border)] px-5 py-4">
        <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
          <span>
            {diff.base} … {diff.head || "HEAD"}
          </span>
          <span aria-hidden>·</span>
          <span className="text-[var(--color-add)]">+{diff.total_additions}</span>
          <span className="text-[var(--color-del)]">−{diff.total_deletions}</span>
          <EngineBadge engine={narration.engine} />
        </div>
        <p className="max-w-3xl text-[15px] leading-relaxed text-[var(--color-fg)]">
          {narration.summary}
        </p>
      </header>

      {/* Risks */}
      {narration.risks.length > 0 && (
        <section className="border-b border-[var(--color-border)] bg-[var(--color-del-bg)]/30 px-5 py-3">
          <h2 className="mb-1 text-[11px] uppercase tracking-wider text-[var(--color-del)]">
            Worth checking
          </h2>
          <ul className="space-y-0.5">
            {narration.risks.map((r, i) => (
              <li key={i} className="flex gap-2 text-[13px] text-[var(--color-fg-muted)]">
                <span className="text-[var(--color-del)]" aria-hidden>
                  ▲
                </span>
                {r}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Clusters */}
      {narration.clusters.length > 0 && (
        <section className="border-b border-[var(--color-border)] px-5 py-4">
          <h2 className="mb-3 text-[11px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
            What changed
          </h2>
          <div className="space-y-3">
            {narration.clusters.map((c, i) => (
              <div key={i} className="border-l-2 border-[var(--color-accent-dim)] pl-3">
                <div className="font-medium text-[var(--color-fg)]">{c.title}</div>
                <div className="text-[13px] text-[var(--color-fg-muted)]">
                  {c.description}
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {c.files.map((f) => (
                    <span
                      key={f}
                      className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-panel-2)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-fg-subtle)]"
                    >
                      {basename(f)}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Files */}
      <section className="px-5 py-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[11px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
            {diff.files.length} file{diff.files.length === 1 ? "" : "s"}
          </h2>
          {diff.files.length > 1 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                title="Previous change"
                onClick={() => navigate(-1)}
                className="rounded-[var(--radius)] border border-[var(--color-border)] px-1.5 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
              >
                ↑
              </button>
              <button
                type="button"
                title="Next change"
                onClick={() => navigate(1)}
                className="rounded-[var(--radius)] border border-[var(--color-border)] px-1.5 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
              >
                ↓
              </button>
            </div>
          )}
        </div>
        <div className="space-y-1.5">
          {diff.files.map((f) => (
            <FileRow
              key={f.path}
              ref={(el) => {
                rowRefs.current[f.path] = el;
              }}
              file={f}
              note={noteFor(f.path)}
              open={!!expanded[f.path]}
              onToggle={() => toggle(f.path)}
              reviewNote={notes?.[f.path] ?? ""}
              onReviewNote={onNote ? (v) => onNote(f.path, v) : undefined}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function EngineBadge({ engine }: { engine: string }) {
  const haiku = engine === "haiku";
  return (
    <span
      title={haiku ? "Narrated by Haiku" : "Offline heuristic narrator"}
      className={`ml-auto rounded-[var(--radius)] px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${
        haiku
          ? "bg-[var(--color-accent-dim)] text-[var(--color-accent)]"
          : "bg-[var(--color-panel-2)] text-[var(--color-fg-subtle)]"
      }`}
    >
      {engine}
    </span>
  );
}

const TOKEN_CLASS: Record<TokenKind, string> = {
  plain: "",
  keyword: "text-[var(--color-accent)]",
  string: "text-[#7fae8a]",
  comment: "italic text-[var(--color-fg-subtle)]",
  number: "text-[#c69a6a]",
};

/** Render a code line with lightweight syntax highlighting. */
function Highlighted({ content }: { content: string }) {
  return (
    <span className="whitespace-pre">
      {highlightLine(content).map((t, i) =>
        t.kind === "plain" ? (
          <span key={i}>{t.text}</span>
        ) : (
          <span key={i} className={TOKEN_CLASS[t.kind]}>
            {t.text}
          </span>
        ),
      )}
    </span>
  );
}

interface FileRowProps {
  file: DiffFile;
  note?: string;
  open: boolean;
  onToggle: () => void;
  reviewNote: string;
  onReviewNote?: (note: string) => void;
  ref?: React.Ref<HTMLDivElement>;
}

function FileRow({
  file,
  note,
  open,
  onToggle,
  reviewNote,
  onReviewNote,
  ref,
}: FileRowProps) {
  const dir = dirname(file.path);
  return (
    <div
      ref={ref}
      className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-panel)]"
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-[var(--color-panel-2)]"
      >
        <span className={`w-3 font-mono text-[12px] ${statusColor(file.status)}`}>
          {statusBadge(file.status)}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
          {dir && <span className="text-[var(--color-fg-subtle)]">{dir}/</span>}
          <span className="text-[var(--color-fg)]">{basename(file.path)}</span>
        </span>
        {note && (
          <span className="hidden max-w-md truncate text-[12px] text-[var(--color-fg-muted)] md:inline">
            {note}
          </span>
        )}
        <span className="font-mono text-[11px] tracking-tight text-[var(--color-accent)]">
          {statBar(file.additions, file.deletions)}
        </span>
        <span className="w-20 text-right font-mono text-[11px] text-[var(--color-fg-subtle)]">
          {formatStat(file.additions, file.deletions)}
        </span>
      </button>

      {open && !file.binary && (
        <div className="overflow-x-auto border-t border-[var(--color-border)] font-mono text-[12px] leading-[1.5]">
          {file.hunks.map((h, hi) => (
            <div key={hi}>
              <div className="bg-[var(--color-panel-2)] px-3 py-1 text-[var(--color-fg-subtle)]">
                {h.header}
              </div>
              {h.lines.map((l, li) => (
                <div
                  key={li}
                  className={
                    l.origin === "+"
                      ? "bg-[var(--color-add-bg)]"
                      : l.origin === "-"
                        ? "bg-[var(--color-del-bg)]"
                        : ""
                  }
                >
                  <span className="select-none px-3 text-[var(--color-fg-subtle)]">
                    {l.origin === " " ? " " : l.origin}
                  </span>
                  <Highlighted content={l.content} />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {open && file.binary && (
        <div className="border-t border-[var(--color-border)] px-3 py-2 text-[12px] text-[var(--color-fg-subtle)]">
          Binary file — no textual diff.
        </div>
      )}

      {open && onReviewNote && (
        <div className="border-t border-[var(--color-border)] px-3 py-2">
          <input
            value={reviewNote}
            onChange={(e) => onReviewNote(e.target.value)}
            placeholder="review note for this file…"
            className="w-full rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-panel-2)] px-2 py-1 text-[12px] outline-none focus:border-[var(--color-accent-dim)]"
          />
        </div>
      )}
    </div>
  );
}
