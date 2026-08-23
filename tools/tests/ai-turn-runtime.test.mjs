import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { createAiAdapterRegistry } from '../ai/registry.mjs';
import { createAiTurnRuntime } from '../ai/turn-runtime.mjs';
import { createTranscriptCacheService } from '../ai/transcript-cache.mjs';
import { AntigravityAgentProvider } from '../ai/antigravity-adapter.mjs';


const capabilities = Object.freeze({
  interactivePermissions: true,
  interactiveQuestions: true,
  interactiveConfirmations: true,
  resumeSession: true,
  cancelTurn: true,
  toolCalls: true,
  reasoning: true,
  usage: true,
});

function createFixture({ sessionLookupGate, transcriptCache, runtimeOptions } = {}) {
  const cache = transcriptCache ?? createTranscriptCacheService({ baseDir: join(tmpdir(), `nevo-test-cache-${randomUUID()}`) });
  let starts = 0;
  let cancels = 0;
  let continuations = 0;
  const adapter = {
    descriptor: { id: 'fake', label: 'Fake', capabilities },
    async startTurn({ providerSessionId, setProviderSessionId, message, setOperation, emitDelta, emitTextDelta, emitReasoningDelta, emitToolStarted, emitToolCompleted, emitUsageUpdated, signal }) {
      if (!providerSessionId && setProviderSessionId) {
        setProviderSessionId('sess-auto-allocated');
      }
      setOperation?.({ cancelled: false });

      if (sessionLookupGate) await sessionLookupGate;
      starts += 1;
      emitDelta('one ');
      if (message === 'permission') {
        return {
          isDeferred: true,
          interaction: { id: `int-perm-${starts}`, kind: 'permission', toolName: 'Shell', input: { command: 'npm test' } },
        };
      } else if (message === 'question') {
        return {
          isDeferred: true,
          interaction: { id: `int-q-${starts}`, kind: 'question', questions: [{ id: 'q-1', question: 'Same?' }, { id: 'q-2', question: 'Same?' }] },
        };
      } else if (message === 'tools-and-reasoning') {
        emitReasoningDelta('thinking...');
        emitToolStarted({ toolId: 't1', toolName: 'ReadDir', input: { path: '.' } });
        emitToolCompleted({ toolId: 't1', output: ['file.txt'], durationMs: 40, status: 'completed' });
        emitUsageUpdated({ tokensIn: 50, tokensOut: 20 });
      } else if (message === 'lingering-tool') {
        // owner-decisions.md D6, required scenario 17: a turn reaching normal
        // turn.completed while a different tool call in the same turn is still
        // 'running' and never received a real successful terminal signal.
        emitToolStarted({ toolId: 't1', toolName: 'Read', input: { path: 'a.ts' } });
        emitToolStarted({ toolId: 't2', toolName: 'Bash', input: { command: 'slow' } });
        emitToolCompleted({ toolId: 't1', output: 'ok', status: 'completed' });
        // t2 never receives its own tool.completed — the turn still ends normally below.
      } else if (message === 'fail-with-tool') {
        // owner-decisions.md D6, required scenario 16: turn-level failure with an active tool.
        emitToolStarted({ toolId: 't1', toolName: 'Bash', input: { command: 'boom' } });
        throw new Error('adapter failure mid-tool');
      } else if (message === 'hang') {
        await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
      } else if (message === 'slow-drip') {
        for (let i = 0; i < 4; i += 1) {
          await new Promise(resolve => setTimeout(resolve, 15));
          emitDelta(`chunk${i} `);
        }
      }
      emitDelta('two');
    },
    async respondInteraction({ interaction, response, emitDelta }) {
      continuations += 1;
      if (interaction?.kind === 'permission') {
        emitDelta(response.decision);
      } else if (interaction?.kind === 'question') {
        emitDelta(response.answers.map(a => a.value).join(','));
      }
      emitDelta('two');
    },
    async cancelTurn() { cancels += 1; },
  };
  let id = 0;
  const registry = createAiAdapterRegistry([adapter]);
  const runtime = createAiTurnRuntime({
    registry,
    transcriptCache: cache,
    idFactory: () => String(++id),
    clock: (() => { let tick = 0; return () => new Date(Date.UTC(2026, 7, 15, 10, 0, tick++)); })(),
    idleTimeoutMs: 0,
    ...runtimeOptions,
  });
  return {
    runtime,
    transcriptCache: cache,
    registry,
    get starts() { return starts; },
    get cancels() { return cancels; },
    get continuations() { return continuations; },
  };
}


async function waitFor(read, predicate, message = 'condition') {
  for (let index = 0; index < 100; index += 1) {
    const value = read();
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  assert.fail(`Timed out waiting for ${message}.`);
}

test('turns stream ordered deltas (text.delta) and complete with terminal snapshot', async () => {
  const fixture = createFixture();
  const { turnId } = await fixture.runtime.startTurn({ provider: 'fake', providerSessionId: 's1', message: 'normal' });
  const snapshot = await waitFor(() => fixture.runtime.getSnapshot(turnId), value => value.status === 'completed', 'completion');
  assert.deepEqual(snapshot.events.map(event => event.type), ['turn.started', 'text.delta', 'text.delta', 'turn.completed']);
  assert.deepEqual(snapshot.events.map(event => event.id), [1, 2, 3, 4]);
  assert.equal(snapshot.providerSessionId, 's1');
  assert.equal(snapshot.sessionId, undefined);
});

test('runtime rejects legacy sessionId and enforces canonical providerSessionId', async () => {
  const fixture = createFixture();
  await assert.rejects(
    () => fixture.runtime.startTurn({ provider: 'fake', sessionId: 'legacy-only', message: 'hello' }),
    { name: 'AiValidationError' },
  );
});

test('permission and question interactions pause, resolve by stable IDs, and continue the same turn', async () => {
  const fixture = createFixture();
  const permission = await fixture.runtime.startTurn({ provider: 'fake', providerSessionId: 'permission', message: 'permission' });
  const paused = await waitFor(() => fixture.runtime.getSnapshot(permission.turnId), value => value.pendingInteraction, 'permission');
  assert.equal(paused.status, 'waitingForUser');
  await fixture.runtime.resolveInteraction(permission.turnId, paused.pendingInteraction.id, { decision: 'allow' });
  const completed = await waitFor(() => fixture.runtime.getSnapshot(permission.turnId), value => value.status === 'completed', 'permission completion');
  assert.equal(completed.events.filter(event => event.type === 'turn.started').length, 1);
  assert.equal(fixture.continuations, 1);

  const question = await fixture.runtime.startTurn({ provider: 'fake', providerSessionId: 'question', message: 'question' });
  const asked = await waitFor(() => fixture.runtime.getSnapshot(question.turnId), value => value.pendingInteraction, 'question');
  const [first, second] = asked.pendingInteraction.questions;
  assert.notEqual(first.id, second.id);
  await assert.rejects(() => fixture.runtime.resolveInteraction(question.turnId, asked.pendingInteraction.id, {
    answers: [{ questionId: first.id, value: 'A' }, { questionId: 'Same?', value: 'B' }],
  }), { name: 'AiValidationError' });
  await fixture.runtime.resolveInteraction(question.turnId, asked.pendingInteraction.id, {
    answers: [{ questionId: first.id, value: 'A' }, { questionId: second.id, value: 'B' }],
  });
  await waitFor(() => fixture.runtime.getSnapshot(question.turnId), value => value.status === 'completed', 'question completion');
  assert.equal(fixture.continuations, 2);
});

test('duplicate, unknown, and cross-turn responses cannot resolve another request', async () => {
  const fixture = createFixture();
  const first = await fixture.runtime.startTurn({ provider: 'fake', providerSessionId: 'first', message: 'permission' });
  const second = await fixture.runtime.startTurn({ provider: 'fake', providerSessionId: 'second', message: 'permission' });
  const one = await waitFor(() => fixture.runtime.getSnapshot(first.turnId), value => value.pendingInteraction, 'first pending');
  const two = await waitFor(() => fixture.runtime.getSnapshot(second.turnId), value => value.pendingInteraction, 'second pending');
  await assert.rejects(() => fixture.runtime.resolveInteraction(first.turnId, two.pendingInteraction.id, { decision: 'allow' }), { name: 'AiNotFoundError' });
  await fixture.runtime.resolveInteraction(first.turnId, one.pendingInteraction.id, { decision: 'deny' });
  await assert.rejects(() => fixture.runtime.resolveInteraction(first.turnId, one.pendingInteraction.id, { decision: 'deny' }), { name: 'AiNotFoundError' });
  fixture.runtime.shutdown();
});

test('reconstitutes pending interaction from transcript cache across runtime restart with session correlation', async () => {
  const fixture = createFixture();
  const turn = await fixture.runtime.startTurn({ provider: 'fake', providerSessionId: 'restart-session', message: 'permission' });
  const pending = await waitFor(() => fixture.runtime.getSnapshot(turn.turnId), v => v.pendingInteraction, 'pending before restart');
  assert.equal(pending.status, 'waitingForUser');

  // Shutdown first runtime without destroying transcriptCache
  fixture.runtime.shutdown();

  // Create fresh runtime with same transcriptCache
  const { createAiTurnRuntime } = await import('../ai/turn-runtime.mjs');
  const runtime2 = createAiTurnRuntime({ registry: fixture.registry, transcriptCache: fixture.transcriptCache });

  // 1. Cross-session resolution attempt is rejected
  await assert.rejects(
    () => runtime2.resolveInteraction(turn.turnId, pending.pendingInteraction.id, { decision: 'allow' }, { provider: 'fake', providerSessionId: 'other-session' }),
    { name: 'AiNotFoundError' },
  );

  // 2. Wrong interaction ID is rejected
  await assert.rejects(
    () => runtime2.resolveInteraction(turn.turnId, 'wrong-interaction-id', { decision: 'allow' }, { provider: 'fake', providerSessionId: 'restart-session' }),
    { name: 'AiNotFoundError' },
  );

  // 3. Valid resolution reconstitutes turn and completes
  await runtime2.resolveInteraction(turn.turnId, pending.pendingInteraction.id, { decision: 'allow' }, { provider: 'fake', providerSessionId: 'restart-session' });
  const completed = await waitFor(() => runtime2.getSnapshot(turn.turnId), v => v.status === 'completed', 'completion after restart');
  assert.equal(completed.status, 'completed');
  runtime2.shutdown();
});

test('session-wide monotonic sequence numbering across multiple turns', async () => {
  const fixture = createFixture();
  const sessionIdentity = { provider: 'fake', providerSessionId: 'sess-monotonic' };

  // Turn 1
  const turn1 = await fixture.runtime.startTurn({ ...sessionIdentity, message: 'normal' });
  const snap1 = await waitFor(() => fixture.runtime.getSnapshot(turn1.turnId), v => v.status === 'completed');
  assert.deepEqual(snap1.events.map(e => e.seq), [1, 2, 3, 4]);

  // Turn 2
  const turn2 = await fixture.runtime.startTurn({ ...sessionIdentity, message: 'normal' });
  const snap2 = await waitFor(() => fixture.runtime.getSnapshot(turn2.turnId), v => v.status === 'completed');
  assert.deepEqual(snap2.events.map(e => e.seq), [5, 6, 7, 8]);
});

test('session-scoped subscription receives events across turns with monotonic sequence', async () => {
  const fixture = createFixture();
  const sessionIdentity = { provider: 'fake', providerSessionId: 'sess-sub' };
  const sessionEvents = [];

  const unsub = fixture.runtime.subscribeToSession(sessionIdentity, {
    onEvent: ev => sessionEvents.push(ev),
  });

  const turn1 = await fixture.runtime.startTurn({ ...sessionIdentity, message: 'normal' });
  await waitFor(() => fixture.runtime.getSnapshot(turn1.turnId), v => v.status === 'completed');

  const turn2 = await fixture.runtime.startTurn({ ...sessionIdentity, message: 'normal' });
  await waitFor(() => fixture.runtime.getSnapshot(turn2.turnId), v => v.status === 'completed');

  assert.equal(sessionEvents.length, 8);
  assert.deepEqual(sessionEvents.map(e => e.seq), [1, 2, 3, 4, 5, 6, 7, 8]);
  unsub();
});

test('reconstruction after restart preserves session sequence from transcript cache lastEventSeq', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-restart-seq-'));
  try {
    const transcriptCache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    const fixture1 = createFixture({ transcriptCache });

    // Run turn 1 on runtime 1
    const turn1 = await fixture1.runtime.startTurn({ provider: 'fake', providerSessionId: 'sess-restart', message: 'normal' });
    await waitFor(() => fixture1.runtime.getSnapshot(turn1.turnId), v => v.status === 'completed');
    await transcriptCache.flush('fake', 'sess-restart');

    const transcript = await transcriptCache.getTranscript('fake', 'sess-restart');
    assert.equal(transcript.lastEventSeq, 4);

    // Reconstruct runtime 2 (simulating server restart)
    const fixture2 = createFixture({ transcriptCache });
    const turn2 = await fixture2.runtime.startTurn({ provider: 'fake', providerSessionId: 'sess-restart', message: 'normal' });
    const snap2 = await waitFor(() => fixture2.runtime.getSnapshot(turn2.turnId), v => v.status === 'completed');

    // Sequence must continue at 5, 6, 7, 8
    assert.deepEqual(snap2.events.map(e => e.seq), [5, 6, 7, 8]);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('cancellation while in waitingForUser transitions to failed without process kill', async () => {
  const fixture = createFixture();
  const { turnId } = await fixture.runtime.startTurn({ provider: 'fake', providerSessionId: 'cancel-waiting', message: 'permission' });
  await waitFor(() => fixture.runtime.getSnapshot(turnId), v => v.status === 'waitingForUser');

  const snap = await fixture.runtime.cancelTurn(turnId);
  assert.equal(snap.status, 'failed');
  assert.equal(snap.pendingInteraction, null);
  assert.equal(fixture.cancels, 0); // No child process was live to kill
});

test('explicit cancellation of running turn is capability-aware and produces one terminal event', async () => {
  const fixture = createFixture();
  const { turnId } = await fixture.runtime.startTurn({ provider: 'fake', providerSessionId: 'cancel', message: 'hang' });
  await waitFor(() => fixture.runtime.getSnapshot(turnId), value => value.events.length >= 2, 'started turn');
  const snapshot = await fixture.runtime.cancelTurn(turnId);
  assert.equal(fixture.cancels, 1);
  assert.equal(snapshot.events.filter(event => event.type === 'turn.failed').length, 1);
  await fixture.runtime.cancelTurn(turnId);
  assert.equal(fixture.cancels, 1);
});

test('shutdown interrupts active turns without losing session identity', async () => {
  const fixture = createFixture();
  const { turnId } = await fixture.runtime.startTurn({ provider: 'fake', providerSessionId: 'shutdown', message: 'hang' });
  await waitFor(() => fixture.runtime.getSnapshot(turnId), value => value.events.length >= 2, 'running turn');
  fixture.runtime.shutdown();
  const snapshot = fixture.runtime.getSnapshot(turnId);
  assert.equal(snapshot.status, 'failed');
  assert.equal(snapshot.providerSessionId, 'shutdown');
  assert.equal(snapshot.sessionId, undefined);
  assert.equal(snapshot.events.at(-1).error.code, 'AI_TURN_INTERRUPTED');
  assert.equal(fixture.cancels, 0);
});

test('single-active-turn invariant rejects duplicates and honors a matching idempotency retry', async () => {
  const fixture = createFixture();
  const first = await fixture.runtime.startTurn({ provider: 'fake', providerSessionId: 'locked', message: 'hang', idempotencyKey: 'request-1' });
  const retry = await fixture.runtime.startTurn({ provider: 'fake', providerSessionId: 'locked', message: 'hang', idempotencyKey: 'request-1' });
  assert.deepEqual(retry, { turnId: first.turnId, idempotent: true });
  await assert.rejects(() => fixture.runtime.startTurn({ provider: 'fake', providerSessionId: 'locked', message: 'hang', idempotencyKey: 'request-2' }), error => {
    assert.equal(error.code, 'AI_TURN_CONFLICT');
    assert.equal(error.turnId, first.turnId);
    return true;
  });
  assert.equal(fixture.starts, 1);
  fixture.runtime.shutdown();
});

test('concurrent starts for one session invoke the adapter only once', async () => {
  let releaseLookup;
  const sessionLookupGate = new Promise(resolve => { releaseLookup = resolve; });
  const fixture = createFixture({ sessionLookupGate });
  const starts = [
    fixture.runtime.startTurn({ provider: 'fake', providerSessionId: 'concurrent', message: 'hang', idempotencyKey: 'request-1' }),
    fixture.runtime.startTurn({ provider: 'fake', providerSessionId: 'concurrent', message: 'hang', idempotencyKey: 'request-2' }),
  ];
  const allSettledPromise = Promise.allSettled(starts);

  await new Promise(resolve => setImmediate(resolve));
  releaseLookup();
  const results = await allSettledPromise;

  const fulfilled = results.filter(result => result.status === 'fulfilled');
  const rejected = results.filter(result => result.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, 'AI_TURN_CONFLICT');
  assert.equal(rejected[0].reason.turnId, fulfilled[0].value.turnId);
  assert.equal(fixture.starts, 1);
  fixture.runtime.shutdown();
});

test('transcript caching persists messages, tool invocations, reasoning, and preserves lastEventSeq invariant', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-transcript-test-'));
  try {
    const transcriptCache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    const fixture = createFixture({ transcriptCache });

    const { turnId } = await fixture.runtime.startTurn({
      provider: 'fake',
      providerSessionId: 'sess-cache-test',
      message: 'tools-and-reasoning',
    });

    await waitFor(() => fixture.runtime.getSnapshot(turnId), value => value.status === 'completed', 'turn completion');

    const transcript = await transcriptCache.getTranscript('fake', 'sess-cache-test');
    assert.equal(transcript.provider, 'fake');
    assert.equal(transcript.providerSessionId, 'sess-cache-test');
    assert.equal(transcript.messages.length >= 2, true); // user + assistant

    const userMsg = transcript.messages[0];
    assert.equal(userMsg.role, 'user');
    assert.equal(userMsg.text, 'tools-and-reasoning');

    const assistantMsg = transcript.messages[1];
    assert.equal(assistantMsg.role, 'assistant');
    assert.equal(assistantMsg.reasoning, 'thinking...');
    assert.equal(assistantMsg.text, 'one two');
    assert.equal(assistantMsg.toolCalls?.length, 1);
    assert.equal(assistantMsg.toolCalls[0].name, 'ReadDir');
    assert.equal(assistantMsg.toolCalls[0].status, 'completed');

    // Invariant check: lastEventSeq matches highest sequence
    assert.equal(transcript.lastEventSeq > 0, true);
    assert.equal(transcript.lastEventSeq, 8);
    const snapshot = fixture.runtime.getSnapshot(turnId);
    assert.equal(transcript.lastEventSeq, snapshot.lastEventId);
  } finally {
    await new Promise(r => setTimeout(r, 25));
    await rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

// owner-decisions.md D6, required scenario 17: a turn reaching normal turn.completed
// while a different tool call in the same turn is still 'running' resolves that tool to
// 'failed', not 'completed' — a successful turn outcome is not evidence every lingering
// tool succeeded. Also covers required scenario 18 (live projection and a
// persisted/reloaded transcript agree) for this specific case.
test('a tool still running when its turn reaches normal turn.completed resolves to failed, live and after reload', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-lingering-tool-test-'));
  try {
    const transcriptCache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    const fixture = createFixture({ transcriptCache });

    const { turnId } = await fixture.runtime.startTurn({
      provider: 'fake',
      providerSessionId: 'sess-lingering-tool',
      message: 'lingering-tool',
    });

    const snapshot = await waitFor(() => fixture.runtime.getSnapshot(turnId), value => value.status === 'completed', 'turn completion');
    assert.equal(snapshot.status, 'completed', 'the turn itself succeeds even though one tool lingers');

    const transcript = await transcriptCache.getTranscript('fake', 'sess-lingering-tool');
    const assistantMsg = transcript.messages.find(m => m.role === 'assistant');
    const t1 = assistantMsg.toolCalls.find(t => t.id === 't1');
    const t2 = assistantMsg.toolCalls.find(t => t.id === 't2');
    assert.equal(t1.status, 'completed', 'the tool that received a real terminal signal stays completed');
    assert.equal(t2.status, 'failed', 'the lingering tool resolves to failed, never completed, on reload');

    // A second, independent read (simulating a reload) must agree with the live snapshot.
    await transcriptCache.flush('fake', 'sess-lingering-tool');
    const reloadedCache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    const reloaded = await reloadedCache.getTranscript('fake', 'sess-lingering-tool');
    const reloadedMsg = reloaded.messages.find(m => m.role === 'assistant');
    assert.equal(reloadedMsg.toolCalls.find(t => t.id === 't2').status, 'failed');
  } finally {
    await new Promise(r => setTimeout(r, 25));
    await rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

// owner-decisions.md D6, required scenario 16: turn-level failure with an active tool
// resolves that tool to 'failed', not 'completed'.
test('a tool still running when its turn fails resolves to failed', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-turn-failure-tool-test-'));
  try {
    const transcriptCache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    const fixture = createFixture({ transcriptCache });

    const { turnId } = await fixture.runtime.startTurn({
      provider: 'fake',
      providerSessionId: 'sess-fail-with-tool',
      message: 'fail-with-tool',
    });

    const snapshot = await waitFor(() => fixture.runtime.getSnapshot(turnId), value => value.status === 'failed', 'turn failure');
    assert.equal(snapshot.status, 'failed');

    const transcript = await transcriptCache.getTranscript('fake', 'sess-fail-with-tool');
    const assistantMsg = transcript.messages.find(m => m.role === 'assistant');
    assert.equal(assistantMsg.toolCalls.find(t => t.id === 't1').status, 'failed');
    // owner-decisions.md D6/D9: the turn's raw terminal error is plumbed onto the message
    // in a reload-safe way so Task 09 can later classify Turn/Work Outcome from it.
    assert.ok(assistantMsg.turnError?.code, 'turn.failed error.code must survive onto the persisted message');
  } finally {
    await new Promise(r => setTimeout(r, 25));
    await rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test('idle watchdog fails a silent turn via the adapter cancel path with AI_TURN_TIMEOUT', async () => {
  const fixture = createFixture({ runtimeOptions: { idleTimeoutMs: 30, idleCheckIntervalMs: 5, clock: () => new Date() } });
  const { turnId } = await fixture.runtime.startTurn({ provider: 'fake', providerSessionId: 'idle-timeout', message: 'hang' });
  await waitFor(() => fixture.runtime.getSnapshot(turnId), value => value.events.length >= 2, 'started turn');

  const snapshot = await waitFor(() => fixture.runtime.getSnapshot(turnId), value => value.status === 'failed', 'idle timeout');
  assert.equal(snapshot.events.filter(event => event.type === 'turn.failed').length, 1);
  assert.equal(snapshot.events.at(-1).error.code, 'AI_TURN_TIMEOUT');
  assert.equal(fixture.cancels, 1);
  fixture.runtime.shutdown();
});

test('idle watchdog never fires while a turn keeps emitting activity', async () => {
  const fixture = createFixture({ runtimeOptions: { idleTimeoutMs: 40, idleCheckIntervalMs: 5, clock: () => new Date() } });
  const { turnId } = await fixture.runtime.startTurn({ provider: 'fake', providerSessionId: 'idle-reset', message: 'slow-drip' });

  const snapshot = await waitFor(() => fixture.runtime.getSnapshot(turnId), value => value.status === 'completed', 'completion despite long total duration');
  assert.equal(snapshot.events.some(event => event.type === 'turn.failed'), false);
  assert.equal(fixture.cancels, 0);
  fixture.runtime.shutdown();
});

test('idle watchdog exempts turns waitingForUser', async () => {
  const fixture = createFixture({ runtimeOptions: { idleTimeoutMs: 20, idleCheckIntervalMs: 5, clock: () => new Date() } });
  const { turnId } = await fixture.runtime.startTurn({ provider: 'fake', providerSessionId: 'idle-waiting', message: 'permission' });
  await waitFor(() => fixture.runtime.getSnapshot(turnId), value => value.pendingInteraction, 'pending interaction');

  // Wait well past the idle window; a waitingForUser turn must never be timed out.
  await new Promise(resolve => setTimeout(resolve, 80));
  const snapshot = fixture.runtime.getSnapshot(turnId);
  assert.equal(snapshot.status, 'waitingForUser');
  assert.equal(fixture.cancels, 0);
  fixture.runtime.shutdown();
});

test('boot reconciliation finalizes an orphaned persisted activeTurn as AI_TURN_INTERRUPTED with a visible message', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-reconcile-test-'));
  try {
    const transcriptCache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    const orphan = createFixture({ transcriptCache });
    const { turnId } = await orphan.runtime.startTurn({ provider: 'fake', providerSessionId: 'orphan-session', message: 'hang' });
    await waitFor(() => orphan.runtime.getSnapshot(turnId), value => value.events.length >= 2, 'started turn');
    // Simulate an ungraceful process exit: the in-memory runtime is discarded without
    // ever finishing the turn, but the persisted transcript still has `activeTurn` set.
    await transcriptCache.flush('fake', 'orphan-session');

    const fresh = createFixture({ transcriptCache });
    const { reconciledCount } = await fresh.runtime.reconcileOrphanedTurns();
    assert.equal(reconciledCount, 1);

    const transcript = await transcriptCache.getTranscript('fake', 'orphan-session');
    assert.equal(transcript.activeTurn, undefined);
    assert.equal(transcript.messages.at(-1).text, 'Interrupted by server restart.');
    fresh.runtime.shutdown();
  } finally {
    await new Promise(r => setTimeout(r, 25));
    await rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test('boot reconciliation leaves a waitingForUser session (pendingInteraction) untouched', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-reconcile-pending-test-'));
  try {
    const transcriptCache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    const original = createFixture({ transcriptCache });
    const { turnId } = await original.runtime.startTurn({ provider: 'fake', providerSessionId: 'pending-session', message: 'permission' });
    const pending = await waitFor(() => original.runtime.getSnapshot(turnId), value => value.pendingInteraction, 'pending interaction');
    await transcriptCache.flush('fake', 'pending-session');

    const fresh = createFixture({ transcriptCache });
    const { reconciledCount } = await fresh.runtime.reconcileOrphanedTurns();
    assert.equal(reconciledCount, 0);

    const transcript = await transcriptCache.getTranscript('fake', 'pending-session');
    assert.deepEqual(transcript.pendingInteraction, pending.pendingInteraction);
    assert.ok(transcript.activeTurn);
    fresh.runtime.shutdown();
  } finally {
    await new Promise(r => setTimeout(r, 25));
    await rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

function createMockAgyProcess(stdoutLines = [], { exitCode = 0, delayMs = 5 } = {}) {
  const child = new EventEmitter();
  child.stdin = new Writable({ write(chunk, encoding, cb) { cb(); } });
  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });
  child.kill = (signal) => {
    child.killed = true;
    child.killSignal = signal;
    setImmediate(() => child.emit('close', 0));
  };
  setImmediate(async () => {
    for (const line of stdoutLines) {
      if (child.killed) break;
      child.stdout.push(`${line}\n`);
      if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
    }
    child.stdout.push(null);
    child.emit('close', exitCode);
  });
  return child;
}

test('Antigravity full path: tools -> result.response summary -> normalized events -> cache persistence & reload', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-agy-full-path-'));
  try {
    const transcriptCache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    const lines = [
      JSON.stringify({ type: 'init', conversation_id: 'sess-agy-full' }),
      JSON.stringify({ type: 'tool.started', toolId: 't1', toolName: 'Read', input: { path: 'a.ts' } }),
      JSON.stringify({ type: 'tool.completed', toolId: 't1', status: 'completed', output: 'content of a.ts' }),
      JSON.stringify({ type: 'tool.started', toolId: 't2', toolName: 'Bash', input: { command: 'npm test' } }),
      JSON.stringify({ type: 'tool.completed', toolId: 't2', status: 'completed', output: 'tests passed' }),
      JSON.stringify({
        event: 'result',
        result: {
          response: 'Podsumowując, wszystkie testy przeszły pomyślnie.',
        },
      }),
    ];

    const antigravityAdapter = new AntigravityAgentProvider({
      spawnProcess: () => createMockAgyProcess(lines),
    });

    const registry = createAiAdapterRegistry([antigravityAdapter]);
    const runtime = createAiTurnRuntime({ registry, transcriptCache });

    const collectedEvents = [];
    const unsubscribe = runtime.subscribeToSession(
      { provider: 'antigravity', providerSessionId: 'sess-agy-full' },
      { onEvent: (ev) => collectedEvents.push(ev) }
    );

    const { turnId } = await runtime.startTurn({
      provider: 'antigravity',
      providerSessionId: 'sess-agy-full',
      message: 'Run tests and summarize',
    });

    // Wait until turn reaches terminal state
    await waitFor(() => runtime.getSnapshot(turnId), snap => snap && snap.status === 'completed', 'turn completed');
    await transcriptCache.flush('antigravity', 'sess-agy-full');
    unsubscribe();

    // 1. Verify normalized events
    const textEvents = collectedEvents.filter(e => e.type === 'text.delta');
    assert.equal(textEvents.length, 1, 'exactly one text.delta event');
    assert.equal(textEvents[0].text, 'Podsumowując, wszystkie testy przeszły pomyślnie.');
    const turnCompletedEvents = collectedEvents.filter(e => e.type === 'turn.completed');
    assert.equal(turnCompletedEvents.length, 1, 'turn.completed emitted');

    // 2. Verify runtime state has left running
    const snap = runtime.getSnapshot(turnId);
    assert.equal(snap.status, 'completed', 'turn snapshot is completed');
    assert.ok(snap.completedAt, 'turn must have completedAt timestamp');

    // 3. Verify transcript cache on disk and reload
    const reloadedCache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    const transcript = await reloadedCache.getTranscript('antigravity', 'sess-agy-full');
    const assistantMsg = transcript.messages.find(m => m.role === 'assistant');
    assert.ok(assistantMsg, 'assistant message exists in transcript');
    assert.equal(assistantMsg.text, 'Podsumowując, wszystkie testy przeszły pomyślnie.');
    assert.equal(assistantMsg.toolCalls.length, 2);
    assert.equal(assistantMsg.toolCalls[0].status, 'completed');
    assert.equal(assistantMsg.toolCalls[1].status, 'completed');

    runtime.shutdown();
  } finally {
    await new Promise(r => setTimeout(r, 25));
    await rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test('Antigravity full path: error result with empty response -> turn.failed, no turn.completed, no prose text', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-agy-err-empty-'));
  try {
    const transcriptCache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    const lines = [
      JSON.stringify({ type: 'init', conversation_id: 'sess-agy-err-empty' }),
      JSON.stringify({
        event: 'result',
        result: {
          status: 'ERROR',
          response: '',
          error: 'ContentOffset 22500 exceeds line range size 1792',
        },
      }),
    ];

    const antigravityAdapter = new AntigravityAgentProvider({
      spawnProcess: () => createMockAgyProcess(lines),
    });

    const registry = createAiAdapterRegistry([antigravityAdapter]);
    const runtime = createAiTurnRuntime({ registry, transcriptCache });

    const collectedEvents = [];
    const unsubscribe = runtime.subscribeToSession(
      { provider: 'antigravity', providerSessionId: 'sess-agy-err-empty' },
      { onEvent: (ev) => collectedEvents.push(ev) }
    );

    const { turnId } = await runtime.startTurn({
      provider: 'antigravity',
      providerSessionId: 'sess-agy-err-empty',
      message: 'View file with invalid offset',
    });

    // Wait until turn reaches terminal failed state
    await waitFor(() => runtime.getSnapshot(turnId), snap => snap && snap.status === 'failed', 'turn failed');
    await transcriptCache.flush('antigravity', 'sess-agy-err-empty');
    unsubscribe();

    // 1. Verify normalized events: no text.delta, no turn.completed, exactly one turn.failed
    const textEvents = collectedEvents.filter(e => e.type === 'text.delta');
    assert.equal(textEvents.length, 0, 'must not emit text.delta for empty error response');
    const turnCompletedEvents = collectedEvents.filter(e => e.type === 'turn.completed');
    assert.equal(turnCompletedEvents.length, 0, 'must not emit turn.completed');
    const turnFailedEvents = collectedEvents.filter(e => e.type === 'turn.failed');
    assert.equal(turnFailedEvents.length, 1, 'turn.failed emitted');
    assert.equal(turnFailedEvents[0].error.message, 'ContentOffset 22500 exceeds line range size 1792');

    // 2. Verify snapshot
    const snap = runtime.getSnapshot(turnId);
    assert.equal(snap.status, 'failed');
    assert.ok(snap.completedAt);

    // 3. Verify transcript cache on disk and reload
    const reloadedCache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    const transcript = await reloadedCache.getTranscript('antigravity', 'sess-agy-err-empty');
    const assistantMsg = transcript.messages.find(m => m.role === 'assistant');
    if (assistantMsg) {
      assert.equal(assistantMsg.text, '', 'assistant message must not contain placeholder prose');
      assert.deepEqual(assistantMsg.turnError, {
        code: 'AI_PROVIDER_ERROR',
        message: 'ContentOffset 22500 exceeds line range size 1792',
      });
    }

    runtime.shutdown();
  } finally {
    await new Promise(r => setTimeout(r, 25));
    await rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test('Antigravity full path: error result with non-empty response -> text.delta emitted, turn.failed, prose preserved', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-agy-err-prose-'));
  try {
    const transcriptCache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    const lines = [
      JSON.stringify({ type: 'init', conversation_id: 'sess-agy-err-prose' }),
      JSON.stringify({
        event: 'result',
        result: {
          status: 'ERROR',
          response: 'Częściowa odpowiedź asystenta przed awarią',
          error: 'Process crashed mid-execution',
        },
      }),
    ];

    const antigravityAdapter = new AntigravityAgentProvider({
      spawnProcess: () => createMockAgyProcess(lines),
    });

    const registry = createAiAdapterRegistry([antigravityAdapter]);
    const runtime = createAiTurnRuntime({ registry, transcriptCache });

    const collectedEvents = [];
    const unsubscribe = runtime.subscribeToSession(
      { provider: 'antigravity', providerSessionId: 'sess-agy-err-prose' },
      { onEvent: (ev) => collectedEvents.push(ev) }
    );

    const { turnId } = await runtime.startTurn({
      provider: 'antigravity',
      providerSessionId: 'sess-agy-err-prose',
      message: 'Run partial task',
    });

    // Wait until turn reaches terminal failed state
    await waitFor(() => runtime.getSnapshot(turnId), snap => snap && snap.status === 'failed', 'turn failed');
    await transcriptCache.flush('antigravity', 'sess-agy-err-prose');
    unsubscribe();

    // 1. Verify normalized events: text.delta emitted, turn.failed emitted, no turn.completed
    const textEvents = collectedEvents.filter(e => e.type === 'text.delta');
    assert.equal(textEvents.length, 1, 'text.delta emitted');
    assert.equal(textEvents[0].text, 'Częściowa odpowiedź asystenta przed awarią');
    const turnCompletedEvents = collectedEvents.filter(e => e.type === 'turn.completed');
    assert.equal(turnCompletedEvents.length, 0, 'must not emit turn.completed');
    const turnFailedEvents = collectedEvents.filter(e => e.type === 'turn.failed');
    assert.equal(turnFailedEvents.length, 1, 'turn.failed emitted');
    assert.equal(turnFailedEvents[0].error.message, 'Process crashed mid-execution');

    // 2. Verify snapshot
    const snap = runtime.getSnapshot(turnId);
    assert.equal(snap.status, 'failed');

    // 3. Verify transcript cache on disk and reload
    const reloadedCache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    const transcript = await reloadedCache.getTranscript('antigravity', 'sess-agy-err-prose');
    const assistantMsg = transcript.messages.find(m => m.role === 'assistant');
    assert.ok(assistantMsg);
    assert.equal(assistantMsg.text, 'Częściowa odpowiedź asystenta przed awarią');
    assert.deepEqual(assistantMsg.turnError, {
      code: 'AI_PROVIDER_ERROR',
      message: 'Process crashed mid-execution',
    });

    runtime.shutdown();
  } finally {
    await new Promise(r => setTimeout(r, 25));
    await rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});


