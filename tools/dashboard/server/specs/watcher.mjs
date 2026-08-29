import { relative } from 'node:path';
import { watch } from 'chokidar';

export function isRelevantSpecPath(fileName) {
  if (!fileName) return true;
  const normalized = String(fileName).replace(/\\/g, '/');
  if (/\.generated\./i.test(normalized)) return false;
  return /\.(?:md|ya?ml)$/i.test(normalized);
}

/**
 * The Specs change watcher: watches an explicit set of `{ path, prefix }`
 * roots and publishes a single debounced `specs-changed` domain event per
 * batch of relevant file changes. Recursive directory watching, path
 * normalization, and add/change/unlink interpretation are chokidar's job (a
 * missing root directory is a graceful no-op, not an error) — this module
 * only owns which paths are relevant, how changes are grouped/debounced,
 * and what domain event comes out the other end.
 *
 * `roots` are passed explicitly by the caller (see specs/events.mjs) —
 * this module has no opinion on where specs actually live or what a
 * "specs/active"-shaped prefix means; it just watches what it's told.
 */
export function createSpecChangeWatcher({
  roots = [],
  watchFactory = watch,
  debounceMs = 80,
} = {}) {
  const subscribers = new Set();
  const watchers = [];
  let timer = null;
  let closed = false;
  let pendingEventType = null;
  let pendingFiles = new Set();
  // Coarse fallback (area doc: "keep the existing coarse behavior as a
  // fallback if a change can't be attributed to specific files") — becomes
  // true whenever a change in this debounce window has no attributable file.
  let pendingUnattributed = false;

  const notify = detail => {
    if (closed) return;
    pendingEventType = detail?.eventType ?? pendingEventType;
    if (detail?.file) pendingFiles.add(detail.file);
    else pendingUnattributed = true;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const files = !pendingUnattributed && pendingFiles.size ? [...pendingFiles] : undefined;
      const event = {
        type: 'specs-changed',
        at: new Date().toISOString(),
        eventType: pendingEventType,
        ...(files ? { files } : {}),
      };
      pendingEventType = null;
      pendingFiles = new Set();
      pendingUnattributed = false;
      for (const subscriber of subscribers) subscriber(event);
    }, debounceMs);
  };

  for (const { path: root, prefix } of roots) {
    const watcher = watchFactory(root, { ignoreInitial: true });
    watcher.on('all', (eventType, filePath) => {
      const fileName = filePath ? relative(root, filePath).replace(/\\/g, '/') : null;
      if (!isRelevantSpecPath(fileName)) return;
      notify({ eventType, file: fileName && prefix ? `${prefix}/${fileName}` : null });
    });
    watcher.on('error', error => {
      console.error(`[server] error watching specification files under ${root}:`, error);
    });
    watchers.push(watcher);
  }

  return {
    subscribe(listener) {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    notify,
    // chokidar's own close() is asynchronous — awaiting it (and awaiting all
    // watchers concurrently) is what lets the owning Fastify onClose hook
    // guarantee filesystem watchers are fully closed before it resolves,
    // rather than fire-and-forget cleanup that outlives app.close().
    async close() {
      closed = true;
      clearTimeout(timer);
      subscribers.clear();
      await Promise.all(watchers.map(watcher => watcher.close?.()));
    },
  };
}
