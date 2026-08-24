import { useState, useCallback, useEffect } from 'react';
import { pendingDispatchStore, type PendingInitialDispatch } from './pending-dispatch-store.ts';
import type { AgentExecutionMode } from './types.ts';

export interface InitialDispatchAssistant {
  isReady: boolean;
  sendTurn: (prompt: string, opts?: { mode?: AgentExecutionMode; idempotencyKey?: string }) => Promise<unknown>;
}

export interface UseInitialDispatchOptions {
  provider: string;
  sessionId: string;
  assistant: InitialDispatchAssistant;
  isProviderAvailable: boolean;
  currentMode: AgentExecutionMode;
}

export interface InitialDispatchState {
  pendingDispatch: PendingInitialDispatch | null;
  failedInitialDispatch: PendingInitialDispatch | null;
  displayError: string | null;
  canRetryInitial: boolean;
  isInitialDispatchInFlight: boolean;
  handleRetryInitial: () => void;
  handleDismissError: () => void;
  setSubmissionError: (err: string | null) => void;
}

/**
 * Pure production controller for initial prompt dispatch lifecycle.
 * Fully testable in non-DOM test environments.
 */
export class InitialDispatchController {
  public provider: string;
  public sessionId: string;
  public assistant: InitialDispatchAssistant;
  public isProviderAvailable: boolean;
  public currentMode: AgentExecutionMode;
  private transientError: string | null = null;
  private listeners = new Set<() => void>();

  constructor(options: UseInitialDispatchOptions) {
    this.provider = options.provider;
    this.sessionId = options.sessionId;
    this.assistant = options.assistant;
    this.isProviderAvailable = options.isProviderAvailable;
    this.currentMode = options.currentMode;
  }

  updateOptions(options: Partial<UseInitialDispatchOptions>): void {
    if (options.provider !== undefined) this.provider = options.provider;
    if (options.sessionId !== undefined) this.sessionId = options.sessionId;
    if (options.assistant !== undefined) this.assistant = options.assistant;
    if (options.isProviderAvailable !== undefined) this.isProviderAvailable = options.isProviderAvailable;
    if (options.currentMode !== undefined) this.currentMode = options.currentMode;
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
      this.notify();
      return this.runDispatch();
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

  async runDispatch(): Promise<boolean> {
    if (!this.isProviderAvailable || !this.assistant.isReady) return false;
    const pending = pendingDispatchStore.getPending(this.provider, this.sessionId);
    if (!pending || pending.status !== 'pending') return false;

    pendingDispatchStore.markInFlight(this.provider, this.sessionId);
    this.transientError = null;
    this.notify();

    try {
      await this.assistant.sendTurn(pending.prompt, {
        mode: this.currentMode,
        idempotencyKey: pending.idempotencyKey,
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
}

/**
 * React hook wrapping the initial prompt dispatch lifecycle in AiChatPage.
 */
export function useInitialDispatch(options: UseInitialDispatchOptions): InitialDispatchState {
  const { provider, sessionId, assistant, isProviderAvailable, currentMode } = options;
  const [transientError, setTransientError] = useState<string | null>(null);
  const [retryTrigger, setRetryTrigger] = useState(0);

  const pending = pendingDispatchStore.getPending(provider, sessionId);
  const failedInitialDispatch = pending?.status === 'failed' ? pending : null;
  const isInitialDispatchInFlight = pending?.status === 'in-flight';
  const displayError = transientError || failedInitialDispatch?.error || null;
  const canRetryInitial = Boolean(failedInitialDispatch);

  const handleRetryInitial = useCallback(() => {
    const retried = pendingDispatchStore.retryPending(provider, sessionId);
    if (retried) {
      setTransientError(null);
      setRetryTrigger((c) => c + 1);
    }
  }, [provider, sessionId]);

  const handleDismissError = useCallback(() => {
    setTransientError(null);
    if (pendingDispatchStore.getPending(provider, sessionId)?.status === 'failed') {
      pendingDispatchStore.clearPending(provider, sessionId);
      setRetryTrigger((c) => c + 1);
    }
  }, [provider, sessionId]);

  useEffect(() => {
    if (!isProviderAvailable || !assistant.isReady) return;
    const current = pendingDispatchStore.getPending(provider, sessionId);
    if (!current || current.status !== 'pending') return;

    pendingDispatchStore.markInFlight(provider, sessionId);
    setTransientError(null);

    (async () => {
      try {
        await assistant.sendTurn(current.prompt, {
          mode: currentMode,
          idempotencyKey: current.idempotencyKey,
        });
        pendingDispatchStore.clearPending(provider, sessionId);
        setRetryTrigger((c) => c + 1);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        pendingDispatchStore.markFailed(provider, sessionId, errorMsg);
        setRetryTrigger((c) => c + 1);
      }
    })();
  }, [assistant.isReady, currentMode, isProviderAvailable, provider, retryTrigger, sessionId]);

  return {
    pendingDispatch: pending,
    failedInitialDispatch,
    displayError,
    canRetryInitial,
    isInitialDispatchInFlight,
    handleRetryInitial,
    handleDismissError,
    setSubmissionError: setTransientError,
  };
}
