export interface PendingInitialDispatch {
  sessionKey: string; // `${provider}:${sessionId}`
  prompt: string;
  idempotencyKey: string;
  createdAt: number;
  status: 'pending' | 'in-flight' | 'failed' | 'completed';
  error?: string | null;
}

const STORAGE_PREFIX = 'nevo:pending-dispatch:';
const memoryStore = new Map<string, PendingInitialDispatch>();

function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `turn_${crypto.randomUUID()}`;
  }
  return `turn_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function loadFromStorage(sessionKey: string): PendingInitialDispatch | null {
  try {
    if (typeof sessionStorage !== 'undefined') {
      const raw = sessionStorage.getItem(`${STORAGE_PREFIX}${sessionKey}`);
      if (raw) {
        return JSON.parse(raw) as PendingInitialDispatch;
      }
    }
  } catch {}
  return null;
}

function saveToStorage(dispatch: PendingInitialDispatch): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(`${STORAGE_PREFIX}${dispatch.sessionKey}`, JSON.stringify(dispatch));
    }
  } catch {}
}

function removeFromStorage(sessionKey: string): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(`${STORAGE_PREFIX}${sessionKey}`);
    }
  } catch {}
}

export const pendingDispatchStore = {
  setPending(provider: string, sessionId: string, prompt: string): PendingInitialDispatch {
    const trimmed = prompt.trim();
    const sessionKey = `${provider}:${sessionId}`;
    const existing = this.getPending(provider, sessionId);

    // Reuse existing idempotency key if same prompt is already pending
    const idempotencyKey = existing?.prompt === trimmed && existing.idempotencyKey
      ? existing.idempotencyKey
      : generateIdempotencyKey();

    const record: PendingInitialDispatch = {
      sessionKey,
      prompt: trimmed,
      idempotencyKey,
      createdAt: existing?.createdAt || Date.now(),
      status: 'pending',
      error: null,
    };

    memoryStore.set(sessionKey, record);
    saveToStorage(record);
    return record;
  },

  getPending(provider: string, sessionId: string): PendingInitialDispatch | null {
    const sessionKey = `${provider}:${sessionId}`;
    let record = memoryStore.get(sessionKey);
    if (!record) {
      const fromDisk = loadFromStorage(sessionKey);
      if (fromDisk) {
        // If a previous runtime persisted 'in-flight' and the page was reloaded/crashed,
        // recover it to 'pending' so it can safely be dispatched/retried.
        if (fromDisk.status === 'in-flight') {
          fromDisk.status = 'pending';
          fromDisk.error = null;
          saveToStorage(fromDisk);
        }
        memoryStore.set(sessionKey, fromDisk);
        record = fromDisk;
      }
    }
    return record ?? null;
  },

  markInFlight(provider: string, sessionId: string): PendingInitialDispatch | null {
    const record = this.getPending(provider, sessionId);
    if (record) {
      record.status = 'in-flight';
      memoryStore.set(record.sessionKey, record);
      saveToStorage(record);
      return record;
    }
    return null;
  },

  markFailed(provider: string, sessionId: string, error: string): PendingInitialDispatch | null {
    const record = this.getPending(provider, sessionId);
    if (record) {
      record.status = 'failed';
      record.error = error;
      memoryStore.set(record.sessionKey, record);
      saveToStorage(record);
      return record;
    }
    return null;
  },

  retryPending(provider: string, sessionId: string): PendingInitialDispatch | null {
    const record = this.getPending(provider, sessionId);
    if (record && (record.status === 'failed' || record.status === 'in-flight')) {
      record.status = 'pending';
      record.error = null;
      memoryStore.set(record.sessionKey, record);
      saveToStorage(record);
      return record;
    }
    return record ?? null;
  },

  clearPending(provider: string, sessionId: string): void {
    const sessionKey = `${provider}:${sessionId}`;
    memoryStore.delete(sessionKey);
    removeFromStorage(sessionKey);
  },

  clearAll(): void {
    memoryStore.clear();
  },
};
