import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createSpecEventHub, isRelevantSpecPath } from '../server/watcher.mjs';
import { ACTIVE_DIR } from '../../specs/store.mjs';

test('recognizes source files that should trigger a refresh', () => {
  assert.equal(isRelevantSpecPath('sample/change.yaml'), true);
  assert.equal(isRelevantSpecPath('sample/tasks/01-task.md'), true);
  assert.equal(isRelevantSpecPath('sample/reviews/spec.md'), true);
  assert.equal(isRelevantSpecPath('sample/solution-options.md'), true);
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

test('attributes a change to its own repo-relative file path, scoped by active/archive root', async () => {
  const activeRoot = join(tmpdir(), `nevo-dashboard-watch-active-${process.pid}-${Date.now()}`);
  mkdirSync(activeRoot, { recursive: true });
  let callback;
  const hub = createSpecEventHub({
    roots: [activeRoot],
    debounceMs: 1,
    watchFactory: (_root, _options, listener) => {
      callback = listener;
      return { close: () => {} };
    },
  });

  try {
    const received = new Promise(resolvePromise => hub.subscribe(resolvePromise));
    callback('change', 'sample-change\\tasks\\01-x.md');
    const event = await received;
    // No known ROOT_PREFIXES mapping for a custom test root — falls back to
    // the coarse "can't attribute" case (no `files` field) rather than
    // guessing a prefix.
    assert.equal(event.files, undefined);
  } finally {
    hub.close();
    rmSync(activeRoot, { recursive: true, force: true });
  }
});

test('maps a real active-root file name to its repo-relative specs/active/... path', async () => {
  let callback;
  const hub = createSpecEventHub({
    roots: [ACTIVE_DIR],
    debounceMs: 1,
    watchFactory: (_root, _options, listener) => {
      callback = listener;
      return { close: () => {} };
    },
  });

  try {
    const received = new Promise(resolvePromise => hub.subscribe(resolvePromise));
    callback('change', 'dashboard-loading-and-progress/tasks/01-x.md');
    const event = await received;
    assert.deepEqual(event.files, ['specs/active/dashboard-loading-and-progress/tasks/01-x.md']);
  } finally {
    hub.close();
  }
});

test('batches multiple files changed within one debounce window into a single event', async () => {
  const root = join(tmpdir(), `nevo-dashboard-watch-batch-${process.pid}-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  let callback;
  const hub = createSpecEventHub({
    roots: [root],
    debounceMs: 20,
    watchFactory: (_root, _options, listener) => {
      callback = listener;
      return { close: () => {} };
    },
  });

  try {
    const received = new Promise(resolvePromise => hub.subscribe(resolvePromise));
    callback('change', 'sample-change/tasks/01-x.md');
    callback('change', 'sample-change/tasks/02-y.md');
    const event = await received;
    assert.equal(event.type, 'specs-changed');
  } finally {
    hub.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('falls back to the coarse case when fs.watch cannot name the changed file', async () => {
  const root = join(tmpdir(), `nevo-dashboard-watch-null-${process.pid}-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  let callback;
  const hub = createSpecEventHub({
    roots: [root],
    debounceMs: 1,
    watchFactory: (_root, _options, listener) => {
      callback = listener;
      return { close: () => {} };
    },
  });

  try {
    const received = new Promise(resolvePromise => hub.subscribe(resolvePromise));
    callback('change', null);
    const event = await received;
    assert.equal(event.type, 'specs-changed');
    assert.equal(event.files, undefined);
  } finally {
    hub.close();
    rmSync(root, { recursive: true, force: true });
  }
});
