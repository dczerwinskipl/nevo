// CLI-level smoke tests for tools/specs.mjs and tools/docs.mjs — the important
// success/failure paths, run as real spawned processes (unlike the pure-function
// tests elsewhere in this directory). Deliberately read-only: these run against the
// real repository state, so only non-mutating commands (validate/list/check/
// fingerprint/find) and usage-error paths are exercised here. The mutating transition
// logic (approve/start/complete/verify) is covered exhaustively as pure functions in
// task-lifecycle.test.mjs instead of by spawning a process against real spec files.
//
// Error/usage output now comes from Commander and is consistently written to
// stderr with exit code 1 — a deliberate, documented change from the previous
// hand-rolled CLI, which inconsistently mixed stdout and stderr for usage text.
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

  test('check exits 0 when generated indexes are current', () => {
    const r = run(SPECS_CLI, ['check']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /current/);
  });

  test('fingerprint <real-change> prints a 64-char hex digest and exits 0', () => {
    const r = run(SPECS_CLI, ['fingerprint', 'nevo-documentation-foundation']);
    assert.equal(r.code, 0);
    assert.match(r.stdout.trim(), /^[0-9a-f]{64}$/);
  });

  test('fingerprint <unknown-change> fails on stderr with a clear message', () => {
    const r = run(SPECS_CLI, ['fingerprint', 'does-not-exist']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /not found/);
  });

  test('fingerprint <path-traversal> is rejected, never escapes specs/active/', () => {
    const r = run(SPECS_CLI, ['fingerprint', '../../etc']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /escapes|not found/i);
  });

  test('approve with missing arguments fails on stderr with a usage message, no crash', () => {
    const r = run(SPECS_CLI, ['approve']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /missing required argument/);
  });

  test('approve on an unknown task fails cleanly on stderr (no partial write)', () => {
    const r = run(SPECS_CLI, ['approve', 'nevo-documentation-foundation', 'does-not-exist']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /not found/);
  });

  test('unknown command fails on stderr and exits 1', () => {
    const r = run(SPECS_CLI, ['not-a-real-command']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /unknown command/);
  });

  test('no command prints help on stderr and exits 1', () => {
    const r = run(SPECS_CLI, []);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Usage: node tools\/specs\.mjs/);
  });
});

describe('tools/docs.mjs CLI smoke tests', () => {
  test('validate exits 0 on the real repository', () => {
    const r = run(DOCS_CLI, ['validate']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /no errors/);
  });

  test('check exits 0 when the generated index is current', () => {
    const r = run(DOCS_CLI, ['check']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /current/);
  });

  test('find --type adr returns known ADR ids', () => {
    const r = run(DOCS_CLI, ['find', '--type', 'adr']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /adr\.0001-conventional-commits/);
  });

  test('find --format json returns valid, filtered JSON', () => {
    const r = run(DOCS_CLI, ['find', '--type', 'adr', '--format', 'json']);
    assert.equal(r.code, 0);
    const results = JSON.parse(r.stdout);
    assert.ok(Array.isArray(results));
    assert.ok(results.length > 0);
    assert.ok(results.every((d) => d.type === 'adr'));
  });

  test('unknown command fails on stderr and exits 1', () => {
    const r = run(DOCS_CLI, ['not-a-real-command']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /unknown command/);
  });
});
