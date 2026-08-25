import { existsSync, watch } from 'node:fs';

import { ACTIVE_DIR, ARCHIVE_DIR } from '../../specs/store.mjs';

export function isRelevantSpecPath(fileName) {
  if (!fileName) return true;
  const normalized = String(fileName).replace(/\\/g, '/');
  if (/\.generated\./i.test(normalized)) return false;
  return /\.(?:md|ya?ml)$/i.test(normalized);
}

// Repo-relative prefix each watched root's own file names get joined onto,
// so an emitted event's `files` entries match the same `specs/active/<slug>/...`
// shape the manifest/content payloads already use — the frontend can compare
// them directly against a cached document's own `path` field, no separate
// mapping needed.
const ROOT_PREFIXES = new Map([[ACTIVE_DIR, 'specs/active'], [ARCHIVE_DIR, 'specs/archive']]);

export function createSpecEventHub({
  roots = [ACTIVE_DIR, ARCHIVE_DIR],
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

  for (const root of roots) {
    if (!existsSync(root)) continue;
    const prefix = ROOT_PREFIXES.get(root) || null;
    try {
      const watcher = watchFactory(root, { recursive: true }, (eventType, fileName) => {
        if (!isRelevantSpecPath(fileName)) return;
        const normalized = fileName ? String(fileName).replace(/\\/g, '/') : null;
        const file = normalized && prefix ? `${prefix}/${normalized}` : null;
        notify({ eventType, file });
      });
      watchers.push(watcher);
    } catch (error) {
      for (const watcher of watchers.splice(0)) watcher.close?.();
      throw new Error(`Cannot watch specification files under ${root}: ${error.message}`, { cause: error });
    }
  }

  return {
    subscribe(listener) {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    notify,
    close() {
      closed = true;
      clearTimeout(timer);
      for (const watcher of watchers) watcher.close?.();
      subscribers.clear();
    },
  };
}
