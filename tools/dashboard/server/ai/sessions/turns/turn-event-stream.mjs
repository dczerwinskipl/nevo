import { validateAgentIdentity } from '../../contracts.mjs';

export function sessionKey(provider, providerSessionId) {
  return `${provider}\u0000${providerSessionId}`;
}

/**
 * Manages low-level Agent Turn event mechanics:
 * - Monotonic per-session event sequencing
 * - Per-turn and per-session event buffering
 * - Event publication and subscriber dispatching
 * - Replay from sequence cursors
 */
export class TurnEventStream {
  #sessionSequences = new Map();
  #sessionEvents = new Map();
  #sessionSubscribers = new Map();
  #maxEventsPerTurn;
  #clock;

  constructor({ maxEventsPerTurn = 500, clock = () => new Date() } = {}) {
    this.#maxEventsPerTurn = maxEventsPerTurn;
    this.#clock = clock;
  }

  initSessionSequence(provider, providerSessionId, initialSeq = 0) {
    const key = sessionKey(provider, providerSessionId);
    if (!this.#sessionSequences.has(key)) {
      this.#sessionSequences.set(key, initialSeq);
    }
    return this.#sessionSequences.get(key);
  }

  getSessionSequence(provider, providerSessionId) {
    const key = sessionKey(provider, providerSessionId);
    return this.#sessionSequences.get(key);
  }

  setSessionSequence(provider, providerSessionId, seq) {
    const key = sessionKey(provider, providerSessionId);
    const current = this.#sessionSequences.get(key) || 0;
    if (seq > current) {
      this.#sessionSequences.set(key, seq);
    }
  }

  allocateNextSeq(state) {
    if (state.provider && state.providerSessionId) {
      const key = sessionKey(state.provider, state.providerSessionId);
      let current = this.#sessionSequences.get(key);
      if (current === undefined) {
        current = state.sequence || 0;
      }
      current += 1;
      this.#sessionSequences.set(key, current);
      state.sequence = current;
      return current;
    }
    state.sequence = (state.sequence || 0) + 1;
    return state.sequence;
  }

  emit(state, type, data = {}, transcriptCache = null) {
    const seq = this.allocateNextSeq(state);
    const timestamp = this.#timestamp();
    const event = {
      id: seq,
      seq,
      type,
      turnId: state.turnId,
      timestamp,
      ...structuredClone(data),
    };

    state.events.push(event);
    if (state.events.length > this.#maxEventsPerTurn) {
      state.events.shift();
    }

    if (state.provider && state.providerSessionId) {
      const key = sessionKey(state.provider, state.providerSessionId);
      let sessionEvents = this.#sessionEvents.get(key);
      if (!sessionEvents) {
        sessionEvents = [];
        this.#sessionEvents.set(key, sessionEvents);
      }
      sessionEvents.push(event);
      if (sessionEvents.length > 500) {
        sessionEvents.shift();
      }

      if (transcriptCache) {
        transcriptCache.applyEvent(state.provider, state.providerSessionId, event).catch(() => {});
      }

      const sessionSubs = this.#sessionSubscribers.get(key);
      if (sessionSubs) {
        for (const subscriber of sessionSubs) {
          subscriber(structuredClone(event));
        }
      }
    }

    for (const subscriber of state.subscribers) {
      subscriber(structuredClone(event));
    }
    return event;
  }

  getEvents(events, afterSequence = 0) {
    const cursor = Number(afterSequence) || 0;
    return (events || [])
      .filter(event => (event.id ?? event.seq ?? 0) > cursor)
      .map(event => structuredClone(event));
  }

  subscribeToTurn(state, { afterSequence = 0, onEvent } = {}) {
    if (typeof onEvent !== 'function') throw new TypeError('onEvent is required.');
    for (const event of this.getEvents(state.events, afterSequence)) {
      onEvent(event);
    }
    const isTerminal = state.status === 'completed' || state.status === 'failed';
    if (!isTerminal) {
      state.subscribers.add(onEvent);
    }
    return () => state.subscribers.delete(onEvent);
  }

  subscribeToSession({ provider, providerSessionId }, { afterSequence = 0, onEvent } = {}) {
    validateAgentIdentity({ provider, providerSessionId });
    if (typeof onEvent !== 'function') throw new TypeError('onEvent is required.');
    const key = sessionKey(provider, providerSessionId);
    let subs = this.#sessionSubscribers.get(key);
    if (!subs) {
      subs = new Set();
      this.#sessionSubscribers.set(key, subs);
    }
    const recent = this.#sessionEvents.get(key) || [];
    const cursor = Number(afterSequence) || 0;
    for (const event of recent) {
      if ((event.seq ?? event.id ?? 0) > cursor) {
        onEvent(structuredClone(event));
      }
    }
    subs.add(onEvent);
    return () => {
      subs.delete(onEvent);
      if (subs.size === 0) {
        this.#sessionSubscribers.delete(key);
      }
    };
  }

  #timestamp() {
    const value = this.#clock();
    return (value instanceof Date ? value : new Date(value)).toISOString();
  }
}

export function createTurnEventStream(options) {
  return new TurnEventStream(options);
}
