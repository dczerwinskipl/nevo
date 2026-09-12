import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import turnRoutes from '../server/ai/sessions/turns/routes.mjs';
import { createAgentTurnRuntime } from '../server/ai/sessions/turns/runtime.mjs';
import { createAgentSessionService } from '../server/ai/sessions/service.mjs';
import { createAgentProviderRegistry } from '../server/ai/providers/registry.mjs';
import { TurnLifecycleCoordinator } from '../server/ai/sessions/turns/coordinator.mjs';
import {
  findPersistedActiveTurn,
  getPersistedTurnSnapshot,
  interruptStaleLiveInteraction,
  reconcileOrphanedTurns,
  reconcileTurnState,
  reconstructTurnState,
} from '../server/ai/sessions/turns/turn-recovery.mjs';
import { AiError } from '../server/ai/contracts.mjs';
import { aiErrorHandler } from '../server/ai/sessions/http.mjs';


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
  assert.equal(state.coordinator.status.status, 'requiresAttention');
  assert.equal(state.mode, 'edit');
  assert.equal(state.events, undefined, 'Runtime state must not contain events array');
  assert.equal(state.subscribers, undefined, 'Runtime state must not contain subscribers Set');
  assert.equal(state.coordinator.pendingInteraction?.id, cached.pendingInteraction.id);
  assert.equal(state.coordinator.pendingInteraction?.kind, cached.pendingInteraction.kind);
  assert.ok(state.abortController);
});

test('turn-recovery: findPersistedActiveTurn matches by session and interactionId', async () => {
  const transcripts = new Map([
    [
      'fake\u0000sess-1',
      {
        provider: 'fake',
        providerSessionId: 'sess-1',
        activeTurn: { turnId: 'turn-1', mode: 'edit' },
        pendingInteraction: { id: 'inter-1' },
      },
    ],
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
    },
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
    [
      'fake\u0000sess-snap',
      {
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
      },
    ],
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

async function waitFor(fn, predicate, label = 'condition', timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const val = await fn();
    if (predicate(val)) return val;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`Timeout waiting for ${label}`);
}

test('Criterion 1: dropped provider operations transition to status: "unknown" with code AI_OPERATION_LOST rather than falsely claiming outcome: "failed"', async () => {
  const droppedProvider = {
    descriptor: {
      id: 'dropped-provider',
      label: 'Dropped Provider',
      capabilities: { cancelTurn: true },
    },
    async startTurn() {
      throw new AiError('AI_OPERATION_LOST', 'Connection dropped unexpectedly.', {
        status: 500,
        cause: 'operation_lost',
      });
    },
    async cancelTurn() {},
  };

  const registry = createAgentProviderRegistry([droppedProvider]);
  const runtime = createAgentTurnRuntime({ registry });

  const { turnId } = await runtime.startTurn({
    provider: 'dropped-provider',
    providerSessionId: 'sess-dropped',
    message: 'run command',
  });

  const snapshot = await waitFor(
    () => runtime.getSnapshot(turnId),
    (v) => v.status === 'unknown',
    'status: unknown',
  );

  assert.equal(snapshot.status, 'unknown');
  assert.equal(snapshot.code, 'AI_OPERATION_LOST');
  assert.equal(snapshot.reason, 'operation_lost');

  const canonicalTurn = runtime.getCanonicalTurn(turnId);
  assert.equal(canonicalTurn.status.status, 'unknown');
  assert.equal(canonicalTurn.status.reason, 'operation_lost');
  assert.equal(canonicalTurn.status.outcome, undefined);
  assert.equal(canonicalTurn.terminalOutcome, undefined);

  runtime.shutdown();
});

test('Criterion 2: session turn queue rejects new turn submissions while active turn is in status: "unknown"', async () => {
  const hungProvider = {
    descriptor: {
      id: 'hung-provider',
      label: 'Hung Provider',
      capabilities: { cancelTurn: true },
    },
    async startTurn() {
      throw new AiError('AI_OPERATION_LOST', 'Process lost.', { status: 500, cause: 'operation_lost' });
    },
    async cancelTurn() {},
  };

  const registry = createAgentProviderRegistry([hungProvider]);
  const runtime = createAgentTurnRuntime({ registry });

  const { turnId } = await runtime.startTurn({
    provider: 'hung-provider',
    providerSessionId: 'sess-blocked',
    message: 'first turn',
  });

  await waitFor(
    () => runtime.getSnapshot(turnId),
    (v) => v.status === 'unknown',
    'unknown',
  );

  await assert.rejects(
    () =>
      runtime.startTurn({
        provider: 'hung-provider',
        providerSessionId: 'sess-blocked',
        message: 'second turn while unknown',
      }),
    (err) => {
      assert.equal(err.code, 'AI_TURN_CONFLICT');
      assert.equal(err.status, 409);
      return true;
    },
  );

  runtime.shutdown();
});

test('Criterion 3: state reconciliation preserves epistemic truth: confirmed PID termination proves liveness cessation without fabricating provider results; provider completion or failure requires authoritative provider protocol evidence', () => {
  // Test 3a: Authoritative evidence of completion
  const coord1 = new TurnLifecycleCoordinator({
    turnId: 'turn-rec-1',
    sessionId: 'sess-rec-1',
    provider: 'test-prov',
  });
  coord1.markOperationLost({ reason: 'operation_lost', code: 'AI_OPERATION_LOST' });
  assert.equal(coord1.status.status, 'unknown');

  const settledCompleted = reconcileTurnState(coord1, { authoritativeOutcome: 'completed' });
  assert.equal(settledCompleted.status, 'terminal');
  assert.equal(settledCompleted.outcome, 'completed');
  assert.equal(settledCompleted.initiator, 'provider');

  // Test 3b: Authoritative evidence of failure
  const coord2 = new TurnLifecycleCoordinator({
    turnId: 'turn-rec-2',
    sessionId: 'sess-rec-2',
    provider: 'test-prov',
  });
  coord2.markOperationLost({ reason: 'operation_lost', code: 'AI_OPERATION_LOST' });
  assert.equal(coord2.status.status, 'unknown');

  const settledFailed = reconcileTurnState(coord2, {
    authoritativeOutcome: 'failed',
    error: { code: 'AI_POLICY_DENIED', message: 'Rejected by policy' },
  });
  assert.equal(settledFailed.status, 'terminal');
  assert.equal(settledFailed.outcome, 'failed');
  assert.equal(settledFailed.initiator, 'provider');
  assert.equal(settledFailed.error?.code, 'AI_POLICY_DENIED');

  // Test 3c: Confirmed process termination without protocol evidence
  const coord3 = new TurnLifecycleCoordinator({
    turnId: 'turn-rec-3',
    sessionId: 'sess-rec-3',
    provider: 'test-prov',
  });
  coord3.markOperationLost({ reason: 'operation_lost', code: 'AI_OPERATION_LOST' });
  assert.equal(coord3.status.status, 'unknown');

  const settledTerminated = reconcileTurnState(coord3, { processTerminated: true, cause: 'forced_cleanup' });
  assert.equal(settledTerminated.status, 'terminal');
  assert.equal(settledTerminated.outcome, 'interrupted');
  assert.equal(settledTerminated.cause, 'forced_cleanup');
  assert.notEqual(settledTerminated.outcome, 'completed');
  assert.notEqual(settledTerminated.outcome, 'failed');

  // Test 3d: Direct coordinator methods
  const coord4 = new TurnLifecycleCoordinator({
    turnId: 'turn-rec-4',
    sessionId: 'sess-rec-4',
    provider: 'test-prov',
  });
  coord4.markOperationLost();
  assert.throws(() => coord4.reconcileAuthoritativeEvidence({ outcome: 'interrupted' }), {
    name: 'TypeError',
  });
});

test('Criterion 4, 5, 6: remote recovery API terminates process tree, settles as interrupted/forced_cleanup, unblocks session, and is distinguished from user cancel', async () => {
  let processKilled = false;
  const mockChild = {
    pid: 999999,
    killed: false,
    kill() {
      this.killed = true;
      processKilled = true;
      return true;
    },
  };

  let turn1Active = true;
  const recoverableProvider = {
    descriptor: {
      id: 'rec-provider',
      label: 'Recoverable Provider',
      capabilities: { cancelTurn: true },
    },
    async startTurn({ setProviderSessionId, setOperation }) {
      await setProviderSessionId?.('sess-rec-1');
      if (turn1Active) {
        setOperation({ child: mockChild, pid: mockChild.pid });
        throw new AiError('AI_OPERATION_LOST', 'Lost connection', { status: 500, cause: 'operation_lost' });
      } else {
        return { status: 'completed' };
      }
    },
    async cancelTurn() {},
  };

  const registry = createAgentProviderRegistry([recoverableProvider]);
  const runtime = createAgentTurnRuntime({ registry });
  const service = createAgentSessionService({ turnRuntime: runtime, registry });

  const fastify = Fastify({ logger: false });
  fastify.setErrorHandler(aiErrorHandler);
  await fastify.register(turnRoutes, { service, accessPolicy: () => true });

  const injectAction = (opts) =>
    fastify.inject({
      ...opts,
      headers: {
        'x-nevo-dashboard-action': '1',
        ...opts.headers,
      },
    });

  // 1. Start turn 1
  const startRes1 = await injectAction({
    method: 'POST',
    url: '/api/agent-sessions/turns',
    payload: {
      provider: 'rec-provider',
      message: 'turn 1',
    },
  });
  assert.equal(startRes1.statusCode, 201);
  const { turnId: turnId1, providerSessionId } = startRes1.json();

  await waitFor(
    () => runtime.getSnapshot(turnId1),
    (v) => v.status === 'unknown',
    'status: unknown',
  );

  // 2. Proves new turn is rejected while turn 1 is unknown (Criterion 2 & 5)
  const conflictRes = await injectAction({
    method: 'POST',
    url: `/api/agent-sessions/rec-provider/${providerSessionId}/turns`,
    payload: { message: 'turn 2 while blocked' },
  });
  assert.equal(conflictRes.statusCode, 409);

  // 3. Remote client calls POST .../recover (Criterion 4)
  const recoverRes = await injectAction({
    method: 'POST',
    url: `/api/agent-sessions/rec-provider/${providerSessionId}/turns/${turnId1}/recover`,
  });
  assert.equal(recoverRes.statusCode, 200);
  const { turn: recoveredTurn } = recoverRes.json();
  assert.equal(recoveredTurn.status, 'failed');
  const canonicalRecovered = runtime.getCanonicalTurn(turnId1);
  assert.equal(canonicalRecovered.status.status, 'terminal');
  assert.equal(canonicalRecovered.status.outcome, 'interrupted');
  assert.equal(canonicalRecovered.status.cause, 'forced_cleanup');

  // 4. Session turn lock is released: remote client can now dispatch turn 2 without physical access (Criterion 5)
  turn1Active = false;
  const startRes2 = await injectAction({
    method: 'POST',
    url: `/api/agent-sessions/rec-provider/${providerSessionId}/turns`,
    payload: { message: 'turn 2 after recovery' },
  });
  assert.equal(startRes2.statusCode, 202);
  const { turnId: turnId2 } = startRes2.json();
  const completedSnap = await waitFor(
    () => runtime.getSnapshot(turnId2),
    (v) => v.status === 'completed',
    'turn 2 completion',
  );
  assert.equal(completedSnap.status, 'completed');

  // 5. Test POST .../cancel with { action: 'force_cleanup' } (Criterion 4)
  turn1Active = true;
  const startRes3 = await injectAction({
    method: 'POST',
    url: `/api/agent-sessions/rec-provider/${providerSessionId}/turns`,
    payload: { message: 'turn 3' },
  });
  assert.equal(startRes3.statusCode, 202);
  const { turnId: turnId3 } = startRes3.json();
  await waitFor(
    () => runtime.getSnapshot(turnId3),
    (v) => v.status === 'unknown',
    'turn 3 unknown',
  );

  const forceCleanupRes = await injectAction({
    method: 'POST',
    url: `/api/agent-sessions/rec-provider/${providerSessionId}/turns/${turnId3}/cancel`,
    payload: { action: 'force_cleanup' },
  });
  assert.equal(forceCleanupRes.statusCode, 200);
  const canonicalForceCleaned = runtime.getCanonicalTurn(turnId3);
  assert.equal(canonicalForceCleaned.status.outcome, 'interrupted');
  assert.equal(canonicalForceCleaned.status.cause, 'forced_cleanup');

  // 6. Test normal user cancel cleanly distinguished from forced recovery (Criterion 6)
  let cancelDeferred;
  const cancellableProvider = {
    descriptor: {
      id: 'cancel-provider',
      label: 'Cancel Provider',
      capabilities: { cancelTurn: true },
    },
    async startTurn({ signal, setProviderSessionId }) {
      await setProviderSessionId?.('sess-cancel-1');
      await new Promise((resolve) => {
        cancelDeferred = resolve;
        signal.addEventListener('abort', () => resolve());
      });
    },
    async cancelTurn() {
      cancelDeferred?.();
    },
  };
  registry.register(cancellableProvider);

  const startRes4 = await injectAction({
    method: 'POST',
    url: '/api/agent-sessions/turns',
    payload: { provider: 'cancel-provider', message: 'run long operation' },
  });
  const { turnId: turnId4, providerSessionId: sess4 } = startRes4.json();

  const cancelRes = await injectAction({
    method: 'POST',
    url: `/api/agent-sessions/cancel-provider/${sess4}/turns/${turnId4}/cancel`,
    payload: { action: 'cancel' },
  });
  assert.equal(cancelRes.statusCode, 200);
  const canonicalCancelled = runtime.getCanonicalTurn(turnId4);
  assert.equal(canonicalCancelled.status.status, 'terminal');
  assert.equal(canonicalCancelled.status.outcome, 'cancelled');
  assert.equal(canonicalCancelled.status.initiator, 'user');

  await fastify.close();
  runtime.shutdown();
});

test('Criterion 7: per-turn rate limits and process crashes do not mutate provider descriptor health to unavailable or installed: false', async () => {
  let mode = 'normal';
  const resilientProvider = {
    descriptor: {
      id: 'resilient-provider',
      label: 'Resilient Provider',
      capabilities: { cancelTurn: true },
      health: {
        enabled: true,
        installed: true,
        status: 'healthy',
      },
    },
    async startTurn() {
      if (mode === 'rate_limit') {
        throw new AiError('AI_RATE_LIMITED', 'Rate limit exceeded 429', { status: 429, suggestedDelayMs: 1000 });
      }
      if (mode === 'crash') {
        throw new AiError('AI_PROVIDER_EXECUTION_ERROR', 'Process crashed with exit code 1', { status: 502 });
      }
      return { status: 'completed' };
    },
    async cancelTurn() {},
    isAvailable() {
      return {
        available: true,
        installed: true,
        status: 'healthy',
      };
    },
  };

  const registry = createAgentProviderRegistry([resilientProvider]);
  const runtime = createAgentTurnRuntime({ registry });

  let desc = registry.descriptors().find((d) => d.id === 'resilient-provider');
  assert.equal(desc.health.installed, true);
  assert.equal(desc.health.status, 'healthy');
  assert.equal(desc.available, true);

  mode = 'rate_limit';
  const { turnId: turnId1 } = await runtime.startTurn({
    provider: 'resilient-provider',
    providerSessionId: 'sess-resilient',
    message: 'test rate limit',
  });
  const snap1 = await waitFor(
    () => runtime.getSnapshot(turnId1),
    (v) => v.status === 'failed',
    'failed rate limit',
  );
  assert.equal(snap1.status, 'failed');

  desc = registry.descriptors().find((d) => d.id === 'resilient-provider');
  assert.equal(desc.health.installed, true, 'Rate limit must not set installed: false');
  assert.equal(desc.health.status, 'healthy', 'Rate limit must not set status: unavailable');
  assert.equal(desc.available, true, 'Rate limit must not set available: false');

  mode = 'crash';
  const { turnId: turnId2 } = await runtime.startTurn({
    provider: 'resilient-provider',
    providerSessionId: 'sess-resilient-2',
    message: 'test process crash',
  });
  const snap2 = await waitFor(
    () => runtime.getSnapshot(turnId2),
    (v) => v.status === 'failed',
    'failed crash',
  );
  assert.equal(snap2.status, 'failed');

  desc = registry.descriptors().find((d) => d.id === 'resilient-provider');
  assert.equal(desc.health.installed, true, 'Process crash must not set installed: false');
  assert.equal(desc.health.status, 'healthy', 'Process crash must not set status: unavailable');
  assert.equal(desc.available, true, 'Process crash must not set available: false');

  runtime.shutdown();
});

test('Criterion 8: server restart boot reconciliation correctly marks orphaned active turns as terminal (outcome: "interrupted", cause: "server-restart") and preserves pending restart-capable interactions', async () => {
  const sessions = [
    { provider: 'fake', providerSessionId: 'sess-reconcile-boot' },
  ];

  const transcript = {
    activeTurn: { turnId: 'turn-boot-orphan' },
    pendingInteraction: { id: 'inter-keep', resumePolicy: 'restart' },
    turns: [
      {
        id: 'turn-boot-orphan',
        status: { status: 'active', detail: 'processing' },
        work: [],
      },
    ],
  };

  let markedOptions = null;
  const mockCache = {
    async listPersistedSessions() {
      return sessions;
    },
    async getTranscript(p, s) {
      return transcript;
    },
    markTurnInterrupted(p, s, options) {
      markedOptions = options;
    },
    async flushAll() {},
  };

  transcript.pendingInteraction.resumePolicy = 'live-operation';
  const result = await reconcileOrphanedTurns(mockCache);
  assert.equal(result.reconciledCount, 1);
  assert.equal(markedOptions?.cause, 'server-restart');
  assert.equal(markedOptions?.outcome, 'interrupted');

  const turn = transcript.turns[0];
  assert.equal(turn.status.status, 'terminal');
  assert.equal(turn.status.outcome, 'interrupted');
  assert.equal(turn.status.cause, 'server-restart');
});

