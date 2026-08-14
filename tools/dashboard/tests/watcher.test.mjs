import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createSpecEventHub, isRelevantSpecPath } from '../server/watcher.mjs';

test('recognizes source files that should trigger a refresh', () => {
  assert.equal(isRelevantSpecPath('sample/change.yaml'), true);
  assert.equal(isRelevantSpecPath('sample/tasks/01-task.md'), true);
  assert.equal(isRelevantSpecPath('sample/reviews/spec.md'), false);
  assert.equal(isRelevantSpecPath('active.generated.md'), false);
});

test('notifies subscribers when a relevant file changes', async () => {
  const root = join(tmpdir(), `nevo-dashboard-watch-${process.pid}-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  let callback;
  let closed = false;
  const hub = createSpecEventHub({
    roots: [root],
    debounceMs: 1,
    watchFactory: (_root, _options, listener) => {
      callback = listener;
      return { close: () => { closed = true; } };
    },
  });

  try {
    const received = new Promise(resolvePromise => hub.subscribe(resolvePromise));
    callback('change', 'sample/overview.md');
    const event = await received;
    assert.equal(event.type, 'specs-changed');
    assert.equal(event.eventType, 'change');
  } finally {
    hub.close();
    rmSync(root, { recursive: true, force: true });
  }
  assert.equal(closed, true);
});
