// Tests for tools/lib/fs.mjs — path safety and the small directory helpers.
// Run: node --test tools/tests/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { moveDir, resolveWithinBase } from '../lib/fs.mjs';
import { CliError } from '../lib/cli-errors.mjs';

describe('resolveWithinBase', () => {
  // `resolve('/...')` is absolute on both POSIX (as written) and Windows
  // (resolved against the current working directory's drive) — a hardcoded
  // `D:\...` string is not recognized as absolute on POSIX at all, which is
  // exactly what broke this suite on Linux CI while passing on a Windows
  // checkout.
  const base = resolve('/repo-root/specs/active');

  test('resolves an ordinary relative path inside the base directory', () => {
    const resolved = resolveWithinBase(base, 'my-change');
    assert.equal(resolved, join(base, 'my-change'));
  });

  test('resolves a nested relative path inside the base directory', () => {
    const resolved = resolveWithinBase(base, join('my-change', 'tasks', '01-a.md'));
    assert.equal(resolved, join(base, 'my-change', 'tasks', '01-a.md'));
  });

  test('rejects a "../" escape', () => {
    assert.throws(() => resolveWithinBase(base, join('..', '..', 'etc')), CliError);
  });

  test('rejects a path that escapes into a sibling directory', () => {
    assert.throws(() => resolveWithinBase(base, join('..', 'archive', 'x')), CliError);
  });

  test('allows a path that dot-dots out and back into the same base directory', () => {
    const resolved = resolveWithinBase(base, join('..', 'active', 'x'));
    assert.equal(resolved, join(base, 'x'));
  });

  test('rejects an absolute path outside the base directory', () => {
    assert.throws(() => resolveWithinBase(base, resolve('/definitely-outside/dir')), CliError);
  });

  test('the thrown error names the offending path', () => {
    assert.throws(() => resolveWithinBase(base, '../../etc/passwd'), (err) => {
      assert.match(err.message, /\.\.\/\.\.\/etc\/passwd/);
      return true;
    });
  });
});

function moveFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'nevo-move-dir-'));
  const source = join(root, 'active', 'change');
  const destination = join(root, 'archive', 'change');
  mkdirSync(source, { recursive: true });
  mkdirSync(join(root, 'archive'), { recursive: true });
  writeFileSync(join(source, 'change.yaml'), 'status: implemented\n');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, source, destination };
}

function recoverableRename(code, source, destination) {
  return (from, to) => {
    if (from === source && to === destination) {
      const error = new Error(`simulated ${code}`);
      error.code = code;
      throw error;
    }
    renameSync(from, to);
  };
}

describe('moveDir', () => {
  test('uses atomic rename as the normal path', t => {
    const { source, destination } = moveFixture(t);
    let calls = 0;

    moveDir(source, destination, { renameSync(from, to) { calls += 1; renameSync(from, to); } });

    assert.equal(calls, 1);
    assert.equal(existsSync(source), false);
    assert.equal(readFileSync(join(destination, 'change.yaml'), 'utf8'), 'status: implemented\n');
  });

  for (const code of ['EPERM', 'EXDEV']) {
    test(`falls back through a staged copy for ${code}`, t => {
      const { source, destination } = moveFixture(t);

      moveDir(source, destination, { renameSync: recoverableRename(code, source, destination) });

      assert.equal(existsSync(source), false);
      assert.equal(readFileSync(join(destination, 'change.yaml'), 'utf8'), 'status: implemented\n');
    });
  }

  test('source cleanup failure leaves no completed archive and remains retryable', t => {
    const { root, source, destination } = moveFixture(t);
    const temporaryPath = join(root, 'archive', '.change-staged');
    const cleanupFailure = new Error('simulated source cleanup failure');
    cleanupFailure.code = 'EACCES';

    assert.throws(() => moveDir(source, destination, {
      renameSync: recoverableRename('EPERM', source, destination),
      temporaryPath,
      rmSync(path, options) {
        if (path === source) throw cleanupFailure;
        rmSync(path, options);
      },
    }), error => error.code === 'ARCHIVE_SOURCE_CLEANUP_FAILED' && error.cause === cleanupFailure);
    assert.equal(existsSync(source), true);
    assert.equal(existsSync(destination), false);
    assert.equal(existsSync(temporaryPath), false);

    moveDir(source, destination);
    assert.equal(existsSync(source), false);
    assert.equal(existsSync(destination), true);
  });

  test('fails closed when the final destination already exists', t => {
    const { source, destination } = moveFixture(t);
    mkdirSync(destination, { recursive: true });
    writeFileSync(join(destination, 'existing.txt'), 'authoritative');

    assert.throws(() => moveDir(source, destination), error => error.code === 'EEXIST');
    assert.equal(existsSync(source), true);
    assert.equal(readFileSync(join(destination, 'existing.txt'), 'utf8'), 'authoritative');
  });

  test('does not swallow unrelated rename failures', t => {
    const { source, destination } = moveFixture(t);
    const failure = new Error('simulated I/O failure');
    failure.code = 'EIO';

    assert.throws(() => moveDir(source, destination, { renameSync() { throw failure; } }), error => error === failure);
    assert.equal(existsSync(source), true);
    assert.equal(existsSync(destination), false);
  });
});
