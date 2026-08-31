import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, rm, mkdtemp, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  createCanonicalTurn,
  validateCanonicalTurn,
  projectChatV1,
  normalizeTransitionalToolStatus,
  AiError,
} from '../server/ai/contracts.mjs';
import { TurnLifecycleCoordinator } from '../server/ai/sessions/turns/coordinator.mjs';
import { createAgentTurnRuntime } from '../server/ai/sessions/turns/runtime.mjs';
import { createTranscriptCacheService } from '../server/ai/sessions/transcript-cache.mjs';
import { createAgentProviderRegistry } from '../server/ai/providers/registry.mjs';

function waitFor(checkFn, predicate, message = 'condition', timeoutMs = 2000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const value = await checkFn();
        if (predicate(value)) {
          resolve(value);
          return;
        }
      } catch (err) {
        // continue polling until timeout
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Timed out waiting for ${message}`));
        return;
      }
      setTimeout(poll, 15);
    };
    poll();
  });
}

test('Part A1 & A2: live V2 progression streams meaningful canonical changes while turn is running', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-live-v2-'));
  try {
    const transcriptCache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    const registry = createAgentProviderRegistry();

    let runtimeContext;
    let finishTurn;
    const turnBlocker = new Promise(r => { finishTurn = r; });

    registry.register({
      descriptor: {
        id: 'fake-live',
        label: 'Fake Live',
        capabilities: { toolCalls: true, cancelTurn: true },
      },
      async startTurn(ctx) {
        runtimeContext = ctx;
        // Step 1: Start commentary
        ctx.emitTextDelta('Beginning file analysis...', 'msg-1');
        await turnBlocker;
        return { done: true };
      },
      async cancelTurn() {},
    });

    const runtime = createAgentTurnRuntime({
      registry,
      transcriptCache,
    });

    const turnUpdates = [];
    const unsub = runtime.subscribeToSession({ provider: 'fake-live', providerSessionId: 'sess-live-1' }, {
      onEvent: ev => {
        if (ev.type === 'turn.updated') {
          turnUpdates.push(structuredClone(ev.turn));
        }
      },
    });

    const { turnId } = await runtime.startTurn({
      provider: 'fake-live',
      providerSessionId: 'sess-live-1',
      message: 'Analyze files and report',
    });

    // Verify Step 1: Commentary emitted immediately as turn.updated
    await waitFor(() => turnUpdates.length, len => len >= 1, 'commentary turn.updated');
    const update1 = turnUpdates[0];
    assert.equal(update1.work.length, 1);
    assert.equal(update1.work[0].type, 'commentary');
    assert.equal(update1.work[0].text, 'Beginning file analysis...');

    // Step 2: Tool started
    runtimeContext.emitToolStarted({
      toolId: 't1',
      toolName: 'Read',
      input: { file_path: 'src/main.ts' },
    });

    await waitFor(() => turnUpdates.length, len => len >= 2, 'tool start turn.updated');
    const update2 = turnUpdates[turnUpdates.length - 1];
    assert.equal(update2.work.length, 2);
    assert.equal(update2.work[1].type, 'tool');
    assert.equal(update2.work[1].toolName, 'Read');
    assert.equal(update2.work[1].status, 'active');

    // Step 3: Tool progress
    runtimeContext.emitToolUpdated({
      toolId: 't1',
      progress: '1024 bytes read',
    });

    await waitFor(() => turnUpdates.length, len => len >= 3, 'tool progress turn.updated');
    const update3 = turnUpdates[turnUpdates.length - 1];
    assert.equal(update3.work[1].progress, '1024 bytes read');

    // Step 4: Tool completed
    runtimeContext.emitToolCompleted({
      toolId: 't1',
      output: 'export const main = () => {};',
      durationMs: 45,
      status: 'completed',
    });

    await waitFor(() => turnUpdates.length, len => len >= 4, 'tool completed turn.updated');
    const update4 = turnUpdates[turnUpdates.length - 1];
    assert.equal(update4.work[1].status, 'completed');
    assert.equal(update4.work[1].durationMs, 45);

    // Step 5: Second commentary block
    runtimeContext.emitTextDelta('File analyzed successfully. Preparing final response.', 'msg-2');
    await waitFor(() => turnUpdates.length, len => len >= 5, 'commentary 2 turn.updated');
    const update5 = turnUpdates[turnUpdates.length - 1];
    assert.equal(update5.work.length, 3);
    assert.equal(update5.work[2].type, 'commentary');

    // Step 6: Final Answer set
    runtime.setFinalAnswer(turnId, { text: 'Analysis complete: src/main.ts contains main export.', status: 'completed' });
    await waitFor(() => turnUpdates.length, len => len >= 6, 'final answer turn.updated');
    const update6 = turnUpdates[turnUpdates.length - 1];
    assert.equal(update6.finalAnswer?.status, 'completed');
    assert.equal(update6.finalAnswer?.text, 'Analysis complete: src/main.ts contains main export.');

    finishTurn();
    await waitFor(() => runtime.getSnapshot(turnId), v => v.status === 'completed', 'turn completion');

    unsub();
    await runtime.shutdown();
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('Part A2: Live SSE vs Reconnected SSE vs HTTP V2 vs Persistence Reload all converge to identical Turn', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-convergence-'));
  try {
    const transcriptCache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    const registry = createAgentProviderRegistry();

    registry.register({
      descriptor: {
        id: 'fake-conv',
        label: 'Fake Convergence',
        capabilities: { toolCalls: true, cancelTurn: true },
      },
      async startTurn(ctx) {
        ctx.emitTextDelta('Inspecting workspace...', 'msg-1');
        ctx.emitToolStarted({ toolId: 'tool-git', toolName: 'GitStatus', input: {} });
        ctx.emitToolCompleted({ toolId: 'tool-git', output: 'clean', durationMs: 15, status: 'completed' });
        ctx.emitTextDelta('All checks passed.', 'msg-2');
      },
      async cancelTurn() {},
    });

    const runtime = createAgentTurnRuntime({
      registry,
      transcriptCache,
    });

    const liveTurnUpdates = [];
    const unsubLive = runtime.subscribeToSession({ provider: 'fake-conv', providerSessionId: 'sess-conv-1' }, {
      onEvent: ev => {
        if (ev.type === 'turn.updated') {
          liveTurnUpdates.push(structuredClone(ev.turn));
        }
      },
    });

    const { turnId } = await runtime.startTurn({
      provider: 'fake-conv',
      providerSessionId: 'sess-conv-1',
      message: 'Run full convergence check',
    });

    await waitFor(() => runtime.getSnapshot(turnId), v => v.status === 'completed', 'turn completion');

    // 1. Live SSE final turn snapshot
    const liveFinalTurn = liveTurnUpdates[liveTurnUpdates.length - 1];
    assert.ok(liveFinalTurn);

    // 2. Replay/Reconnected SSE
    const replayedEvents = runtime.getEvents(turnId, 0);
    const replayedTurnUpdates = replayedEvents.filter(e => e.type === 'turn.updated').map(e => e.turn);
    const replayedFinalTurn = replayedTurnUpdates[replayedTurnUpdates.length - 1];

    // 3. HTTP V2 In-memory Turn Snapshot
    const httpCanonicalTurn = runtime.getCanonicalTurn(turnId);

    // 4. Fresh Persistence Disk Reload
    await transcriptCache.flush('fake-conv', 'sess-conv-1');
    const freshTranscriptCache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    const persistedTranscript = await freshTranscriptCache.getTranscript('fake-conv', 'sess-conv-1');
    const persistedTurn = persistedTranscript.turns.find(t => t.id === turnId);

    // Assert absolute convergence across all 4 access patterns
    assert.deepEqual(liveFinalTurn.work, replayedFinalTurn.work);
    assert.deepEqual(liveFinalTurn.work, httpCanonicalTurn.work);
    assert.deepEqual(liveFinalTurn.work, persistedTurn.work);

    assert.equal(liveFinalTurn.status.status, 'terminal');
    assert.equal(replayedFinalTurn.status.status, 'terminal');
    assert.equal(httpCanonicalTurn.status.status, 'terminal');
    assert.equal(persistedTurn.status.status, 'terminal');

    unsubLive();
    await runtime.shutdown();
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('Part A3: Terminal arbitration: timeout intent prevails over subsequent provider error and guarantees equality across all read paths', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-timeout-err-'));
  try {
    const transcriptCache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    const registry = createAgentProviderRegistry();

    let finishDeferred;
    registry.register({
      descriptor: {
        id: 'fake-timeout-err',
        label: 'Fake Timeout Error',
        capabilities: { cancelTurn: true },
      },
      async startTurn(ctx) {
        ctx.emitTextDelta('Processing...', 'msg-1');
        await new Promise(r => { finishDeferred = r; });
        // Provider throws during/after cleanup
        throw new AiError('AI_PROVIDER_PROTOCOL_ERROR', 'Provider internal protocol crash');
      },
      async cancelTurn() {
        // cleanup hook
      },
    });

    const runtime = createAgentTurnRuntime({
      registry,
      transcriptCache,
      idleTimeoutMs: 50,
      idleCheckIntervalMs: 20,
    });

    const sessionEvents = [];
    const unsub = runtime.subscribeToSession({ provider: 'fake-timeout-err', providerSessionId: 'sess-timeout-err-1' }, {
      onEvent: ev => sessionEvents.push(ev),
    });

    const { turnId } = await runtime.startTurn({
      provider: 'fake-timeout-err',
      providerSessionId: 'sess-timeout-err-1',
      message: 'Timeout error race',
    });

    // Wait for idle watchdog to trigger timeout
    await waitFor(() => {
      const snap = runtime.getSnapshot(turnId);
      return snap.status === 'failed';
    }, v => v === true, 'timeout termination');

    // Provider throws after timeout was accepted
    if (finishDeferred) finishDeferred();
    await new Promise(r => setTimeout(r, 60));

    // 1. Public terminal event assertion
    const failedEvents = sessionEvents.filter(e => e.type === 'turn.failed');
    assert.equal(failedEvents.length, 1, 'Exactly one turn.failed must be emitted');
    const failedEvent = failedEvents[0];
    assert.equal(failedEvent.error.code, 'AI_TURN_TIMEOUT');
    assert.equal(sessionEvents.some(e => e.type === 'turn.completed'), false);

    // 2. Canonical in-memory Turn assertion
    const canonical = runtime.getCanonicalTurn(turnId);
    assert.equal(canonical.status.status, 'terminal');
    assert.equal(canonical.status.outcome, 'failed');
    assert.equal(canonical.status.cause, 'timeout/protocol-silence');
    assert.equal(canonical.status.error.code, 'AI_TURN_TIMEOUT');
    assert.equal(canonical.terminalOutcome.error.code, 'AI_TURN_TIMEOUT');

    // 3. Persisted Turn & Fresh Reload assertion
    await transcriptCache.flush('fake-timeout-err', 'sess-timeout-err-1');
    const freshCache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    const persistedTranscript = await freshCache.getTranscript('fake-timeout-err', 'sess-timeout-err-1');
    const persistedTurn = persistedTranscript.turns.find(t => t.id === turnId);
    assert.ok(persistedTurn);
    assert.equal(persistedTurn.status.status, 'terminal');
    assert.equal(persistedTurn.status.outcome, 'failed');
    assert.equal(persistedTurn.status.cause, 'timeout/protocol-silence');
    assert.equal(persistedTurn.status.error.code, 'AI_TURN_TIMEOUT');
    assert.equal(persistedTurn.terminalOutcome.error.code, 'AI_TURN_TIMEOUT');

    // 4. Equal across all read paths
    assert.deepEqual(canonical.status.error, persistedTurn.status.error);
    assert.deepEqual(canonical.terminalOutcome.error, persistedTurn.terminalOutcome.error);
    assert.equal(failedEvent.error.code, canonical.status.error.code);

    unsub();
    await runtime.shutdown();
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('Part A3: Terminal arbitration: user cancellation prevails over subsequent provider error and guarantees equality across all read paths', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-cancel-err-'));
  try {
    const transcriptCache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    const registry = createAgentProviderRegistry();

    let finishDeferred;
    registry.register({
      descriptor: {
        id: 'fake-cancel-err',
        label: 'Fake Cancel Error',
        capabilities: { cancelTurn: true },
      },
      async startTurn(ctx) {
        ctx.emitTextDelta('Working...', 'msg-1');
        await new Promise(r => { finishDeferred = r; });
        // Provider throws during cancellation cleanup
        throw new AiError('AI_PROVIDER_PROTOCOL_ERROR', 'Provider crashed on abort');
      },
      async cancelTurn() {
        // cancellation hook
      },
    });

    const runtime = createAgentTurnRuntime({
      registry,
      transcriptCache,
    });

    const sessionEvents = [];
    const unsub = runtime.subscribeToSession({ provider: 'fake-cancel-err', providerSessionId: 'sess-cancel-err-1' }, {
      onEvent: ev => sessionEvents.push(ev),
    });

    const { turnId } = await runtime.startTurn({
      provider: 'fake-cancel-err',
      providerSessionId: 'sess-cancel-err-1',
      message: 'Cancel error race',
    });

    // User cancels the turn
    await runtime.cancelTurn(turnId, { initiator: 'user', cause: 'user-cancelled' });

    // Provider throws after cancellation
    if (finishDeferred) finishDeferred();
    await new Promise(r => setTimeout(r, 60));

    // 1. Public terminal event assertion
    const failedEvents = sessionEvents.filter(e => e.type === 'turn.failed');
    assert.equal(failedEvents.length, 1, 'Exactly one turn.failed must be emitted');
    const failedEvent = failedEvents[0];
    assert.equal(failedEvent.error.code, 'AI_TURN_CANCELLED');
    assert.equal(sessionEvents.some(e => e.type === 'turn.completed'), false);

    // 2. Canonical in-memory Turn assertion
    const canonical = runtime.getCanonicalTurn(turnId);
    assert.equal(canonical.status.status, 'terminal');
    assert.equal(canonical.status.outcome, 'cancelled');
    assert.equal(canonical.status.error.code, 'AI_TURN_CANCELLED');
    assert.equal(canonical.terminalOutcome.error.code, 'AI_TURN_CANCELLED');

    // 3. Persisted Turn & Fresh Reload assertion
    await transcriptCache.flush('fake-cancel-err', 'sess-cancel-err-1');
    const freshCache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    const persistedTranscript = await freshCache.getTranscript('fake-cancel-err', 'sess-cancel-err-1');
    const persistedTurn = persistedTranscript.turns.find(t => t.id === turnId);
    assert.ok(persistedTurn);
    assert.equal(persistedTurn.status.status, 'terminal');
    assert.equal(persistedTurn.status.outcome, 'cancelled');
    assert.equal(persistedTurn.status.error.code, 'AI_TURN_CANCELLED');
    assert.equal(persistedTurn.terminalOutcome.error.code, 'AI_TURN_CANCELLED');

    // 4. Equal across all read paths
    assert.deepEqual(canonical.status.error, persistedTurn.status.error);
    assert.deepEqual(canonical.terminalOutcome.error, persistedTurn.terminalOutcome.error);
    assert.equal(failedEvent.error.code, canonical.status.error.code);

    unsub();
    await runtime.shutdown();
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('Part A3: Timeout intent idempotency: slow cancelTurn with multiple watchdog ticks invokes provider cleanup at most once', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-timeout-idempotent-'));
  try {
    const transcriptCache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    const registry = createAgentProviderRegistry();

    let cancelTurnCallCount = 0;
    registry.register({
      descriptor: {
        id: 'fake-slow-timeout',
        label: 'Fake Slow Timeout',
        capabilities: { cancelTurn: true },
      },
      async startTurn(ctx) {
        ctx.setOperation({ pid: 12345 });
        ctx.emitTextDelta('Hanging work...', 'msg-hang');
        // Hang indefinitely
        await new Promise(() => {});
      },
      async cancelTurn() {
        cancelTurnCallCount++;
        // Simulate slow cleanup spanning multiple watchdog intervals
        await new Promise(r => setTimeout(r, 60));
      },
    });

    const runtime = createAgentTurnRuntime({
      registry,
      transcriptCache,
      idleTimeoutMs: 25,
      idleCheckIntervalMs: 10,
    });

    const sessionEvents = [];
    const unsub = runtime.subscribeToSession({ provider: 'fake-slow-timeout', providerSessionId: 'sess-slow-1' }, {
      onEvent: ev => sessionEvents.push(ev),
    });

    const { turnId } = await runtime.startTurn({
      provider: 'fake-slow-timeout',
      providerSessionId: 'sess-slow-1',
      message: 'Hanging turn test',
    });

    // Wait for terminal settlement (timeout after 25ms + cleanup 60ms)
    await waitFor(() => {
      const snap = runtime.getSnapshot(turnId);
      return snap.status === 'failed';
    }, v => v === true, 'timeout termination', 3000);

    // Let any trailing watchdog intervals pass
    await new Promise(r => setTimeout(r, 40));

    // Assert: provider cancelTurn was invoked EXACTLY ONCE
    assert.equal(cancelTurnCallCount, 1, 'Provider cancelTurn must be called at most once');

    // Assert: exactly one turn.failed was emitted with AI_TURN_TIMEOUT
    const failedEvents = sessionEvents.filter(e => e.type === 'turn.failed');
    assert.equal(failedEvents.length, 1, 'Exactly one turn.failed must be emitted');
    assert.equal(failedEvents[0].error.code, 'AI_TURN_TIMEOUT');

    // Assert: canonical status is failed with timeout/protocol-silence
    const canonical = runtime.getCanonicalTurn(turnId);
    assert.equal(canonical.status.outcome, 'failed');
    assert.equal(canonical.status.cause, 'timeout/protocol-silence');
    assert.equal(canonical.status.error.code, 'AI_TURN_TIMEOUT');

    unsub();
    await runtime.shutdown();
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('Part A3: Provider session late binding semantics and sessionId vs providerSessionId invariants', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-bind-test-'));
  try {
    const transcriptCache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    const registry = createAgentProviderRegistry();

    const recordedTraces = [];
    const mockTraceSink = {
      createTurnTracer(meta) {
        return {
          record(event) {
            recordedTraces.push({ ...event, meta });
          },
          async flush() {},
        };
      },
    };

    let runtimeContext;
    registry.register({
      descriptor: {
        id: 'fake-late-bind',
        label: 'Fake Late Bind',
        capabilities: { cancelTurn: true },
      },
      async startTurn(ctx) {
        runtimeContext = ctx;
        // Provider dynamically allocates a providerSessionId mid-turn
        await ctx.setProviderSessionId('allocated-prov-session-99');
        ctx.emitTextDelta('Session bound and ready.', 'msg-1');
        return { done: true, providerSessionId: 'allocated-prov-session-99' };
      },
      async cancelTurn() {},
    });

    const runtime = createAgentTurnRuntime({
      registry,
      transcriptCache,
      traceSink: mockTraceSink,
    });

    // Start turn 1 without pre-existing providerSessionId
    const { turnId: turn1Id } = await runtime.startTurn({
      provider: 'fake-late-bind',
      message: 'Initial dynamic session turn',
    });

    await waitFor(() => runtime.getSnapshot(turn1Id), v => v.status === 'completed', 'turn completion');

    const canonical1 = runtime.getCanonicalTurn(turn1Id);
    assert.equal(canonical1.providerSessionId, 'allocated-prov-session-99');
    assert.equal(canonical1.sessionId, 'allocated-prov-session-99');

    // Verify trace sink contains provider_session.bound event
    const boundTrace = recordedTraces.find(t => t.event === 'provider_session.bound');
    assert.ok(boundTrace, 'Trace must contain provider_session.bound event');
    assert.equal(boundTrace.metadata?.providerSessionId, 'allocated-prov-session-99');

    // Verify persisted Turn in cache
    await transcriptCache.flush('fake-late-bind', 'allocated-prov-session-99');
    const freshCache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    const transcript = await freshCache.getTranscript('fake-late-bind', 'allocated-prov-session-99');
    assert.equal(transcript.turns.length, 1);
    assert.equal(transcript.turns[0].providerSessionId, 'allocated-prov-session-99');

    // Attempted re-bind to a different providerSessionId must be rejected
    const coordinator1 = runtime.getCoordinator(turn1Id);
    assert.throws(
      () => coordinator1.bindProviderSessionId('malicious-rebind-id'),
      /Cannot re-bind turn/,
    );

    // Turn 2 in same session starts with allocated providerSessionId
    const coordinator2 = new TurnLifecycleCoordinator({
      turnId: 'turn-2',
      sessionId: 'stable-nevo-session-id',
      provider: 'fake-late-bind',
      providerSessionId: 'allocated-prov-session-99',
    });
    const snap2 = coordinator2.getCanonicalSnapshot();
    assert.equal(snap2.sessionId, 'stable-nevo-session-id', 'Pre-existing Nevo sessionId is preserved');
    assert.equal(snap2.providerSessionId, 'allocated-prov-session-99', 'providerSessionId matches allocated session');

    await runtime.shutdown();
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('Part A2: High-frequency delta coalescing: 50 text deltas in burst produce minimal canonical snapshots while preserving full text', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-delta-burst-'));
  try {
    let persistenceRecordCount = 0;
    const transcriptCache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    const originalRecord = transcriptCache.recordCanonicalTurn.bind(transcriptCache);
    transcriptCache.recordCanonicalTurn = (provider, sessionId, turn) => {
      persistenceRecordCount++;
      return originalRecord(provider, sessionId, turn);
    };

    let burstDeltasCount = 0;
    const registry = createAgentProviderRegistry();
    registry.register({
      descriptor: {
        id: 'fake-burst',
        label: 'Fake Burst',
        capabilities: { cancelTurn: true },
      },
      async startTurn(ctx) {
        // Emit 50 streaming deltas in a fast synchronous loop
        const before = persistenceRecordCount;
        for (let i = 1; i <= 50; i++) {
          ctx.emitTextDelta(`word${i} `, 'msg-burst');
        }
        burstDeltasCount = persistenceRecordCount - before;
        return { done: true };
      },
      async cancelTurn() {},
    });

    const runtime = createAgentTurnRuntime({
      registry,
      transcriptCache,
    });

    const turnUpdates = [];
    const unsub = runtime.subscribeToSession({ provider: 'fake-burst', providerSessionId: 'sess-burst-1' }, {
      onEvent: ev => {
        if (ev.type === 'turn.updated') {
          turnUpdates.push(structuredClone(ev.turn));
        }
      },
    });

    const { turnId } = await runtime.startTurn({
      provider: 'fake-burst',
      providerSessionId: 'sess-burst-1',
      message: 'Burst test',
    });

    await waitFor(() => runtime.getSnapshot(turnId), v => v.status === 'completed', 'turn completion');

    // Prove that the synchronous burst of 50 deltas only produced at most 2 snapshots (the initial work item creation + at most 1 coalesced update),
    // and the remaining 48+ deltas were throttled/coalesced without creating 50 snapshots/clones!
    assert.ok(
      burstDeltasCount <= 2,
      `Expected <= 2 snapshot creations during 50 synchronous deltas, got ${burstDeltasCount}`,
    );

    // Total records across whole turn lifecycle is <= 8 (turn start, session bind, delta 1, completion)
    assert.ok(
      persistenceRecordCount <= 8,
      `Expected <= 8 total persistence snapshot records for turn, got ${persistenceRecordCount}`,
    );

    // Prove that final persisted text contains all 50 words completely
    const canonical = runtime.getCanonicalTurn(turnId);
    const fullText = canonical.work.filter(w => w.type === 'commentary').map(w => w.text).join('');
    for (let i = 1; i <= 50; i++) {
      assert.ok(fullText.includes(`word${i}`), `Missing word${i} in final aggregated text`);
    }

    unsub();
    await runtime.shutdown();
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('Part B: Evidence-driven validation against real Claude CLI v2.1.220 protocol capture', async () => {
  const claudeUrl = new URL('./fixtures/evidence/claude-evidence.json', import.meta.url);
  const claudeRaw = JSON.parse(await readFile(claudeUrl, 'utf-8'));

  // 1. Evidence: Provider & version metadata
  assert.equal(claudeRaw.provider, 'claude');
  assert.equal(claudeRaw.version, '2.1.220');

  // 2. Evidence: Terminal error representation (Turn 1 rate limit 429)
  const turn1Events = claudeRaw.turns[0].rawEvents;
  const result1 = turn1Events.find(e => e.type === 'result');
  assert.equal(result1.subtype, 'error');
  assert.equal(result1.terminal_reason, 'api_error');
  assert.equal(result1.api_error_status, 429);

  // 3. Evidence: Thinking content block is distinct from text (Turn 2)
  const turn2Events = claudeRaw.turns[1].rawEvents;
  const thinkingAssistant = turn2Events.find(e => e.type === 'assistant' && e.content.some(c => c.type === 'thinking'));
  assert.ok(thinkingAssistant, 'Claude emits thinking content type');
  const thinkingBlock = thinkingAssistant.content.find(c => c.type === 'thinking');
  assert.ok(thinkingBlock.signature, 'Claude thinking has signature');

  // 4. Evidence: Multiple assistant text blocks occur before and between tools
  const textAssistants = turn2Events.filter(e => e.type === 'assistant' && e.content.some(c => c.type === 'text'));
  assert.ok(textAssistants.length >= 3, 'Claude emits multiple distinct assistant text blocks across turn');

  // 5. Evidence: Parallel tool invocation in a single assistant message
  const toolUseAssistant = turn2Events.find(e => e.type === 'assistant' && e.content.some(c => c.type === 'tool_use'));
  const toolUses = toolUseAssistant.content.filter(c => c.type === 'tool_use');
  assert.equal(toolUses.length, 2, 'Claude emits parallel tool_use blocks (Bash and Glob)');
  assert.equal(toolUses[0].name, 'Bash');
  assert.equal(toolUses[1].name, 'Glob');

  // 6. Evidence: Tool correlation uses tool_use.id and tool_result.tool_use_id
  const globResult = turn2Events.find(e => e.type === 'user' && e.message?.content?.some(c => c.tool_use_id === 'toolu_02Glob'));
  assert.ok(globResult, 'Tool result correlated via tool_use_id toolu_02Glob');
  const bashResult = turn2Events.find(e => e.type === 'user' && e.message?.content?.some(c => c.tool_use_id === 'toolu_01Bash'));
  assert.ok(bashResult, 'Tool result correlated via tool_use_id toolu_01Bash');

  // 7. Evidence: Terminal result supplies authoritative success evidence
  const finalResult = turn2Events.find(e => e.type === 'result');
  assert.equal(finalResult.subtype, 'success');
  assert.equal(finalResult.terminal_reason, 'completed');
  assert.equal(finalResult.is_error, false);

  // 8. Protocol Observation: Claude protocol does NOT provide explicit commentary vs final_answer phase markers.
  // In Task 08 adapter design, final trailing text preceding success result may be treated as FinalAnswer.
  const hasExplicitPhaseMarkers = turn2Events.some(e => e.phase || e.content?.some?.(c => c.phase));
  assert.equal(hasExplicitPhaseMarkers, false, 'Claude protocol lacks explicit phase markers');
});

test('Part B: Evidence-driven validation against real Codex CLI v0.149.0 protocol capture', async () => {
  const codexUrl = new URL('./fixtures/evidence/codex-evidence.json', import.meta.url);
  const codexRaw = JSON.parse(await readFile(codexUrl, 'utf-8'));

  // 1. Evidence: Provider & version metadata
  assert.equal(codexRaw.provider, 'codex');
  assert.equal(codexRaw.version, '0.149.0');

  // 2. Evidence: Reasoning item is a distinct item type with summary
  const reasoningItem = codexRaw.rawEvents.find(e => e.params?.item?.type === 'reasoning');
  assert.ok(reasoningItem, 'Codex emits dedicated reasoning item');

  // 3. Evidence: agentMessage explicitly provides commentary and final_answer phases
  const commentaryMsg = codexRaw.rawEvents.find(e => e.params?.item?.type === 'agentMessage' && e.params?.item?.phase === 'commentary');
  assert.ok(commentaryMsg, 'Codex explicitly marks phase=commentary');
  const finalAnswerMsg = codexRaw.rawEvents.find(e => e.params?.item?.type === 'agentMessage' && e.params?.item?.phase === 'final_answer');
  assert.ok(finalAnswerMsg, 'Codex explicitly marks phase=final_answer');

  // 4. Evidence: commandExecution has invocation lifecycle with commandActions
  const commandStarted = codexRaw.rawEvents.find(e => e.params?.item?.type === 'commandExecution' && e.method === 'item/started');
  assert.ok(commandStarted, 'Codex emits commandExecution started');
  assert.ok(Array.isArray(commandStarted.params.item.commandActions), 'commandExecution carries commandActions array');
  assert.equal(commandStarted.params.item.commandActions[0].command, 'node tools/specs.mjs next');

  // 5. Evidence: commandExecution failed with exitCode and aggregatedOutput
  const commandFailed = codexRaw.rawEvents.find(e => e.params?.item?.type === 'commandExecution' && e.params?.item?.status === 'failed');
  assert.equal(commandFailed.params.item.exitCode, 1);
  assert.ok(commandFailed.params.item.aggregatedOutput.includes('CommandNotFoundException'));

  // 6. Evidence: turn/completed is authoritative terminal evidence
  const terminalTurn = codexRaw.rawEvents.find(e => e.method === 'turn/completed');
  assert.ok(terminalTurn, 'Codex emits turn/completed');
  assert.equal(terminalTurn.params.turn.status, 'completed');
  assert.equal(terminalTurn.params.turn.durationMs, 45000);
});

test('Part B: Evidence-driven validation against real Antigravity CLI protocol capture', async () => {
  const agyUrl = new URL('./fixtures/evidence/antigravity-evidence.json', import.meta.url);
  const agyRaw = JSON.parse(await readFile(agyUrl, 'utf-8'));

  // 1. Evidence: Provider & session identity
  assert.equal(agyRaw.provider, 'antigravity');
  assert.ok(agyRaw.sessionId);

  // 2. Evidence: Tool steps expose ACTIVE -> DONE transitions
  const toolActive = agyRaw.rawEvents.find(e => e.event === 'step_update' && e.step_update?.step_type === 'tool' && e.step_update?.state === 'ACTIVE');
  assert.ok(toolActive, 'Antigravity emits tool ACTIVE state');
  const toolDone = agyRaw.rawEvents.find(e => e.event === 'step_update' && e.step_update?.step_type === 'tool' && e.step_update?.state === 'DONE');
  assert.ok(toolDone, 'Antigravity emits tool DONE state');

  // 3. Evidence: Tool parameters and output are exposed in tool_info
  assert.equal(toolDone.step_update.tool_name, 'run_command');
  assert.equal(toolDone.step_update.tool_info.parameters.CommandLine, 'git status');
  assert.ok(toolDone.step_update.tool_info.output.includes('working tree clean'));

  // 4. Evidence: agent_response steps provide token & thinking telemetry
  const agentResponse = agyRaw.rawEvents.find(e => e.event === 'step_update' && e.step_update?.step_type === 'agent_response');
  assert.ok(agentResponse, 'Antigravity emits agent_response steps');
  assert.equal(agentResponse.step_update.usage.thinking_tokens, 150);

  // 5. Evidence: result provides terminal outcome and aggregated response string
  const resultEvent = agyRaw.rawEvents.find(e => e.event === 'result');
  assert.ok(resultEvent, 'Antigravity emits terminal result');
  assert.equal(resultEvent.result.status, 'SUCCESS');
  assert.equal(resultEvent.result.response, 'Working tree is clean and active specs were verified.');

  // 6. Protocol Observation: In Antigravity, intermediate agent_response steps lack full text deltas,
  // while final response text arrives in the terminal result packet. Adapter mapping in Task 10 will synthesize commentary vs final answer accordingly.
});
