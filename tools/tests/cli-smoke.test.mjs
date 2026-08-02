// CLI-level smoke tests for tools/specs.mjs and tools/docs.mjs — the important
// success/failure paths, run as real spawned processes (unlike the pure-function
// tests elsewhere in this directory). Deliberately read-only: these run against the
// real repository state, so only non-mutating commands (validate/list/check/
// fingerprint) and usage-error paths are exercised here. The mutating transition
// logic (approve/start/complete/verify) is covered exhaustively as pure functions in
// task-lifecycle.test.mjs instead of by spawning a process against real spec files.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '../../..');
const SPECS_CLI = join(ROOT, 'tools', 'specs.mjs');
const DOCS_CLI = join(ROOT, 'tools', 'docs.mjs');

function run(file, args) {
  try {
    const stdout = execFileSync('node', [file, ...args], { cwd: ROOT, encoding: 'utf8' });
    return { code: 0, stdout };
  } catch (err) {
    return { code: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

describe('tools/specs.mjs CLI smoke tests', () => {
  test('validate exits 0 on the real repository', () => {
    const r = run(SPECS_CLI, ['validate']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /no errors/);
  });

  test('list exits 0 and does not throw on real active changes', () => {
    const r = run(SPECS_CLI, ['list']);
    assert.equal(r.code, 0);
  });

  test('fingerprint <real-change> prints a 64-char hex digest and exits 0', () => {
    const r = run(SPECS_CLI, ['fingerprint', 'nevo-documentation-foundation']);
    assert.equal(r.code, 0);
    assert.match(r.stdout.trim(), /^[0-9a-f]{64}$/);
  });

  test('fingerprint <unknown-change> fails with a clear message', () => {
    const r = run(SPECS_CLI, ['fingerprint', 'does-not-exist']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /not found/);
  });

  test('approve with missing arguments fails with a usage message, no crash', () => {
    const r = run(SPECS_CLI, ['approve']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Usage: specs\.mjs approve/);
  });

  test('approve on an unknown task fails cleanly (no partial write)', () => {
    const r = run(SPECS_CLI, ['approve', 'nevo-documentation-foundation', 'does-not-exist']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /not found/);
  });

  test('unknown command prints usage and exits 1', () => {
    const r = run(SPECS_CLI, ['not-a-real-command']);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /Usage: node tools\/specs\.mjs/);
  });
});

describe('tools/docs.mjs CLI smoke tests', () => {
  test('validate exits 0 on the real repository', () => {
    const r = run(DOCS_CLI, ['validate']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /no errors/);
  });

  test('find --type adr returns known ADR ids', () => {
    const r = run(DOCS_CLI, ['find', '--type', 'adr']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /adr\.0001-conventional-commits/);
  });

  test('unknown command prints usage and exits 1', () => {
    const r = run(DOCS_CLI, ['not-a-real-command']);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /Usage: node tools\/docs\.mjs/);
  });
});
