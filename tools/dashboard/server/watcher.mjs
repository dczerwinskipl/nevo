import { existsSync, watch } from 'node:fs';

import { ACTIVE_DIR, ARCHIVE_DIR } from '../../specs/service.mjs';

export function isRelevantSpecPath(fileName) {
  if (!fileName) return true;
  const normalized = String(fileName).replace(/\\/g, '/');
  return /(?:^|\/)(?:change\.ya?ml|overview\.md|owner-decisions\.md|follow-ups\.ya?ml|tasks\/.*\.md|areas\/.*\.md)$/i.test(normalized);
}

export function createSpecEventHub({
  roots = [ACTIVE_DIR, ARCHIVE_DIR],
  watchFactory = watch,
  debounceMs = 80,
} = {}) {
  const subscribers = new Set();
  const watchers = [];
  let timer = null;
  let closed = false;

  const notify = detail => {
    if (closed) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const event = { type: 'specs-changed', at: new Date().toISOString(), ...detail };
      for (const subscriber of subscribers) subscriber(event);
    }, debounceMs);
  };

  for (const root of roots) {
    if (!existsSync(root)) continue;
    try {
      const watcher = watchFactory(root, { recursive: true }, (eventType, fileName) => {
        if (isRelevantSpecPath(fileName)) notify({ eventType });
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
