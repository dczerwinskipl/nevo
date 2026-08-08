// Minimal, dependency-free shell-word tokenizer for verification command
// strings (D28 self-check, `tools/specs.mjs`'s `runVerificationCommand`).
// Splitting on `/\s+/` broke any command with a quoted argument containing a
// space, a filter expression, or a shell metacharacter used only as a
// literal value (e.g. `dotnet test --filter "Category=A|Category=B"`).
//
// This is a tokenizer, not a shell: it never expands variables/globs and
// never interprets `|`, `>`, `&&`, etc. as operators — every command still
// runs via `execFileSync` (no shell), so those characters only ever reach a
// child process as literal argument bytes, exactly like the quoted example
// above. A command that genuinely needs shell semantics (pipes, redirects,
// chaining) is out of scope for this parser.

/**
 * Split `input` into argv-style words: single/double-quoted spans keep
 * embedded whitespace, `\X` outside quotes escapes the next character,
 * `\"`/`\\` inside a double-quoted span escape themselves (single quotes
 * inside a double-quoted span are literal, and vice versa), and `''`/`""`
 * contribute a real empty-string word rather than being dropped.
 */
export function splitShellWords(input) {
  const words = [];
  let current = '';
  let hasCurrent = false;
  let i = 0;
  const n = input.length;

  while (i < n) {
    const ch = input[i];

    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      if (hasCurrent) { words.push(current); current = ''; hasCurrent = false; }
      i++;
      continue;
    }

    if (ch === "'") {
      hasCurrent = true;
      i++;
      const close = input.indexOf("'", i);
      if (close === -1) throw new Error(`Unterminated single quote in command: ${input}`);
      current += input.slice(i, close);
      i = close + 1;
      continue;
    }

    if (ch === '"') {
      hasCurrent = true;
      i++;
      while (i < n && input[i] !== '"') {
        if (input[i] === '\\' && (input[i + 1] === '"' || input[i + 1] === '\\')) {
          current += input[i + 1];
          i += 2;
        } else {
          current += input[i];
          i++;
        }
      }
      if (i >= n) throw new Error(`Unterminated double quote in command: ${input}`);
      i++; // closing quote
      continue;
    }

    if (ch === '\\' && i + 1 < n) {
      current += input[i + 1];
      hasCurrent = true;
      i += 2;
      continue;
    }

    current += ch;
    hasCurrent = true;
    i++;
  }

  if (hasCurrent) words.push(current);
  return words;
}
