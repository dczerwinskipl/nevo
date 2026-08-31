import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findPersistedActiveTurn,
  getPersistedTurnSnapshot,
  interruptStaleLiveInteraction,
  reconcileOrphanedTurns,
  reconstructTurnState,
} from '../server/ai/sessions/turns/turn-recovery.mjs';

function createMockRegistry() {
  const provider = {
    startTurn: () => {},
    respondInteraction: () => {},
  };
  return {
    get: (name) => ({ provider, descriptor: { id: name } }),
  };
}

test('turn-recovery: reconstructTurnState builds canonical in-memory waiting turn', () => {
  const cached = {
    provider: 'fake',
    providerSessionId: 'sess-recon',
    lastEventSeq: 12,
    activeTurn: {
      turnId: 'turn-cached-1',
      mode: 'edit',
      startedAt: '2026-08-31T05:00:00.000Z',
    },
    pendingInteraction: {
      id: 'inter-1',
      kind: 'confirmation',
      prompt: 'Proceed?',
      resumePolicy: 'restart',
    },
  };

  const registry = createMockRegistry();
  const state = reconstructTurnState({ cached, registry, clock: () => new Date('2026-08-31T05:01:00.000Z') });

  assert.equal(state.turnId, 'turn-cached-1');
  assert.equal(state.provider, 'fake');
  assert.equal(state.providerSessionId, 'sess-recon');
  assert.equal(state.status, 'waitingForUser');
  assert.equal(state.mode, 'edit');
  assert.equal(state.events, undefined, 'Runtime state must not contain events array');
  assert.equal(state.subscribers, undefined, 'Runtime state must not contain subscribers Set');
  assert.deepEqual(state.pendingInteraction, cached.pendingInteraction);
  assert.ok(state.abortController);
});

test('turn-recovery: findPersistedActiveTurn matches by session and interactionId', async () => {
  const transcripts = new Map([
    ['fake\u0000sess-1', {
      provider: 'fake',
      providerSessionId: 'sess-1',
      activeTurn: { turnId: 'turn-1', mode: 'edit' },
      pendingInteraction: { id: 'inter-1' },
    }],
  ]);

  const mockCache = {
    async getTranscript(p, s) {
      return transcripts.get(`${p}\u0000${s}`) || null;
    },
    entries() {
      return transcripts.entries();
    },
  };

  const found = await findPersistedActiveTurn({
    transcriptCache: mockCache,
    provider: 'fake',
    providerSessionId: 'sess-1',
    interactionId: 'inter-1',
  });
  assert.ok(found);
  assert.equal(found.activeTurn.turnId, 'turn-1');

  const mismatched = await findPersistedActiveTurn({
    transcriptCache: mockCache,
    provider: 'fake',
    providerSessionId: 'sess-1',
    interactionId: 'inter-wrong',
  });
  assert.equal(mismatched, null);

  const foundByTurnId = await findPersistedActiveTurn({
    transcriptCache: mockCache,
    turnId: 'turn-1',
  });
  assert.ok(foundByTurnId);
});

test('turn-recovery: interruptStaleLiveInteraction marks turn interrupted and throws AI_TURN_INTERRUPTED', async () => {
  let markCalled = false;
  let flushed = false;

  const mockCache = {
    markTurnInterrupted(p, s, payload) {
      markCalled = true;
      assert.equal(p, 'fake');
      assert.equal(s, 'sess-live');
      assert.ok(payload.text.includes('Interrupted by server restart'));
    },
    async flush(p, s) {
      flushed = true;
    },
  };

  await assert.rejects(
    async () => {
      await interruptStaleLiveInteraction(mockCache, 'fake', 'sess-live');
    },
    (err) => {
      assert.equal(err.code, 'AI_TURN_INTERRUPTED');
      assert.equal(err.status, 409);
      return true;
    }
  );

  assert.ok(markCalled);
  assert.ok(flushed);
});

test('turn-recovery: reconcileOrphanedTurns marks orphan turns interrupted while leaving restart-resumable interactions untouched', async () => {
  const sessions = [
    { provider: 'fake', providerSessionId: 'sess-orphan' },
    { provider: 'fake', providerSessionId: 'sess-resumable' },
    { provider: 'fake', providerSessionId: 'sess-live-op' },
  ];

  const transcripts = {
    'sess-orphan': {
      activeTurn: { turnId: 'turn-orphan' },
      pendingInteraction: null,
    },
    'sess-resumable': {
      activeTurn: { turnId: 'turn-resumable' },
      pendingInteraction: { id: 'inter-resumable', resumePolicy: 'restart' },
    },
    'sess-live-op': {
      activeTurn: { turnId: 'turn-live-op' },
      pendingInteraction: { id: 'inter-live-op', resumePolicy: 'live-operation' },
    },
  };

  const interrupted = [];
  let flushedAll = false;

  const mockCache = {
    async listPersistedSessions() {
      return sessions;
    },
    async getTranscript(p, s) {
      return transcripts[s] || null;
    },
    markTurnInterrupted(p, s) {
      interrupted.push(s);
    },
    async flushAll() {
      flushedAll = true;
    },
  };

  const result = await reconcileOrphanedTurns(mockCache);

  assert.equal(result.reconciledCount, 2);
  assert.deepEqual(interrupted.sort(), ['sess-live-op', 'sess-orphan']);
  assert.ok(!interrupted.includes('sess-resumable'), 'Restart-resumable interaction must be preserved');
  assert.ok(flushedAll);
});

test('turn-recovery: getPersistedTurnSnapshot extracts snapshot from cache when turn not in memory', () => {
  const transcripts = new Map([
    ['fake\u0000sess-snap', {
      provider: 'fake',
      providerSessionId: 'sess-snap',
      lastEventSeq: 7,
      activeTurn: {
        turnId: 'turn-snap-1',
        startedAt: '2026-08-31T05:10:00.000Z',
      },
      pendingInteraction: {
        id: 'inter-snap',
        prompt: 'Confirm action',
      },
    }],
  ]);

  const mockCache = {
    entries() {
      return transcripts.entries();
    },
  };

  const snapshot = getPersistedTurnSnapshot({
    transcriptCache: mockCache,
    turnId: 'turn-snap-1',
  });

  assert.ok(snapshot);
  assert.equal(snapshot.turnId, 'turn-snap-1');
  assert.equal(snapshot.provider, 'fake');
  assert.equal(snapshot.providerSessionId, 'sess-snap');
  assert.equal(snapshot.status, 'waitingForUser');
  assert.equal(snapshot.lastEventId, 7);
  assert.equal(snapshot.pendingInteraction.id, 'inter-snap');
});
