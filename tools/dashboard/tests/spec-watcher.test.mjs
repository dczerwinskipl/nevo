import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { createSpecChangeWatcher, isRelevantSpecPath } from '../server/specs/watcher.mjs';

// A minimal chokidar-shaped fake: `.on('all', (eventType, absolutePath) =>
// ...)` plus an asynchronous `.close()` (chokidar's own close() returns a
// Promise) — chokidar itself owns recursive watching, path normalization,
// and add/change/unlink interpretation, so these tests only need to prove
// the Nevo-specific layer built on top of it (relevance filtering,
// debouncing, domain event shape, and awaited shutdown).
function fakeWatcher() {
  const emitter = new EventEmitter();
  let closed = false;
  return {
    on: (event, handler) => emitter.on(event, handler),
    emitAll: (eventType, absolutePath) => emitter.emit('all', eventType, absolutePath),
    // Resolves on a microtask, like chokidar's own close() (a real Promise,
    // never synchronous) — but without an artificial macrotask delay, so
    // tests that don't care about timing can await it in a couple of ticks.
    close: () =>
      Promise.resolve().then(() => {
        closed = true;
      }),
    get closed() {
      return closed;
    },
  };
}

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
  let watcher;
  const hub = createSpecChangeWatcher({
    roots: [{ path: root, prefix: 'specs/active' }],
    debounceMs: 1,
    watchFactory: () => {
      watcher = fakeWatcher();
      return watcher;
    },
  });

  try {
    const received = new Promise((resolvePromise) => hub.subscribe(resolvePromise));
    watcher.emitAll('change', join(root, 'sample', 'overview.md'));
    const event = await received;
    assert.equal(event.type, 'specs-changed');
    assert.equal(event.eventType, 'change');
  } finally {
    await hub.close();
    rmSync(root, { recursive: true, force: true });
  }
  assert.equal(watcher.closed, true);
});

test('a root with no prefix supplied omits the files field rather than guessing one', async () => {
  const activeRoot = join(tmpdir(), `nevo-dashboard-watch-active-${process.pid}-${Date.now()}`);
  mkdirSync(activeRoot, { recursive: true });
  let watcher;
  const hub = createSpecChangeWatcher({
    // No `prefix` — the watcher never infers one; a root without a supplied
    // prefix means the caller genuinely doesn't want files attributed.
    roots: [{ path: activeRoot }],
    debounceMs: 1,
    watchFactory: () => {
      watcher = fakeWatcher();
      return watcher;
    },
  });

  try {
    const received = new Promise((resolvePromise) => hub.subscribe(resolvePromise));
    watcher.emitAll('change', join(activeRoot, 'sample-change', 'tasks', '01-x.md'));
    const event = await received;
    assert.equal(event.files, undefined);
  } finally {
    await hub.close();
    rmSync(activeRoot, { recursive: true, force: true });
  }
});

test('maps a changed file to its caller-supplied prefix, not a global constant lookup', async () => {
  const activeRoot = join(tmpdir(), `nevo-dashboard-watch-prefix-${process.pid}-${Date.now()}`);
  mkdirSync(activeRoot, { recursive: true });
  let watcher;
  const hub = createSpecChangeWatcher({
    roots: [{ path: activeRoot, prefix: 'specs/active' }],
    debounceMs: 1,
    watchFactory: () => {
      watcher = fakeWatcher();
      return watcher;
    },
  });

  try {
    const received = new Promise((resolvePromise) => hub.subscribe(resolvePromise));
    watcher.emitAll('change', join(activeRoot, 'dashboard-loading-and-progress', 'tasks', '01-x.md'));
    const event = await received;
    assert.deepEqual(event.files, ['specs/active/dashboard-loading-and-progress/tasks/01-x.md']);
  } finally {
    await hub.close();
    rmSync(activeRoot, { recursive: true, force: true });
  }
});

test('a differently-configured root (e.g. a custom archive directory) uses its own supplied prefix', async () => {
  const archiveRoot = join(tmpdir(), `nevo-dashboard-watch-archive-${process.pid}-${Date.now()}`);
  mkdirSync(archiveRoot, { recursive: true });
  let watcher;
  const hub = createSpecChangeWatcher({
    roots: [{ path: archiveRoot, prefix: 'specs/archive' }],
    debounceMs: 1,
    watchFactory: () => {
      watcher = fakeWatcher();
      return watcher;
    },
  });

  try {
    const received = new Promise((resolvePromise) => hub.subscribe(resolvePromise));
    watcher.emitAll('change', join(archiveRoot, 'old-change', 'overview.md'));
    const event = await received;
    assert.deepEqual(event.files, ['specs/archive/old-change/overview.md']);
  } finally {
    await hub.close();
    rmSync(archiveRoot, { recursive: true, force: true });
  }
});

test('batches multiple files changed within one debounce window into a single event', async () => {
  const root = join(tmpdir(), `nevo-dashboard-watch-batch-${process.pid}-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  let watcher;
  const hub = createSpecChangeWatcher({
    roots: [{ path: root, prefix: 'specs/active' }],
    debounceMs: 20,
    watchFactory: () => {
      watcher = fakeWatcher();
      return watcher;
    },
  });

  try {
    const received = new Promise((resolvePromise) => hub.subscribe(resolvePromise));
    watcher.emitAll('change', join(root, 'sample-change', 'tasks', '01-x.md'));
    watcher.emitAll('change', join(root, 'sample-change', 'tasks', '02-y.md'));
    const event = await received;
    assert.equal(event.type, 'specs-changed');
  } finally {
    await hub.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('falls back to the coarse case when the watcher cannot name the changed file', async () => {
  const root = join(tmpdir(), `nevo-dashboard-watch-null-${process.pid}-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  let watcher;
  const hub = createSpecChangeWatcher({
    roots: [{ path: root, prefix: 'specs/active' }],
    debounceMs: 1,
    watchFactory: () => {
      watcher = fakeWatcher();
      return watcher;
    },
  });

  try {
    const received = new Promise((resolvePromise) => hub.subscribe(resolvePromise));
    watcher.emitAll('change', null);
    const event = await received;
    assert.equal(event.type, 'specs-changed');
    assert.equal(event.files, undefined);
  } finally {
    await hub.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('close() awaits every underlying watcher close() — shutdown does not resolve early', async () => {
  const rootA = join(tmpdir(), `nevo-dashboard-watch-close-a-${process.pid}-${Date.now()}`);
  const rootB = join(tmpdir(), `nevo-dashboard-watch-close-b-${process.pid}-${Date.now()}`);
  mkdirSync(rootA, { recursive: true });
  mkdirSync(rootB, { recursive: true });

  // A controllable close(): the watcher's own close() must not resolve
  // until this fake's close() promise resolves, proving close() is awaited
  // end-to-end rather than fire-and-forget (`watcher.close?.()` with no
  // `await`, which would let close() return before the filesystem watcher
  // actually finished closing).
  let resolveUnderlyingClose;
  const controlledCloseWatcher = {
    on: () => {},
    close: () =>
      new Promise((resolve) => {
        resolveUnderlyingClose = resolve;
      }),
  };
  const immediateWatcher = fakeWatcher();

  const watcherFactories = [() => controlledCloseWatcher, () => immediateWatcher];
  let callIndex = 0;
  const hub = createSpecChangeWatcher({
    roots: [
      { path: rootA, prefix: 'specs/active' },
      { path: rootB, prefix: 'specs/archive' },
    ],
    watchFactory: () => watcherFactories[callIndex++](),
  });

  try {
    let closeResolved = false;
    const closePromise = hub.close().then(() => {
      closeResolved = true;
    });

    // Give the event loop a couple of ticks — close() must still be pending
    // because controlledCloseWatcher's own close() hasn't resolved yet.
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(closeResolved, false, 'watcher shutdown resolved before an underlying chokidar close() settled');
    assert.equal(immediateWatcher.closed, true, 'the other watcher was still closed independently');

    resolveUnderlyingClose();
    await closePromise;
    assert.equal(closeResolved, true, 'watcher shutdown resolved once every underlying close() settled');
  } finally {
    rmSync(rootA, { recursive: true, force: true });
    rmSync(rootB, { recursive: true, force: true });
  }
});
