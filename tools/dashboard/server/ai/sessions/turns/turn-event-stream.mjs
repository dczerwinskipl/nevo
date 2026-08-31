import { validateAgentIdentity } from '../../contracts.mjs';

export function sessionKey(provider, providerSessionId) {
  return `${provider}\u0000${providerSessionId}`;
}

/**
 * Manages low-level Agent Turn event mechanics:
 * - Owns per-turn event buffers and subscribers
 * - Owns per-session event sequences, buffers, and subscribers
 * - Dispatches published events to turn and session subscribers
 * - Replays event buffers from sequence cursors
 * - Persists session-bound events to transcriptCache
 */
export class TurnEventStream {
  #turnEvents = new Map();
  #turnSubscribers = new Map();
  #turnBindings = new Map();
  #sessionSequences = new Map();
  #sessionEvents = new Map();
  #sessionSubscribers = new Map();
  #turnSequences = new Map();
  #maxEventsPerTurn;
  #clock;
  #transcriptCache;

  constructor({ transcriptCache = null, maxEventsPerTurn = 500, clock = () => new Date() } = {}) {
    this.#transcriptCache = transcriptCache;
    this.#maxEventsPerTurn = maxEventsPerTurn;
    this.#clock = clock;
  }

  registerTurn({ turnId, provider, providerSessionId, initialSequence = 0 } = {}) {
    if (!this.#turnEvents.has(turnId)) {
      this.#turnEvents.set(turnId, []);
    }
    if (!this.#turnSubscribers.has(turnId)) {
      this.#turnSubscribers.set(turnId, new Set());
    }
    this.#turnSequences.set(turnId, initialSequence);
    if (provider && providerSessionId) {
      this.bindSession(turnId, { provider, providerSessionId });
      this.initSessionSequence(provider, providerSessionId, initialSequence);
    }
  }

  bindSession(turnId, { provider, providerSessionId } = {}) {
    validateAgentIdentity({ provider, providerSessionId });
    this.#turnBindings.set(turnId, { provider, providerSessionId });
    const key = sessionKey(provider, providerSessionId);
    const turnSeq = this.#turnSequences.get(turnId) || 0;
    const currentSessionSeq = this.#sessionSequences.get(key) || 0;
    if (turnSeq > currentSessionSeq) {
      this.#sessionSequences.set(key, turnSeq);
    }
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

  getTurnSequence(turnId) {
    const binding = this.#turnBindings.get(turnId);
    if (binding) {
      return this.#sessionSequences.get(sessionKey(binding.provider, binding.providerSessionId)) || 0;
    }
    return this.#turnSequences.get(turnId) || 0;
  }

  allocateNextSeq(turnId) {
    const binding = this.#turnBindings.get(turnId);
    if (binding) {
      const key = sessionKey(binding.provider, binding.providerSessionId);
      let current = this.#sessionSequences.get(key);
      if (current === undefined) {
        current = this.#turnSequences.get(turnId) || 0;
      }
      current += 1;
      this.#sessionSequences.set(key, current);
      this.#turnSequences.set(turnId, current);
      return current;
    }
    let current = (this.#turnSequences.get(turnId) || 0) + 1;
    this.#turnSequences.set(turnId, current);
    return current;
  }

  emit(turnId, type, data = {}) {
    const seq = this.allocateNextSeq(turnId);
    const timestamp = this.#timestamp();
    const event = {
      id: seq,
      seq,
      type,
      turnId,
      timestamp,
      ...structuredClone(data),
    };

    let events = this.#turnEvents.get(turnId);
    if (!events) {
      events = [];
      this.#turnEvents.set(turnId, events);
    }
    events.push(event);
    if (events.length > this.#maxEventsPerTurn) {
      events.shift();
    }

    const binding = this.#turnBindings.get(turnId);
    if (binding) {
      const key = sessionKey(binding.provider, binding.providerSessionId);
      let sessionEvents = this.#sessionEvents.get(key);
      if (!sessionEvents) {
        sessionEvents = [];
        this.#sessionEvents.set(key, sessionEvents);
      }
      sessionEvents.push(event);
      if (sessionEvents.length > 500) {
        sessionEvents.shift();
      }

      if (this.#transcriptCache) {
        this.#transcriptCache.applyEvent(binding.provider, binding.providerSessionId, event).catch(() => {});
      }

      const sessionSubs = this.#sessionSubscribers.get(key);
      if (sessionSubs) {
        for (const subscriber of sessionSubs) {
          subscriber(structuredClone(event));
        }
      }
    }

    const turnSubs = this.#turnSubscribers.get(turnId);
    if (turnSubs) {
      for (const subscriber of turnSubs) {
        subscriber(structuredClone(event));
      }
    }
    return event;
  }

  getTurnEvents(turnId, afterSequence = 0) {
    const cursor = Number(afterSequence) || 0;
    const events = this.#turnEvents.get(turnId) || [];
    return events
      .filter(event => (event.id ?? event.seq ?? 0) > cursor)
      .map(event => structuredClone(event));
  }

  subscribeToTurn(turnId, { afterSequence = 0, onEvent, isTerminal = false } = {}) {
    if (typeof onEvent !== 'function') throw new TypeError('onEvent is required.');
    for (const event of this.getTurnEvents(turnId, afterSequence)) {
      onEvent(event);
    }
    if (!isTerminal) {
      let subs = this.#turnSubscribers.get(turnId);
      if (!subs) {
        subs = new Set();
        this.#turnSubscribers.set(turnId, subs);
      }
      subs.add(onEvent);
    }
    return () => {
      const subs = this.#turnSubscribers.get(turnId);
      subs?.delete(onEvent);
    };
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

  clearTurnSubscribers(turnId) {
    const subs = this.#turnSubscribers.get(turnId);
    subs?.clear();
  }

  releaseTurn(turnId) {
    this.#turnEvents.delete(turnId);
    this.#turnSubscribers.delete(turnId);
    this.#turnBindings.delete(turnId);
    this.#turnSequences.delete(turnId);
  }

  #timestamp() {
    const value = this.#clock();
    return (value instanceof Date ? value : new Date(value)).toISOString();
  }
}

export function createTurnEventStream(options) {
  return new TurnEventStream(options);
}
