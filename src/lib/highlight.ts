// A tiny, dependency-free, language-agnostic syntax tokenizer for diff lines.
// Not a real parser — a fast heuristic that colors strings, comments, numbers
// and a common keyword set well enough across JS/TS/Rust/Python/Go/etc.
// Pure and unit-tested.

export type TokenKind = "plain" | "keyword" | "string" | "comment" | "number";

export interface Token {
  text: string;
  kind: TokenKind;
}

const KEYWORDS = new Set([
  // declarations / control flow shared across many languages
  "fn", "function", "let", "const", "var", "mut", "pub", "use", "mod", "impl",
  "struct", "enum", "trait", "type", "interface", "class", "extends", "implements",
  "def", "lambda", "return", "yield", "if", "else", "elif", "for", "while", "loop",
  "match", "case", "switch", "break", "continue", "in", "of", "import", "from",
  "export", "default", "new", "async", "await", "try", "catch", "finally", "throw",
  "public", "private", "protected", "static", "void", "self", "this", "super",
  "true", "false", "null", "nil", "none", "None", "True", "False", "and", "or", "not",
  "where", "as", "with", "go", "func", "package", "defer", "spawn",
]);

const ID_START = /[A-Za-z_]/;
const ID_CONT = /[A-Za-z0-9_]/;
const DIGIT = /[0-9]/;

/** Tokenize a single line of code for display highlighting. */
export function highlightLine(line: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let plain = "";

  const flushPlain = () => {
    if (plain) {
      tokens.push({ text: plain, kind: "plain" });
      plain = "";
    }
  };

  while (i < line.length) {
    const c = line[i];
    const next = line[i + 1];

    // Line comments: // (any lang) or # (shell/python style)
    if ((c === "/" && next === "/") || c === "#") {
      flushPlain();
      tokens.push({ text: line.slice(i), kind: "comment" });
      break;
    }

    // Strings: ' " `
    if (c === '"' || c === "'" || c === "`") {
      flushPlain();
      let j = i + 1;
      while (j < line.length) {
        if (line[j] === "\\") {
          j += 2;
          continue;
        }
        if (line[j] === c) {
          j += 1;
          break;
        }
        j += 1;
      }
      tokens.push({ text: line.slice(i, j), kind: "string" });
      i = j;
      continue;
    }

    // Numbers (including 0x.. and decimals)
    if (DIGIT.test(c)) {
      flushPlain();
      let j = i + 1;
      while (j < line.length && /[0-9a-fA-FxX._]/.test(line[j])) j += 1;
      tokens.push({ text: line.slice(i, j), kind: "number" });
      i = j;
      continue;
    }

    // Identifiers / keywords
    if (ID_START.test(c)) {
      let j = i + 1;
      while (j < line.length && ID_CONT.test(line[j])) j += 1;
      const word = line.slice(i, j);
      if (KEYWORDS.has(word)) {
        flushPlain();
        tokens.push({ text: word, kind: "keyword" });
      } else {
        plain += word;
      }
      i = j;
      continue;
    }

    plain += c;
    i += 1;
  }
  flushPlain();
  return tokens;
}
