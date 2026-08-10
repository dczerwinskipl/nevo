// Tests for quote-aware verification-command parsing/execution (PR re-review
// packet 05 — `runVerificationCommand` used to split on `/\s+/`, which broke
// any quoted argument containing a space or a filter expression).
// Run: node --test tools/tests/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { splitShellWords } from '../lib/shell-words.mjs';
import { runVerificationCommand } from '../specs.mjs';

describe('splitShellWords', () => {
  test('splits plain whitespace-separated words', () => {
    assert.deepEqual(splitShellWords('node --test tools/tests/batch.test.mjs'), [
      'node', '--test', 'tools/tests/batch.test.mjs',
    ]);
  });

  test('collapses runs of whitespace and trims leading/trailing space', () => {
    assert.deepEqual(splitShellWords('  a   b\tc  '), ['a', 'b', 'c']);
  });

  test('keeps a double-quoted argument with embedded spaces as one word', () => {
    assert.deepEqual(splitShellWords(`node -e "console.log('test value')"`), [
      'node', '-e', "console.log('test value')",
    ]);
  });

  test('keeps a filter expression containing | as one literal word', () => {
    assert.deepEqual(
      splitShellWords('dotnet test --filter "Category=A|Category=B"'),
      ['dotnet', 'test', '--filter', 'Category=A|Category=B']
    );
  });

  test('single-quoted argument with embedded spaces', () => {
    assert.deepEqual(splitShellWords(`npm test -- --test-name-pattern 'batch review'`), [
      'npm', 'test', '--', '--test-name-pattern', 'batch review',
    ]);
  });

  test('empty double/single quotes produce a real empty-string argument, not nothing', () => {
    assert.deepEqual(splitShellWords(`foo "" bar ''`), ['foo', '', 'bar', '']);
  });

  test('backslash escapes the next character outside quotes', () => {
    assert.deepEqual(splitShellWords(String.raw`echo a\ b c`), ['echo', 'a b', 'c']);
  });

  test('\\" and \\\\ escape inside double quotes; other backslashes are literal', () => {
    assert.deepEqual(
      splitShellWords(String.raw`node -e "say \"hi\" and \\slash and \n"`),
      ['node', '-e', 'say "hi" and \\slash and \\n']
    );
  });

  test('single quotes are literal inside a double-quoted span, and vice versa', () => {
    assert.deepEqual(splitShellWords(`echo "it's fine"`), ['echo', "it's fine"]);
    assert.deepEqual(splitShellWords(`echo 'say "hi"'`), ['echo', 'say "hi"']);
  });

  test('unicode arguments pass through unchanged', () => {
    assert.deepEqual(splitShellWords('echo "héllo wörld — 日本語"'), ['echo', 'héllo wörld — 日本語']);
  });

  test('unterminated double quote throws', () => {
    assert.throws(() => splitShellWords('node -e "unterminated'), /Unterminated double quote/);
  });

  test('unterminated single quote throws', () => {
    assert.throws(() => splitShellWords("node -e 'unterminated"), /Unterminated single quote/);
  });
});

describe('runVerificationCommand', () => {
  test('a quoted argument with an embedded space executes exactly as declared', () => {
    const result = runVerificationCommand(`node -e "process.exit(process.argv[1] === 'test value' ? 0 : 7)" "test value"`);
    assert.equal(result.exit_code, 0);
  });

  test('a filter-expression-shaped argument (containing |) reaches the child process intact', () => {
    const result = runVerificationCommand(`node -e "process.exit(process.argv[1] === 'Category=A|Category=B' ? 0 : 7)" "Category=A|Category=B"`);
    assert.equal(result.exit_code, 0);
  });

  test('a non-zero exit code is reported, not thrown', () => {
    const result = runVerificationCommand('node -e "process.exit(3)"');
    assert.equal(result.exit_code, 3);
  });

  test('an unterminated quote is reported as a failed command, not an uncaught throw', () => {
    const result = runVerificationCommand('node -e "unterminated');
    assert.equal(result.exit_code, 1);
    assert.equal(result.command, 'node -e "unterminated');
  });
});
