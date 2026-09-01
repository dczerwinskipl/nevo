import type { AgentExecutionMode } from '../types.ts';

export interface PendingInitialDispatch {
  sessionKey: string; // `${provider}:${sessionId}`
  prompt: string;
  /** Clean, user-typed text alone (no Nevo-injected context) — the chat-bubble source. */
  displayMessage: string;
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
  setPending(provider: string, sessionId: string, prompt: string, userMessage?: string): PendingInitialDispatch {
    const trimmed = prompt.trim();
    const trimmedDisplay = (userMessage ?? prompt).trim() || trimmed;
    const sessionKey = `${provider}:${sessionId}`;
    const existing = this.getPending(provider, sessionId);

    // Reuse existing idempotency key if same prompt is already pending
    const idempotencyKey = existing?.prompt === trimmed && existing.idempotencyKey
      ? existing.idempotencyKey
      : generateIdempotencyKey();

    const record: PendingInitialDispatch = {
      sessionKey,
      prompt: trimmed,
      displayMessage: trimmedDisplay,
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

export interface InitialDispatchAssistant {
  isReady: boolean;
  sendTurn: (
    prompt: string,
    opts?: { mode?: AgentExecutionMode; idempotencyKey?: string; userMessage?: string },
  ) => Promise<unknown>;
}

export interface UseInitialDispatchOptions {
  provider: string;
  sessionId: string;
  assistant: InitialDispatchAssistant;
  isProviderAvailable: boolean;
  currentMode: AgentExecutionMode;
  onBeforeDispatch?: () => void;
}

export interface InitialDispatchState {
  pendingDispatch: PendingInitialDispatch | null;
  failedInitialDispatch: PendingInitialDispatch | null;
  displayError: string | null;
  canRetryInitial: boolean;
  isInitialDispatchInFlight: boolean;
  handleRetryInitial: () => Promise<boolean>;
  handleDismissError: () => void;
}

/**
 * Single consolidated production controller for initial prompt dispatch lifecycle.
 * Used directly in unit tests and consumed via useInitialDispatch in React components.
 */
export class InitialDispatchController {
  public provider: string;
  public sessionId: string;
  public assistant: InitialDispatchAssistant;
  public isProviderAvailable: boolean;
  public currentMode: AgentExecutionMode;
  public onBeforeDispatch?: () => void;
  private transientError: string | null = null;
  private listeners = new Set<() => void>();

  constructor(options: UseInitialDispatchOptions) {
    this.provider = options.provider;
    this.sessionId = options.sessionId;
    this.assistant = options.assistant;
    this.isProviderAvailable = options.isProviderAvailable;
    this.currentMode = options.currentMode;
    this.onBeforeDispatch = options.onBeforeDispatch;
  }

  updateOptions(options: Partial<UseInitialDispatchOptions>): void {
    if (options.provider !== undefined) this.provider = options.provider;
    if (options.sessionId !== undefined) this.sessionId = options.sessionId;
    if (options.assistant !== undefined) this.assistant = options.assistant;
    if (options.isProviderAvailable !== undefined) this.isProviderAvailable = options.isProviderAvailable;
    if (options.currentMode !== undefined) this.currentMode = options.currentMode;
    if (options.onBeforeDispatch !== undefined) this.onBeforeDispatch = options.onBeforeDispatch;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  get pending(): PendingInitialDispatch | null {
    return pendingDispatchStore.getPending(this.provider, this.sessionId);
  }

  get failedInitialDispatch(): PendingInitialDispatch | null {
    const p = this.pending;
    return p?.status === 'failed' ? p : null;
  }

  get isInitialDispatchInFlight(): boolean {
    return this.pending?.status === 'in-flight';
  }

  get displayError(): string | null {
    return this.transientError || this.failedInitialDispatch?.error || null;
  }

  get canRetryInitial(): boolean {
    return Boolean(this.failedInitialDispatch);
  }

  setTransientError(error: string | null): void {
    this.transientError = error;
    this.notify();
  }

  async handleRetryInitial(): Promise<boolean> {
    const retried = pendingDispatchStore.retryPending(this.provider, this.sessionId);
    if (retried) {
      this.transientError = null;
      this.onBeforeDispatch?.();
      this.notify();
      return this.checkAndDispatch();
    }
    return false;
  }

  handleDismissError(): void {
    this.transientError = null;
    if (this.pending?.status === 'failed') {
      pendingDispatchStore.clearPending(this.provider, this.sessionId);
    }
    this.notify();
  }

  async checkAndDispatch(): Promise<boolean> {
    if (!this.isProviderAvailable || !this.assistant.isReady) return false;
    const pending = pendingDispatchStore.getPending(this.provider, this.sessionId);
    if (!pending || pending.status !== 'pending') return false;

    this.onBeforeDispatch?.();
    pendingDispatchStore.markInFlight(this.provider, this.sessionId);
    this.transientError = null;
    this.notify();

    try {
      await this.assistant.sendTurn(pending.prompt, {
        mode: this.currentMode,
        idempotencyKey: pending.idempotencyKey,
        userMessage: pending.displayMessage,
      });
      pendingDispatchStore.clearPending(this.provider, this.sessionId);
      this.notify();
      return true;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      pendingDispatchStore.markFailed(this.provider, this.sessionId, errorMsg);
      this.notify();
      return false;
    }
  }

  async runDispatch(): Promise<boolean> {
    return this.checkAndDispatch();
  }
}
