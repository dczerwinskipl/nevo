#!/usr/bin/env node
// PreToolUse hook scoped to the nevo-ai-spec-researcher subagent only (declared in that
// agent's own frontmatter, not in .claude/settings.json — must not affect the main
// session or any other subagent).
//
// Explicit, whitelist-only command-form validation: reject any command containing
// shell metacharacters that could chain, substitute, redirect, or pipe, then tokenize
// the remainder and check it against a small, per-subcommand table of allowed flags
// and a safe positional-argument pattern. A flag or argument not explicitly listed is
// rejected — this rejects `--output`, `-o`, `--output=<path>`, and any other
// file-writing option not because each is individually recognized as dangerous, but
// because only a short, curated list of read-only flags is ever accepted.
//
// `validateCommand` is exported as a pure function for testing without spawning a
// process — see tools/tests/bash-guard.test.mjs.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DANGEROUS_CHARS = /[;&|`$<>\n\r]/;

function tokenize(command) {
  const tokens = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(command))) tokens.push(m[1] ?? m[2] ?? m[3]);
  return tokens;
}

// Positional arguments (refs, paths, commit-ish values) — no leading '-' (that would
// make it indistinguishable from a flag), alphanumeric plus the characters git refs
// and relative paths actually use.
const SAFE_ARG_RE = /^[A-Za-z0-9][A-Za-z0-9._/~^:@-]*$/;

const GIT_COMMANDS = {
  status: { flags: new Set(['--porcelain', '-s', '--short', '-b', '--branch']), maxArgs: 0 },
  log: { flags: new Set(['--oneline', '--stat', '--name-only', '--name-status', '-p', '--graph', '--all', '--decorate', '--no-color']), maxArgs: 3 },
  show: { flags: new Set(['--stat', '--name-only', '--name-status', '--no-color']), maxArgs: 2 },
  diff: { flags: new Set(['--stat', '--name-only', '--name-status', '--cached', '--no-color']), maxArgs: 2 },
  branch: { flags: new Set(['--show-current']), maxArgs: 0 },
  'rev-parse': { flags: new Set(['--abbrev-ref', '--verify', '--short']), maxArgs: 2 },
};

function validateGit(tokens) {
  const sub = tokens[1];
  const spec = GIT_COMMANDS[sub];
  if (!spec) return { ok: false, reason: `git subcommand '${sub}' is not on the allowlist` };
  let argCount = 0;
  for (const tok of tokens.slice(2)) {
    if (tok.startsWith('-')) {
      if (!spec.flags.has(tok)) {
        return { ok: false, reason: `flag '${tok}' is not on the allowlist for 'git ${sub}'` };
      }
    } else {
      if (!SAFE_ARG_RE.test(tok)) {
        return { ok: false, reason: `argument '${tok}' does not match the safe ref/path pattern` };
      }
      argCount++;
      if (argCount > spec.maxArgs) {
        return { ok: false, reason: `too many positional arguments for 'git ${sub}'` };
      }
    }
  }
  return { ok: true };
}

const DOTNET_SLN_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*\.sln$/;

function validateDotnet(tokens) {
  if (tokens[1] !== 'sln') {
    return { ok: false, reason: `dotnet subcommand '${tokens[1]}' is not on the allowlist` };
  }
  const rest = tokens.slice(2);
  if (rest.length === 1 && rest[0] === 'list') return { ok: true };
  if (rest.length === 2 && DOTNET_SLN_FILE_RE.test(rest[0]) && rest[1] === 'list') return { ok: true };
  return { ok: false, reason: `'dotnet sln' form not recognized — only 'dotnet sln [<file>.sln] list' is allowed` };
}

const DOCS_MJS_SUBCOMMANDS = new Set(['find', 'validate', 'check']);
const DOCS_MJS_FIND_FLAGS = new Set(['--scope', '--type', '--format']);
const SPECS_MJS_SUBCOMMANDS = new Set(['list', 'validate', 'check']);

function validateNode(tokens) {
  const target = tokens[1];

  if (target === 'tools/docs.mjs') {
    const sub = tokens[2];
    if (!DOCS_MJS_SUBCOMMANDS.has(sub)) {
      return { ok: false, reason: `'node tools/docs.mjs ${sub}' is not on the allowlist` };
    }
    if (sub !== 'find') {
      if (tokens.length > 3) {
        return { ok: false, reason: `'node tools/docs.mjs ${sub}' does not accept extra arguments` };
      }
      return { ok: true };
    }
    const rest = tokens.slice(3);
    if (rest.length % 2 !== 0) {
      return { ok: false, reason: `'node tools/docs.mjs find' flags must be '--flag value' pairs` };
    }
    for (let i = 0; i < rest.length; i += 2) {
      const flag = rest[i];
      const value = rest[i + 1];
      if (!DOCS_MJS_FIND_FLAGS.has(flag)) {
        return { ok: false, reason: `flag '${flag}' is not on the allowlist for 'docs.mjs find'` };
      }
      if (!SAFE_ARG_RE.test(value)) {
        return { ok: false, reason: `value '${value}' for '${flag}' does not match the safe pattern` };
      }
    }
    return { ok: true };
  }

  if (target === 'tools/specs.mjs') {
    const sub = tokens[2];
    if (!SPECS_MJS_SUBCOMMANDS.has(sub)) {
      return { ok: false, reason: `'node tools/specs.mjs ${sub}' is not on the allowlist` };
    }
    if (tokens.length > 3) {
      return { ok: false, reason: `'node tools/specs.mjs ${sub}' does not accept extra arguments` };
    }
    return { ok: true };
  }

  return { ok: false, reason: `node target '${target}' is not on the allowlist` };
}

export function validateCommand(command) {
  const trimmed = String(command ?? '').trim();
  if (!trimmed) return { ok: false, reason: 'empty command' };
  if (DANGEROUS_CHARS.test(trimmed)) {
    return {
      ok: false,
      reason: `command contains a chaining/substitution/redirection/pipe character: ${trimmed}`,
    };
  }

  const tokens = tokenize(trimmed);
  if (!tokens.length) return { ok: false, reason: 'empty command' };

  switch (tokens[0]) {
    case 'git': return validateGit(tokens);
    case 'dotnet': return validateDotnet(tokens);
    case 'node': return validateNode(tokens);
    default: return { ok: false, reason: `command '${tokens[0]}' is not on the allowlist` };
  }
}

// ── Hook I/O wrapper ────────────────────────────────────────────────────────

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function deny(reason) {
  process.stderr.write(`[nevo-ai-spec-researcher-bash-guard] BLOCKED: ${reason}\n`);
  process.exit(2);
}

function allow(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}

function runHook() {
  let payload;
  try {
    payload = JSON.parse(readStdin() || '{}');
  } catch {
    deny('could not parse hook input JSON');
    return;
  }

  if (payload.tool_name !== 'Bash') {
    // Matcher already restricts this hook to Bash calls; fail closed anyway if
    // something unexpected reaches it rather than silently allowing.
    deny(`unexpected tool_name '${payload.tool_name}' for a Bash-only guard`);
    return;
  }

  const command = payload.tool_input?.command ?? '';
  const result = validateCommand(command);
  if (result.ok) {
    allow(`matches nevo-ai-spec-researcher read-only allowlist: ${command}`);
  } else {
    deny(result.reason);
  }
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  runHook();
}
