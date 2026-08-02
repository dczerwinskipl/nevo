#!/usr/bin/env node
// PreToolUse hook scoped to the nevo-ai-spec-researcher subagent only (declared in that
// agent's own frontmatter, not in .claude/settings.json — must not affect the main
// session or any other subagent).
//
// Fail-closed allowlist for Bash: reject any command containing shell metacharacters
// that could chain, substitute, redirect, or pipe (so an otherwise-allowed prefix can't
// be smuggled alongside a mutating one), then match the remaining single command against
// an explicit list of read-only invocations. Anything that doesn't match is denied.

import { readFileSync } from 'node:fs';

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

const DANGEROUS_CHARS = /[;&|`$<>\n\r]/;

const ALLOWLIST = [
  /^git status(\s+\S+)*$/,
  /^git log(\s+\S+)*$/,
  /^git show(\s+\S+)*$/,
  /^git diff(\s+\S+)*$/,
  /^git branch --show-current$/,
  /^git rev-parse(\s+\S+)*$/,
  /^dotnet sln(\s+\S+)?\s+list$/,
  /^node tools\/docs\.mjs (find|validate|check)(\s+\S+)*$/,
  /^node tools\/specs\.mjs (list|validate|check)(\s+\S+)*$/,
];

function deny(reason) {
  process.stderr.write(
    `[nevo-ai-spec-researcher-bash-guard] BLOCKED: ${reason}\n`
  );
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

let payload;
try {
  payload = JSON.parse(readStdin() || '{}');
} catch {
  deny('could not parse hook input JSON');
}

if (payload.tool_name !== 'Bash') {
  // Matcher already restricts this hook to Bash calls; fail closed anyway if
  // something unexpected reaches it rather than silently allowing.
  deny(`unexpected tool_name '${payload.tool_name}' for a Bash-only guard`);
}

const command = String(payload.tool_input?.command ?? '').trim();

if (!command) {
  deny('empty command');
}

if (DANGEROUS_CHARS.test(command)) {
  deny(`command contains a chaining/substitution/redirection character: ${command}`);
}

if (ALLOWLIST.some((pattern) => pattern.test(command))) {
  allow(`matches nevo-ai-spec-researcher read-only allowlist: ${command}`);
}

deny(`not on the nevo-ai-spec-researcher read-only allowlist: ${command}`);
