import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { TERMINAL_STATUSES as VOCAB_TERMINAL_STATUSES } from '../specs/status-vocabulary.mjs';
import { TERMINAL_STATUSES as PRIMITIVE_TERMINAL_STATUSES } from '../specs/lifecycle-primitives.mjs';

describe('status-vocabulary — extracted terminal statuses (D8)', () => {
  test('status-vocabulary.mjs exports TERMINAL_STATUSES with the exact four canonical values', () => {
    assert.ok(VOCAB_TERMINAL_STATUSES instanceof Set);
    assert.equal(VOCAB_TERMINAL_STATUSES.size, 4);
    assert.ok(VOCAB_TERMINAL_STATUSES.has('implemented'));
    assert.ok(VOCAB_TERMINAL_STATUSES.has('verified'));
    assert.ok(VOCAB_TERMINAL_STATUSES.has('archived'));
    assert.ok(VOCAB_TERMINAL_STATUSES.has('abandoned'));
  });

  test('lifecycle-primitives.mjs re-exports the identical TERMINAL_STATUSES instance', () => {
    assert.equal(PRIMITIVE_TERMINAL_STATUSES, VOCAB_TERMINAL_STATUSES);
  });

  test('finish-operation.mjs imports TERMINAL_STATUSES from status-vocabulary.mjs', () => {
    const content = readFileSync(new URL('../specs/workflow/finish-operation.mjs', import.meta.url), 'utf8');
    assert.match(content, /from\s+['"]\.\.\/status-vocabulary\.mjs['"]/);
    assert.doesNotMatch(content, /from\s+['"]\.\.\/lifecycle-primitives\.mjs['"]/);
  });

  test('definitions/schema.mjs imports TERMINAL_STATUSES from status-vocabulary.mjs', () => {
    const content = readFileSync(new URL('../specs/workflow/definitions/schema.mjs', import.meta.url), 'utf8');
    assert.match(content, /from\s+['"]\.\.\/\.\.\/status-vocabulary\.mjs['"]/);
    assert.doesNotMatch(content, /from\s+['"]\.\.\/\.\.\/lifecycle-primitives\.mjs['"]/);
  });

  test('discriminateTarget in finish-operation correctly discriminates terminal vs internal step using status-vocabulary', async () => {
    const { discriminateTarget } = await import('../specs/workflow/finish-operation.mjs');
    const definition = { steps: { implementation: {}, review: {} } };

    assert.deepEqual(discriminateTarget('verified', definition), { kind: 'terminal', status: 'verified' });
    assert.deepEqual(discriminateTarget('implemented', definition), { kind: 'terminal', status: 'implemented' });
    assert.deepEqual(discriminateTarget('archived', definition), { kind: 'terminal', status: 'archived' });
    assert.deepEqual(discriminateTarget('abandoned', definition), { kind: 'terminal', status: 'abandoned' });
    assert.deepEqual(discriminateTarget('review', definition), { kind: 'step', step: 'review' });
  });

  test('zero files in tools/specs/workflow/** import lifecycle-primitives', () => {
    const workflowDir = new URL('../specs/workflow', import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, '$1');

    function scanDir(dir) {
      const files = [];
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          files.push(...scanDir(full));
        } else if (entry.endsWith('.mjs') || entry.endsWith('.js')) {
          files.push(full);
        }
      }
      return files;
    }

    const allFiles = scanDir(workflowDir);
    for (const file of allFiles) {
      const content = readFileSync(file, 'utf8');
      assert.doesNotMatch(
        content,
        /lifecycle-primitives/,
        `File '${file}' must not import or reference 'lifecycle-primitives'`
      );
    }
  });
});
