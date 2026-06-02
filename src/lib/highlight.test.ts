import { describe, it, expect } from "vitest";
import { highlightLine, type Token } from "./highlight";

const kinds = (toks: Token[]) => toks.map((t) => t.kind);
const text = (toks: Token[]) => toks.map((t) => t.text).join("");

describe("highlightLine", () => {
  it("reconstructs the original line exactly", () => {
    const line = `  let x = "hi"; // note`;
    expect(text(highlightLine(line))).toBe(line);
  });

  it("tags keywords", () => {
    const toks = highlightLine("fn main() {}");
    expect(toks[0]).toEqual({ text: "fn", kind: "keyword" });
  });

  it("tags strings including their quotes", () => {
    const toks = highlightLine('x = "hello world"');
    expect(toks.some((t) => t.kind === "string" && t.text === '"hello world"')).toBe(true);
  });

  it("handles escaped quotes inside strings", () => {
    const toks = highlightLine('"a \\" b"');
    expect(toks[0]).toEqual({ text: '"a \\" b"', kind: "string" });
  });

  it("treats // and # as line comments to end of line", () => {
    expect(highlightLine("code // trailing").some((t) => t.kind === "comment" && t.text === "// trailing")).toBe(true);
    expect(highlightLine("# whole line").some((t) => t.kind === "comment")).toBe(true);
  });

  it("tags numbers including hex", () => {
    const toks = highlightLine("v = 0xFF + 42");
    expect(toks.filter((t) => t.kind === "number").map((t) => t.text)).toEqual(["0xFF", "42"]);
  });

  it("leaves ordinary identifiers plain", () => {
    const toks = highlightLine("myVariable");
    expect(kinds(toks)).toEqual(["plain"]);
  });
});
