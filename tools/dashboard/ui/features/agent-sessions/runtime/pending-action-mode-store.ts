/**
 * A one-shot, explicit, inspectable navigation intent for entering a composer action mode
 * (currently only `request-changes`) immediately after navigating into a session — e.g.
 * clicking a task card's "Request changes" button. Deliberately not a hidden global
 * mutable flag: it is keyed by canonical `sessionId`, carries a typed payload, and is
 * consumed (deleted) exactly once by the chat surface that reads it, so a page reload or
 * an unrelated later navigation into the same session never re-opens the mode.
 */
export interface PendingActionModeIntent {
  action: 'request-changes';
  taskId: string;
}

const STORAGE_PREFIX = 'nevo:pending-action-mode:';
const memoryStore = new Map<string, PendingActionModeIntent>();

function loadFromStorage(sessionId: string): PendingActionModeIntent | null {
  try {
    if (typeof sessionStorage !== 'undefined') {
      const raw = sessionStorage.getItem(`${STORAGE_PREFIX}${sessionId}`);
      if (raw) return JSON.parse(raw) as PendingActionModeIntent;
    }
  } catch {}
  return null;
}

function saveToStorage(sessionId: string, intent: PendingActionModeIntent): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(`${STORAGE_PREFIX}${sessionId}`, JSON.stringify(intent));
    }
  } catch {}
}

function removeFromStorage(sessionId: string): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(`${STORAGE_PREFIX}${sessionId}`);
    }
  } catch {}
}

export const pendingActionModeStore = {
  setPending(sessionId: string, intent: PendingActionModeIntent): void {
    memoryStore.set(sessionId, intent);
    saveToStorage(sessionId, intent);
  },

  /** Reads and immediately clears the pending intent for `sessionId` — consume-once. */
  takePending(sessionId: string): PendingActionModeIntent | null {
    let intent = memoryStore.get(sessionId) ?? null;
    if (!intent) intent = loadFromStorage(sessionId);
    memoryStore.delete(sessionId);
    removeFromStorage(sessionId);
    return intent;
  },

  clearAll(): void {
    memoryStore.clear();
  },
};
