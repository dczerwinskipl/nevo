export function sessionKey(providerOrSessionId, providerSessionId) {
  if (!providerSessionId) return String(providerOrSessionId);
  return `${providerOrSessionId}\u0000${providerSessionId}`;
}

const PRIVATE_EVENT_FIELD_PATTERN =
  /provider.*(?:request|event|payload).*id|providerRequestId|rawPayload|rawBytes|childPid|processId|processHandle|childProcess|rpcEnvelope|envelope|transport|^pid$/i;

export function sanitizeEventData(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map(sanitizeEventData);
  }
  const clean = {};
  for (const [key, val] of Object.entries(value)) {
    if (PRIVATE_EVENT_FIELD_PATTERN.test(key)) {
      continue;
    }
    clean[key] = sanitizeEventData(val);
  }
  return clean;
}

export function normalizeLayer2ToLayer3Event(rawType, rawData = {}) {
  let type = rawType;
  let data = sanitizeEventData(rawData);

  if (rawType === 'final_answer.delta') {
    type = 'text.delta';
    const messageId = data.finalAnswerId || data.messageId || 'final-answer';
    const text = data.text ?? data.delta ?? '';
    const delta = data.delta ?? data.text ?? '';
    delete data.finalAnswerId;
    data.messageId = messageId;
    data.text = text;
    data.delta = delta;
  } else if (rawType === 'commentary.delta') {
    type = 'progress.delta';
    const progressId = data.commentaryId || data.progressId || 'progress';
    const text = data.text ?? data.delta ?? '';
    const delta = data.delta ?? data.text ?? '';
    delete data.commentaryId;
    data.progressId = progressId;
    data.text = text;
    data.delta = delta;
  }

  return { type, data };
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

  registerTurn({ turnId, sessionId, provider, providerSessionId, initialSequence = 0 } = {}) {
    if (!this.#turnEvents.has(turnId)) {
      this.#turnEvents.set(turnId, []);
    }
    if (!this.#turnSubscribers.has(turnId)) {
      this.#turnSubscribers.set(turnId, new Set());
    }
    this.#turnSequences.set(turnId, initialSequence);
    if (sessionId || (provider && providerSessionId)) {
      this.bindSession(turnId, { sessionId, provider, providerSessionId });
      this.initSessionSequence(sessionId || provider, sessionId ? undefined : providerSessionId, initialSequence);
    }
  }

  bindSession(turnId, { sessionId, provider, providerSessionId } = {}) {
    this.#turnBindings.set(turnId, { sessionId, provider, providerSessionId });
    const key = sessionId || sessionKey(provider, providerSessionId);
    const turnSeq = this.#turnSequences.get(turnId) || 0;
    const currentSessionSeq = this.#sessionSequences.get(key) || 0;
    if (turnSeq > currentSessionSeq) {
      this.#sessionSequences.set(key, turnSeq);
    }
  }

  initSessionSequence(providerOrSessionId, providerSessionId, initialSeq = 0) {
    const key = sessionKey(providerOrSessionId, providerSessionId);
    if (!this.#sessionSequences.has(key)) {
      this.#sessionSequences.set(key, initialSeq);
    }
    return this.#sessionSequences.get(key);
  }

  getSessionSequence(providerOrSessionId, providerSessionId) {
    const key = sessionKey(providerOrSessionId, providerSessionId);
    return this.#sessionSequences.get(key);
  }

  setSessionSequence(providerOrSessionId, providerSessionId, seq) {
    const key = sessionKey(providerOrSessionId, providerSessionId);
    const current = this.#sessionSequences.get(key) || 0;
    if (seq > current) {
      this.#sessionSequences.set(key, seq);
    }
  }

  getTurnSequence(turnId) {
    const binding = this.#turnBindings.get(turnId);
    if (binding) {
      const key = binding.sessionId || sessionKey(binding.provider, binding.providerSessionId);
      return this.#sessionSequences.get(key) || 0;
    }
    return this.#turnSequences.get(turnId) || 0;
  }

  allocateNextSeq(turnId) {
    const binding = this.#turnBindings.get(turnId);
    if (binding) {
      const key = binding.sessionId || sessionKey(binding.provider, binding.providerSessionId);
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
    const { type: publicType, data: cleanData } = normalizeLayer2ToLayer3Event(type, data);
    const seq = this.allocateNextSeq(turnId);
    const timestamp = this.#timestamp();
    const event = {
      id: seq,
      seq,
      type: publicType,
      turnId,
      timestamp,
      ...structuredClone(cleanData),
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
      const key = binding.sessionId || sessionKey(binding.provider, binding.providerSessionId);
      let sessionEvents = this.#sessionEvents.get(key);
      if (!sessionEvents) {
        sessionEvents = [];
        this.#sessionEvents.set(key, sessionEvents);
      }
      sessionEvents.push(event);
      if (sessionEvents.length > 500) {
        sessionEvents.shift();
      }

      // Canonical transcript belongs to sessionId exactly once. providerSessionId is
      // provider-native metadata, never a second transcript identity — a compatibility
      // route that only knows (provider, providerSessionId) is responsible for resolving
      // to the canonical AgentSession and its sessionId *before* reaching here (see
      // AgentSessionService.subscribeToSession / findSessionByProviderIdentity), not by
      // this layer forking a duplicate transcript under the native id. The providerSessionId
      // branch only fires when no canonical sessionId is known at all (there is then only
      // one identity in play, so writing under it is not a duplication).
      if (this.#transcriptCache) {
        if (binding.sessionId) {
          this.#transcriptCache.applyEvent(binding.provider, binding.sessionId, event).catch(() => {});
        } else if (binding.providerSessionId) {
          this.#transcriptCache.applyEvent(binding.provider, binding.providerSessionId, event).catch(() => {});
        }
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
    return events.filter((event) => (event.id ?? event.seq ?? 0) > cursor).map((event) => structuredClone(event));
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

  subscribeToSession(identityOrSessionId, { afterSequence = 0, onEvent } = {}) {
    if (typeof onEvent !== 'function') throw new TypeError('onEvent is required.');
    let key;
    if (typeof identityOrSessionId === 'string') {
      key = identityOrSessionId;
    } else if (identityOrSessionId?.sessionId) {
      key = identityOrSessionId.sessionId;
    } else if (identityOrSessionId?.provider && identityOrSessionId?.providerSessionId) {
      key = sessionKey(identityOrSessionId.provider, identityOrSessionId.providerSessionId);
    } else {
      key = String(identityOrSessionId);
    }
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
