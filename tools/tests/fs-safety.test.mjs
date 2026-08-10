// Tests for tools/lib/fs.mjs — path safety and the small directory helpers.
// Run: node --test tools/tests/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';

import { resolveWithinBase } from '../lib/fs.mjs';
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
