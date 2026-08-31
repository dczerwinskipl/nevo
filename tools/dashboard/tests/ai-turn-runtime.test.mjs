import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { createAgentProviderRegistry } from '../server/ai/providers/registry.mjs';
import { createAgentTurnRuntime } from '../server/ai/sessions/turns/runtime.mjs';
import { createTranscriptCacheService } from '../server/ai/sessions/transcript-cache.mjs';
import { AntigravityAgentProvider } from '../server/ai/providers/antigravity/provider.mjs';
import { TurnLifecycleCoordinator } from '../server/ai/sessions/turns/coordinator.mjs';
import { LifecycleTraceSink } from '../server/ai/diagnostics/index.mjs';


const capabilities = Object.freeze({
  interactivePermissions: true,
  interactiveQuestions: true,
  interactiveConfirmations: true,
  resumeSession: true,
  cancelTurn: true,
  toolCalls: true,
  reasoning: true,
  usage: true,
  steerTurn: false,
  planUpdates: false,
});

function createFixture({ sessionLookupGate, transcriptCache, runtimeOptions } = {}) {
  const cache = transcriptCache ?? createTranscriptCacheService({ baseDir: join(tmpdir(), `nevo-test-cache-${randomUUID()}`) });
  let starts = 0;
  let cancels = 0;
  let continuations = 0;
  let releasePersistentTurn;
  const provider = {
    descriptor: { id: 'fake', label: 'Fake', capabilities },
    async startTurn({ providerSessionId, setProviderSessionId, message, setOperation, emitDelta, emitTextDelta, emitProgressDelta, emitReasoningDelta, emitToolStarted, emitToolCompleted, emitUsageUpdated, requestInteraction, signal }) {
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
      } else if (message === 'progress-only') {
        emitProgressDelta('checking...', 'progress-1');
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
        throw new Error('provider failure mid-tool');
      } else if (message === 'hang') {
        await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
      } else if (message === 'persistent-interaction') {
        requestInteraction(
          { kind: 'permission', toolName: 'PersistentShell', input: { command: 'npm test' } },
          { resumePolicy: 'live-operation' },
        );
        await new Promise((resolve, reject) => {
          releasePersistentTurn = resolve;
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
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
      if (interaction?.toolName === 'PersistentShell') return { continuesTurn: true };
    },
    async cancelTurn() { cancels += 1; },
  };
  let id = 0;
  const registry = createAgentProviderRegistry([provider]);
  const runtime = createAgentTurnRuntime({
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
    releasePersistentTurn() { releasePersistentTurn?.(); },
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
  assert.deepEqual(snapshot.events.map(event => event.type), ['turn.started', 'turn.updated', 'text.delta', 'text.delta', 'turn.updated', 'turn.completed']);
  assert.deepEqual(snapshot.events.map(event => event.id), [1, 2, 3, 4, 5, 6]);
  assert.equal(snapshot.providerSessionId, 's1');
  assert.equal(snapshot.sessionId, undefined);
});

test('progress.delta remains ordered provider-neutral activity and never becomes assistant transcript text', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-progress-test-'));
  try {
    const transcriptCache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    const fixture = createFixture({ transcriptCache });
    const { turnId } = await fixture.runtime.startTurn({
      provider: 'fake', providerSessionId: 'progress-session', message: 'progress-only',
    });
    const snapshot = await waitFor(() => fixture.runtime.getSnapshot(turnId), value => value.status === 'completed');
    assert.deepEqual(snapshot.events.map(event => event.type), [
      'turn.started', 'turn.updated', 'text.delta', 'progress.delta', 'text.delta', 'turn.updated', 'turn.completed',
    ]);
    const progress = snapshot.events.find(event => event.type === 'progress.delta');
    assert.equal(progress.id, 4);
    assert.equal(progress.seq, 4);
    assert.equal(progress.turnId, turnId);
    assert.equal(progress.progressId, 'progress-1');
    assert.equal(progress.text, 'checking...');
    const transcript = await transcriptCache.getTranscript('fake', 'progress-session');
    const assistantText = transcript.messages.filter(message => message.role === 'assistant').map(message => message.text).join('');
    assert.equal(assistantText, 'one two');
    assert.equal(assistantText.includes('checking'), false);
  } finally {
    await new Promise(resolve => setTimeout(resolve, 25));
    await rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
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

test('a persistent provider interaction continues until the original turn lifecycle completes', async () => {
  const fixture = createFixture();
  const turn = await fixture.runtime.startTurn({
    provider: 'fake',
    providerSessionId: 'persistent-session',
    message: 'persistent-interaction',
  });
  const pending = await waitFor(() => fixture.runtime.getSnapshot(turn.turnId), value => value.pendingInteraction, 'persistent interaction');
  await fixture.runtime.resolveInteraction(turn.turnId, pending.pendingInteraction.id, { decision: 'allow' });
  await new Promise(resolve => setImmediate(resolve));

  const continuing = fixture.runtime.getSnapshot(turn.turnId);
  assert.equal(continuing.status, 'running');
  assert.equal(continuing.events.some(event => event.type === 'turn.completed'), false);

  fixture.releasePersistentTurn();
  const completed = await waitFor(() => fixture.runtime.getSnapshot(turn.turnId), value => value.status === 'completed', 'provider completion');
  assert.equal(completed.events.filter(event => event.type === 'turn.completed').length, 1);
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
  assert.equal(pending.pendingInteraction.resumePolicy, 'restart');

  // Shutdown first runtime without destroying transcriptCache
  fixture.runtime.shutdown();

  // Create fresh runtime with same transcriptCache
  const { createAgentTurnRuntime } = await import('../server/ai/sessions/turns/runtime.mjs');
  const runtime2 = createAgentTurnRuntime({ registry: fixture.registry, transcriptCache: fixture.transcriptCache });

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
  assert.deepEqual(snap1.events.map(e => e.seq), [1, 2, 3, 4, 5, 6]);

  // Turn 2
  const turn2 = await fixture.runtime.startTurn({ ...sessionIdentity, message: 'normal' });
  const snap2 = await waitFor(() => fixture.runtime.getSnapshot(turn2.turnId), v => v.status === 'completed');
  assert.deepEqual(snap2.events.map(e => e.seq), [7, 8, 9, 10, 11, 12]);
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

  assert.equal(sessionEvents.length, 12);
  assert.deepEqual(sessionEvents.map(e => e.seq), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
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
    assert.equal(transcript.lastEventSeq, 6);

    // Reconstruct runtime 2 (simulating server restart)
    const fixture2 = createFixture({ transcriptCache });
    const turn2 = await fixture2.runtime.startTurn({ provider: 'fake', providerSessionId: 'sess-restart', message: 'normal' });
    const snap2 = await waitFor(() => fixture2.runtime.getSnapshot(turn2.turnId), v => v.status === 'completed');

    // Sequence must continue at 7, 8, 9, 10, 11, 12
    assert.deepEqual(snap2.events.map(e => e.seq), [7, 8, 9, 10, 11, 12]);
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

test('cancellation while waiting invokes provider cancellation when a live operation remains', async () => {
  const fixture = createFixture();
  const { turnId } = await fixture.runtime.startTurn({
    provider: 'fake',
    providerSessionId: 'persistent-cancel',
    message: 'persistent-interaction',
  });
  await waitFor(() => fixture.runtime.getSnapshot(turnId), value => value.status === 'waitingForUser');

  const snapshot = await fixture.runtime.cancelTurn(turnId);
  assert.equal(fixture.cancels, 1);
  assert.equal(snapshot.status, 'failed');
  assert.equal(snapshot.pendingInteraction, null);
  assert.equal(snapshot.events.filter(event => event.type === 'turn.failed').length, 1);
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

test('graceful shutdown terminalizes a live-operation interaction before provider disposal', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-live-shutdown-test-'));
  try {
    const transcriptCache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    const fixture = createFixture({ transcriptCache });
    const { turnId } = await fixture.runtime.startTurn({
      provider: 'fake',
      providerSessionId: 'live-shutdown',
      message: 'persistent-interaction',
    });
    const waiting = await waitFor(() => fixture.runtime.getSnapshot(turnId), value => value.pendingInteraction, 'live interaction');
    assert.equal(waiting.pendingInteraction.resumePolicy, 'live-operation');

    await fixture.runtime.shutdown();

    const snapshot = fixture.runtime.getSnapshot(turnId);
    assert.equal(snapshot.status, 'failed');
    assert.equal(snapshot.pendingInteraction, null);
    assert.equal(snapshot.events.at(-1).error.code, 'AI_TURN_INTERRUPTED');
    const transcript = await transcriptCache.getTranscript('fake', 'live-shutdown');
    assert.equal(transcript.activeTurn, undefined);
    assert.equal(transcript.pendingInteraction, undefined);
  } finally {
    await rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test('shutdown disposes persistent providers exactly once', async () => {
  let disposals = 0;
  const provider = {
    descriptor: { id: 'disposable', label: 'Disposable', capabilities },
    async startTurn() {},
    async cancelTurn() {},
    async dispose() { disposals += 1; },
  };
  const runtime = createAgentTurnRuntime({ registry: createAgentProviderRegistry([provider]), idleTimeoutMs: 0 });
  await Promise.all([runtime.shutdown(), runtime.shutdown()]);
  assert.equal(disposals, 1);
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

test('concurrent starts for one session invoke the provider only once', async () => {
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
    assert.equal(transcript.lastEventSeq, 14);
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

test('idle watchdog fails a silent turn via the provider cancel path with AI_TURN_TIMEOUT', async () => {
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

test('a stale live-operation interaction is not reconstructed and fails with interruption instead of AI_NOT_FOUND', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-live-restart-test-'));
  let original;
  try {
    const originalCache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    original = createFixture({ transcriptCache: originalCache });
    const { turnId } = await original.runtime.startTurn({
      provider: 'fake',
      providerSessionId: 'live-restart',
      message: 'persistent-interaction',
    });
    const pending = await waitFor(() => original.runtime.getSnapshot(turnId), value => value.pendingInteraction, 'live interaction');
    await originalCache.flush('fake', 'live-restart');

    const restartedCache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    const restarted = createFixture({ transcriptCache: restartedCache });
    await assert.rejects(
      () => restarted.runtime.resolveInteraction(
        turnId,
        pending.pendingInteraction.id,
        { decision: 'allow' },
        { provider: 'fake', providerSessionId: 'live-restart' },
      ),
      error => error.code === 'AI_TURN_INTERRUPTED',
    );
    assert.equal(restarted.continuations, 0);
    const transcript = await restartedCache.getTranscript('fake', 'live-restart');
    assert.equal(transcript.activeTurn, undefined);
    assert.equal(transcript.pendingInteraction, undefined);
    await restarted.runtime.shutdown();
  } finally {
    await original?.runtime.shutdown();
    await rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test('boot reconciliation interrupts a stale live-operation interaction', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-reconcile-live-test-'));
  let original;
  try {
    const originalCache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    original = createFixture({ transcriptCache: originalCache });
    const { turnId } = await original.runtime.startTurn({
      provider: 'fake',
      providerSessionId: 'live-pending-session',
      message: 'persistent-interaction',
    });
    await waitFor(() => original.runtime.getSnapshot(turnId), value => value.pendingInteraction, 'live interaction');
    await originalCache.flush('fake', 'live-pending-session');

    const restartedCache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    const fresh = createFixture({ transcriptCache: restartedCache });
    const { reconciledCount } = await fresh.runtime.reconcileOrphanedTurns();
    assert.equal(reconciledCount, 1);

    const transcript = await restartedCache.getTranscript('fake', 'live-pending-session');
    assert.equal(transcript.activeTurn, undefined);
    assert.equal(transcript.pendingInteraction, undefined);
    assert.equal(transcript.messages.at(-1).text, 'Interrupted by server restart.');
    await fresh.runtime.shutdown();
  } finally {
    await original?.runtime.shutdown();
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
    assert.equal(pending.pendingInteraction.resumePolicy, 'restart');
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

    const antigravityProvider = new AntigravityAgentProvider({
      spawnProcess: () => createMockAgyProcess(lines),
    });

    const registry = createAgentProviderRegistry([antigravityProvider]);
    const runtime = createAgentTurnRuntime({ registry, transcriptCache });

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

    const antigravityProvider = new AntigravityAgentProvider({
      spawnProcess: () => createMockAgyProcess(lines),
    });

    const registry = createAgentProviderRegistry([antigravityProvider]);
    const runtime = createAgentTurnRuntime({ registry, transcriptCache });

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

test('Antigravity full path: error result with non-empty response -> text.delta emitted, turn.completed, prose preserved, no false-positive turnError', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-agy-err-prose-'));
  try {
    const transcriptCache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    const lines = [
      JSON.stringify({ type: 'init', conversation_id: 'sess-agy-err-prose' }),
      JSON.stringify({
        event: 'result',
        result: {
          status: 'ERROR',
          response: 'Odpowiedź asystenta wygenerowana mimo wcześniejszego błędu w sesji',
          error: 'Process crashed mid-execution',
        },
      }),
    ];

    const antigravityProvider = new AntigravityAgentProvider({
      spawnProcess: () => createMockAgyProcess(lines),
    });

    const registry = createAgentProviderRegistry([antigravityProvider]);
    const runtime = createAgentTurnRuntime({ registry, transcriptCache });

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

    // Wait until turn reaches terminal completed state
    await waitFor(() => runtime.getSnapshot(turnId), snap => snap && snap.status === 'completed', 'turn completed');
    await transcriptCache.flush('antigravity', 'sess-agy-err-prose');
    unsubscribe();

    // 1. Verify normalized events: text.delta emitted, turn.completed emitted, no turn.failed
    const textEvents = collectedEvents.filter(e => e.type === 'text.delta');
    assert.equal(textEvents.length, 1, 'text.delta emitted');
    assert.equal(textEvents[0].text, 'Odpowiedź asystenta wygenerowana mimo wcześniejszego błędu w sesji');
    const turnCompletedEvents = collectedEvents.filter(e => e.type === 'turn.completed');
    assert.equal(turnCompletedEvents.length, 1, 'must emit turn.completed');
    const turnFailedEvents = collectedEvents.filter(e => e.type === 'turn.failed');
    assert.equal(turnFailedEvents.length, 0, 'must not emit turn.failed');

    // 2. Verify snapshot
    const snap = runtime.getSnapshot(turnId);
    assert.equal(snap.status, 'completed');

    // 3. Verify transcript cache on disk and reload
    const reloadedCache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    const transcript = await reloadedCache.getTranscript('antigravity', 'sess-agy-err-prose');
    const assistantMsg = transcript.messages.find(m => m.role === 'assistant');
    assert.ok(assistantMsg);
    assert.equal(assistantMsg.text, 'Odpowiedź asystenta wygenerowana mimo wcześniejszego błędu w sesji');
    assert.equal(assistantMsg.turnError, undefined, 'must not attach false-positive turnError');

    runtime.shutdown();
  } finally {
    await new Promise(r => setTimeout(r, 25));
    await rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test('TurnLifecycleCoordinator: legal and illegal status transitions and invariants', async () => {
  const coordinator = new TurnLifecycleCoordinator({
    turnId: 'turn-trans-1',
    sessionId: 'sess-1',
    provider: 'claude',
  });

  // Initial status is active (startup)
  assert.equal(coordinator.status.status, 'active');
  assert.equal(coordinator.status.detail, 'startup');

  // 1. Transition active -> waiting
  let status = await coordinator.requestStatusTransition({
    status: 'waiting',
    reason: 'provider_response',
  });
  assert.equal(status.status, 'waiting');
  assert.equal(status.reason, 'provider_response');

  // 2. Add interaction and transition to requiresAttention
  const interactionItem = await coordinator.appendWork({
    id: 'int-1',
    type: 'interaction',
    status: 'pending',
    interaction: { id: 'int-1', kind: 'permission', toolName: 'Shell' },
  });
  assert.equal(interactionItem.seq, 1);

  status = await coordinator.requestStatusTransition({
    status: 'requiresAttention',
    reason: 'permission',
    interactionId: 'int-1',
  });
  assert.equal(status.status, 'requiresAttention');
  assert.equal(status.interactionId, 'int-1');

  // 3. Resolve interaction -> back to active
  await coordinator.updateWork('int-1', { status: 'resolved' });
  status = await coordinator.requestStatusTransition({
    status: 'active',
    detail: 'model_response',
  });
  assert.equal(status.status, 'active');

  // 4. Request cancellation -> cancelling
  const cancelled = await coordinator.requestCancellation({ initiator: 'user' });
  assert.equal(cancelled, true);
  assert.equal(coordinator.status.status, 'cancelling');

  // 5. Settle terminal -> completed/failed
  status = await coordinator.settleTerminal({ outcome: 'cancelled', initiator: 'user' });
  assert.equal(status.status, 'terminal');
  assert.equal(status.outcome, 'cancelled');
  assert.equal(coordinator.isTerminal, true);

  // 6. Subsequent transition attempts are safely ignored without mutating terminal outcome
  const lateStatus = await coordinator.requestStatusTransition({
    status: 'active',
    detail: 'startup',
  });
  assert.equal(lateStatus.status, 'terminal');
  assert.equal(lateStatus.outcome, 'cancelled');

  // Late work addition is ignored
  const lateWork = await coordinator.appendWork({
    id: 'w-late',
    type: 'commentary',
    text: 'late commentary',
  });
  assert.equal(lateWork, null);
});

test('protocol silence watchdog: suppressed during long tool execution and pending interaction', async () => {
  const coordinator = new TurnLifecycleCoordinator({
    turnId: 'turn-watchdog-1',
    sessionId: 'sess-1',
    provider: 'codex',
  });

  // 1. Add active tool
  const tool = await coordinator.appendWork({
    id: 'tool-slow',
    type: 'tool',
    toolName: 'slowBash',
    kind: 'command',
    title: 'Run slow build',
    status: 'active',
  });
  assert.equal(tool.seq, 1);
  assert.equal(coordinator.hasOpenTools, true);

  // Evaluate watchdog with past timestamp (e.g. 10 minutes elapsed)
  const pastTime = Date.now() + 600_000;
  let check = await coordinator.checkProtocolSilence(pastTime, 300_000);
  assert.equal(check.fired, false);
  assert.equal(check.suppressed, 'open_tools');
  assert.equal(coordinator.isTerminal, false);

  // 2. Complete tool -> hasOpenTools becomes false
  await coordinator.updateWork('tool-slow', { status: 'completed' });
  assert.equal(coordinator.hasOpenTools, false);

  // 3. Add pending interaction -> suppressed by pending_interaction
  await coordinator.appendWork({
    id: 'int-q',
    type: 'interaction',
    status: 'pending',
    interaction: { id: 'int-q', kind: 'question', questions: [{ id: 'q1', question: 'confirm?' }] },
  });
  await coordinator.requestStatusTransition({
    status: 'requiresAttention',
    reason: 'question',
    interactionId: 'int-q',
  });

  check = await coordinator.checkProtocolSilence(pastTime, 300_000);
  assert.equal(check.fired, false);
  assert.equal(check.suppressed, 'pending_interaction');
  assert.equal(coordinator.isTerminal, false);

  // 4. Resolve interaction -> now without activity, watchdog fires
  await coordinator.updateWork('int-q', { status: 'resolved' });
  await coordinator.requestStatusTransition({ status: 'waiting', reason: 'provider_response' });

  check = await coordinator.checkProtocolSilence(pastTime + 400_000, 300_000);
  assert.equal(check.fired, true);
  assert.equal(check.cause, 'timeout/protocol-silence');
  await coordinator.settleTerminal({ outcome: 'failed', cause: check.cause, initiator: 'runtime' });
  assert.equal(coordinator.isTerminal, true);
  assert.equal(coordinator.status.status, 'terminal');
  assert.equal(coordinator.status.outcome, 'failed');
  assert.equal(coordinator.status.cause, 'timeout/protocol-silence');
});

test('failed tool followed by subsequent Work finishes with completed Turn and preserved order', async () => {
  const coordinator = new TurnLifecycleCoordinator({
    turnId: 'turn-tool-fail-1',
    sessionId: 'sess-1',
    provider: 'claude',
  });

  // 1. Initial commentary
  await coordinator.appendWork({
    id: 'c-1',
    type: 'commentary',
    text: 'Attempting file read',
    status: 'completed',
  });

  // 2. Tool that fails
  await coordinator.appendWork({
    id: 't-1',
    type: 'tool',
    toolName: 'readFile',
    kind: 'file_operation',
    title: 'Read missing file',
    status: 'active',
  });
  await coordinator.updateWork('t-1', {
    status: 'failed',
    output: 'FileNotFoundException',
  });

  // 3. Subsequent commentary recovering from failure
  await coordinator.appendWork({
    id: 'c-2',
    type: 'commentary',
    text: 'File missing, falling back to directory search',
    status: 'completed',
  });

  // 4. Successful fallback tool with nested actions
  const tool2 = await coordinator.appendWork({
    id: 't-2',
    type: 'tool',
    toolName: 'searchDir',
    kind: 'search',
    title: 'Search files',
    status: 'active',
  });
  await coordinator.addToolAction('t-2', {
    id: 'act-1',
    kind: 'search',
    title: 'Search in specs/',
  });
  await coordinator.updateWork('t-2', {
    status: 'completed',
    output: ['spec.md'],
  });

  // 5. Final answer
  await coordinator.setFinalAnswer({
    id: 'final-ans',
    text: 'Operation completed successfully via fallback.',
    status: 'completed',
  });

  // 6. Turn completes successfully
  const terminal = await coordinator.settleTerminal({ outcome: 'completed' });
  assert.equal(terminal.outcome, 'completed');
  assert.equal(coordinator.turn.work.length, 4);
  assert.equal(coordinator.turn.work[0].seq, 1);
  assert.equal(coordinator.turn.work[1].seq, 2);
  assert.equal(coordinator.turn.work[1].status, 'failed');
  assert.equal(coordinator.turn.work[2].seq, 3);
  assert.equal(coordinator.turn.work[3].seq, 4);
  assert.equal(coordinator.turn.work[3].status, 'completed');
  assert.equal(coordinator.turn.work[3].actions.length, 1);
});

test('timeout versus user cancellation race: timeout persists failed with timeout/protocol-silence', async () => {
  const coordinator = new TurnLifecycleCoordinator({
    turnId: 'turn-race-1',
    sessionId: 'sess-1',
    provider: 'mock',
  });

  // Fire timeout first
  const past = Date.now() + 600_000;
  const timeoutResult = await coordinator.checkProtocolSilence(past, 300_000);
  assert.equal(timeoutResult.fired, true);
  await coordinator.settleTerminal({ outcome: 'failed', cause: timeoutResult.cause, initiator: 'runtime' });
  assert.equal(coordinator.status.status, 'terminal');
  assert.equal(coordinator.status.outcome, 'failed');
  assert.equal(coordinator.status.cause, 'timeout/protocol-silence');

  // Attempt user cancel after timeout
  const cancelResult = await coordinator.requestCancellation({ initiator: 'user' });
  assert.equal(cancelResult, false);

  // Terminal status is intact
  assert.equal(coordinator.status.status, 'terminal');
  assert.equal(coordinator.status.outcome, 'failed');
  assert.equal(coordinator.status.cause, 'timeout/protocol-silence');
});

test('regression: long-running tool suppresses protocol silence timeout through runtime integration', async () => {
  let finishTool;
  const toolHoldingProvider = {
    descriptor: { id: 'tool-holder', label: 'Tool Holder', capabilities },
    async startTurn({ emitDelta, emitToolStarted, emitToolCompleted, signal }) {
      emitDelta('starting');
      emitToolStarted({ toolId: 't-long', toolName: 'heavyBuild' });
      await new Promise(resolve => { finishTool = resolve; });
      emitToolCompleted({ toolId: 't-long', status: 'completed', durationMs: 100 });
      emitDelta('finished');
    },
    async cancelTurn() {},
  };

  const registry = createAgentProviderRegistry([toolHoldingProvider]);
  const runtime = createAgentTurnRuntime({
    registry,
    idleTimeoutMs: 25,
    idleCheckIntervalMs: 5,
  });

  const { turnId } = await runtime.startTurn({
    provider: 'tool-holder',
    providerSessionId: 'sess-long-tool',
    message: 'run',
  });

  // Wait 40ms (> idleTimeoutMs 25ms) while tool is open
  await new Promise(r => setTimeout(r, 40));
  const midSnapshot = runtime.getSnapshot(turnId);
  const midTurn = runtime.getCanonicalTurn(turnId);
  assert.equal(midSnapshot.status, 'running');
  assert.equal(midTurn.status.status, 'active');
  assert.equal(midTurn.status.detail, 'tool_execution');

  // Complete tool
  finishTool();
  const completedSnapshot = await waitFor(() => runtime.getSnapshot(turnId), v => v.status === 'completed', 'tool finish');
  const completedTurn = runtime.getCanonicalTurn(turnId);
  assert.equal(completedSnapshot.status, 'completed');
  assert.equal(completedTurn.work.find(w => w.id === 't-long').status, 'completed');
  runtime.shutdown();
});

test('regression: provider wait without active tool maintains canonical waiting/liveness semantics', async () => {
  const coordinator = new TurnLifecycleCoordinator({
    turnId: 'turn-wait-1',
    sessionId: 'sess-wait',
    provider: 'codex',
  });

  coordinator.requestStatusTransition({
    status: 'waiting',
    reason: 'provider_response',
    subjectId: 'op-123',
  });

  const activity = coordinator.getCurrentActivity();
  assert.equal(activity.kind, 'waiting');
  assert.equal(activity.status, 'waiting');
  assert.equal(activity.title, 'Waiting for model response');
  assert.equal(activity.subjectId, 'op-123');
});

test('regression: successful completion followed by late events preserves immutability', async () => {
  const coordinator = new TurnLifecycleCoordinator({
    turnId: 'turn-immutable-1',
    sessionId: 'sess-imm',
    provider: 'claude',
  });

  coordinator.recordTextDelta('Initial answer', 'msg-1');
  coordinator.setFinalAnswer({
    id: 'final-1',
    text: 'All done.',
    status: 'completed',
  });
  coordinator.settleTerminal({ outcome: 'completed' });

  assert.equal(coordinator.isTerminal, true);
  assert.equal(coordinator.status.status, 'terminal');
  assert.equal(coordinator.status.outcome, 'completed');
  const workCountBefore = coordinator.turn.work.length;

  // Late commentary delta
  const lateCommentary = coordinator.recordTextDelta('Late extra text', 'msg-late');
  assert.equal(lateCommentary, null);

  // Late tool start
  const lateTool = coordinator.recordToolStarted({ toolId: 't-late', toolName: 'lateTool' });
  assert.equal(lateTool, null);

  // Late work append
  const lateWork = coordinator.appendWork({ id: 'late-work', type: 'commentary', text: 'late' });
  assert.equal(lateWork, null);

  // Late transition
  const lateTransition = coordinator.requestStatusTransition({ status: 'active' });
  assert.equal(lateTransition.status, 'terminal');

  // Assert immutable state
  assert.equal(coordinator.turn.work.length, workCountBefore);
  assert.equal(coordinator.turn.status.status, 'terminal');
  assert.equal(coordinator.turn.status.outcome, 'completed');
});

test('regression: cancel followed by late tool result preserves cancelled outcome', async () => {
  const coordinator = new TurnLifecycleCoordinator({
    turnId: 'turn-cancel-race-1',
    sessionId: 'sess-cr',
    provider: 'codex',
  });

  coordinator.recordToolStarted({ toolId: 't-active', toolName: 'compiler' });
  assert.equal(coordinator.hasOpenTools, true);

  // Cancel turn
  coordinator.requestCancellation({ initiator: 'user' });
  coordinator.settleTerminal({ outcome: 'cancelled', initiator: 'user' });

  assert.equal(coordinator.isTerminal, true);
  assert.equal(coordinator.status.outcome, 'cancelled');
  assert.equal(coordinator.hasOpenTools, false);

  const toolItem = coordinator.turn.work.find(w => w.id === 't-active');
  assert.equal(toolItem.status, 'cancelled');
  assert.equal(toolItem.closureReason, 'turn_cancelled');

  // Late tool completed event arrives from detached child process
  const lateToolResult = coordinator.recordToolCompleted({
    toolId: 't-active',
    status: 'completed',
    output: 'built successfully',
  });
  assert.equal(lateToolResult, null);

  // Tool status remains cancelled, turn outcome remains cancelled
  assert.equal(toolItem.status, 'cancelled');
  assert.equal(coordinator.status.outcome, 'cancelled');
});

test('regression: provider session identity late binding and re-bind prevention', async () => {
  const coordinator = new TurnLifecycleCoordinator({
    turnId: 'turn-unbound-1',
    sessionId: 'nevo-session-42',
    provider: 'antigravity',
    providerSessionId: null, // Initially unbound
  });

  assert.equal(coordinator.turn.sessionId, 'nevo-session-42');
  assert.equal(coordinator.turn.providerSessionId, null);

  // Provider allocates session ID later
  coordinator.bindProviderSessionId('provider-thread-999');
  assert.equal(coordinator.turn.providerSessionId, 'provider-thread-999');

  // Re-binding identical ID is idempotent
  coordinator.bindProviderSessionId('provider-thread-999');
  assert.equal(coordinator.turn.providerSessionId, 'provider-thread-999');

  // Re-binding different ID throws AiValidationError
  assert.throws(
    () => coordinator.bindProviderSessionId('different-thread-888'),
    { name: 'AiValidationError' },
  );
});

test('regression: dangling tool closure preserves truthful closure reasons across all terminal variants', async () => {
  const variants = [
    { outcome: 'completed', expectedToolStatus: 'failed', expectedReason: 'turn_completed' },
    { outcome: 'failed', cause: 'generic_error', expectedToolStatus: 'failed', expectedReason: 'turn_failed' },
    { outcome: 'cancelled', expectedToolStatus: 'cancelled', expectedReason: 'turn_cancelled' },
    { outcome: 'interrupted', expectedToolStatus: 'interrupted', expectedReason: 'turn_interrupted' },
    { outcome: 'failed', cause: 'timeout/protocol-silence', expectedToolStatus: 'failed', expectedReason: 'timeout' },
  ];

  for (const { outcome, cause, expectedToolStatus, expectedReason } of variants) {
    const coordinator = new TurnLifecycleCoordinator({
      turnId: `turn-dangle-${outcome}-${cause || 'default'}`,
      sessionId: 'sess-dangle',
      provider: 'mock',
    });

    coordinator.recordToolStarted({ toolId: 'tool-dangling', toolName: 'worker' });
    assert.equal(coordinator.hasOpenTools, true);

    coordinator.settleTerminal({ outcome, cause });
    assert.equal(coordinator.hasOpenTools, false);

    const tool = coordinator.turn.work.find(w => w.id === 'tool-dangling');
    assert.equal(tool.status, expectedToolStatus, `status mismatch for outcome ${outcome}`);
    assert.equal(tool.closureReason, expectedReason, `closureReason mismatch for outcome ${outcome}`);
  }
});

test('regression: resolving interaction after turn cancellation throws AiNotFoundError', async () => {
  const fixture = createFixture();
  const { turnId } = await fixture.runtime.startTurn({
    provider: 'fake',
    providerSessionId: 'cancel-int-race',
    message: 'permission',
  });

  const waiting = await waitFor(() => fixture.runtime.getSnapshot(turnId), v => v.pendingInteraction, 'waiting');
  const interactionId = waiting.pendingInteraction.id;

  // Cancel turn
  await fixture.runtime.cancelTurn(turnId);
  const cancelled = fixture.runtime.getSnapshot(turnId);
  assert.equal(cancelled.status, 'failed');
  assert.equal(cancelled.pendingInteraction, null);

  // Late resolution attempt
  await assert.rejects(
    () => fixture.runtime.resolveInteraction(turnId, interactionId, { decision: 'allow' }),
    { name: 'AiNotFoundError' },
  );
  fixture.runtime.shutdown();
});

test('regression: Antigravity transitional tool statuses (running, in_progress, success, error) normalized without validation errors', async () => {
  const agyMockProvider = {
    descriptor: { id: 'agy-mock', label: 'Antigravity Mock', capabilities },
    async startTurn({ emitDelta, emitToolStarted, emitToolUpdated, emitToolCompleted }) {
      emitDelta('Starting task...');
      // Antigravity emits status: 'running' on updates
      emitToolStarted({ toolId: 'tool-agy-1', toolName: 'run_command', input: { command: 'npm test' } });
      emitToolUpdated({ toolId: 'tool-agy-1', output: 'running tests...', status: 'running' });
      emitToolCompleted({ toolId: 'tool-agy-1', output: 'all tests passed', status: 'success', durationMs: 42 });
      emitDelta('Task finished.');
    },
    async cancelTurn() {},
  };

  const registry = createAgentProviderRegistry([agyMockProvider]);
  const runtime = createAgentTurnRuntime({ registry });

  const { turnId } = await runtime.startTurn({
    provider: 'agy-mock',
    providerSessionId: 'sess-agy-transitional',
    message: 'run test',
  });

  const snapshot = await waitFor(() => runtime.getSnapshot(turnId), v => v.status === 'completed', 'completed turn');
  assert.equal(snapshot.status, 'completed');
  const turn = runtime.getCanonicalTurn(turnId);
  const tool = turn.work.find(w => w.id === 'tool-agy-1');
  assert.equal(tool.status, 'completed');
  assert.equal(tool.toolName, 'run_command');
  runtime.shutdown();
});

test('regression: terminal arbitration: cancellation intent prevails over concurrent provider completion', async () => {
  const coordinator = new TurnLifecycleCoordinator({
    turnId: 'turn-arb-1',
    sessionId: 'sess-arb-1',
    provider: 'codex',
  });

  coordinator.recordToolStarted({ toolId: 'tool-1', toolName: 'build' });

  // 1. User cancellation accepted
  const accepted = coordinator.requestCancellation({ initiator: 'user' });
  assert.equal(accepted, true);
  assert.equal(coordinator.status.status, 'cancelling');
  assert.equal(coordinator.isCancelling, true);

  // 2. While cancelTurn is in flight, provider completes normally and calls settleTerminal(completed)
  const settled = coordinator.settleTerminal({ outcome: 'completed', initiator: 'provider' });

  // 3. Coordinator arbitration ensures cancellation prevails
  assert.equal(settled.status, 'terminal');
  assert.equal(settled.outcome, 'cancelled');
  assert.equal(settled.initiator, 'user');
  assert.equal(coordinator.status.outcome, 'cancelled');

  // 4. Open tools closed with turn_cancelled
  const tool = coordinator.turn.work.find(w => w.id === 'tool-1');
  assert.equal(tool.status, 'cancelled');
  assert.equal(tool.closureReason, 'turn_cancelled');
});

test('regression: terminal arbitration: cancellation intent prevails over provider failure during cleanup', async () => {
  const coordinator = new TurnLifecycleCoordinator({
    turnId: 'turn-arb-2',
    sessionId: 'sess-arb-2',
    provider: 'claude',
  });

  // 1. User cancellation accepted
  coordinator.requestCancellation({ initiator: 'user' });

  // 2. Provider cleanup fails with error (SIGKILL / process crash)
  const settled = coordinator.settleTerminal({ outcome: 'failed', initiator: 'provider', cause: 'process_crash' });

  // 3. Cancellation remains the authoritative outcome
  assert.equal(settled.outcome, 'cancelled');
  assert.equal(settled.initiator, 'user');
});

test('regression: terminal arbitration: timeout suppresses late user cancel and late provider completion', async () => {
  const coordinator = new TurnLifecycleCoordinator({
    turnId: 'turn-arb-3',
    sessionId: 'sess-arb-3',
    provider: 'mock',
  });

  // 1. Timeout fires
  const check = coordinator.checkProtocolSilence(Date.now() + 600_000, 300_000);
  assert.equal(check.fired, true);
  coordinator.settleTerminal({ outcome: 'failed', cause: check.cause, initiator: 'runtime' });
  assert.equal(coordinator.status.status, 'terminal');
  assert.equal(coordinator.status.outcome, 'failed');
  assert.equal(coordinator.status.cause, 'timeout/protocol-silence');

  // 2. Late user cancellation arrives after timeout
  const cancelAccepted = coordinator.requestCancellation({ initiator: 'user' });
  assert.equal(cancelAccepted, false);

  // 3. Late provider completion arrives after timeout
  const lateSettled = coordinator.settleTerminal({ outcome: 'completed' });
  assert.equal(lateSettled.outcome, 'failed');
  assert.equal(coordinator.status.outcome, 'failed');
});

test('regression: terminal arbitration: user cancel suppresses timeout watchdog', async () => {
  const coordinator = new TurnLifecycleCoordinator({
    turnId: 'turn-arb-4',
    sessionId: 'sess-arb-4',
    provider: 'mock',
  });

  // 1. User cancellation accepted
  coordinator.requestCancellation({ initiator: 'user' });

  // 2. Watchdog evaluates silence while cancelling
  const check = coordinator.checkProtocolSilence(Date.now() + 600_000, 300_000);
  assert.equal(check.fired, false);
  assert.equal(check.suppressed, 'cancelling');

  // 3. Settles as cancelled
  coordinator.settleTerminal({ outcome: 'cancelled' });
  assert.equal(coordinator.status.outcome, 'cancelled');
});

test('regression: complete terminal Work immutability: all terminal statuses cannot transition back to active/pending', async () => {
  const coordinator = new TurnLifecycleCoordinator({
    turnId: 'turn-imm-all',
    sessionId: 'sess-imm',
    provider: 'mock',
  });

  // 1. Tool in 'interrupted' status cannot transition back to 'active' or 'queued'
  coordinator.appendWork({ id: 'tool-int', type: 'tool', toolName: 't', status: 'interrupted' });
  assert.throws(
    () => coordinator.updateWork('tool-int', { status: 'active' }),
    { name: 'AiValidationError' },
  );

  // 2. Tool in 'unknown' status cannot transition back to 'active'
  coordinator.appendWork({ id: 'tool-unk', type: 'tool', toolName: 't', status: 'unknown' });
  assert.throws(
    () => coordinator.updateWork('tool-unk', { status: 'active' }),
    { name: 'AiValidationError' },
  );

  // 3. Interaction in 'rejected' status cannot transition back to 'pending'
  coordinator.appendWork({
    id: 'int-rej',
    type: 'interaction',
    status: 'rejected',
    interaction: { id: 'int-rej', kind: 'permission', toolName: 'bash' },
  });
  assert.throws(
    () => coordinator.updateWork('int-rej', { status: 'pending' }),
    { name: 'AiValidationError' },
  );

  // 4. Interaction in 'expired' status cannot transition back to 'pending'
  coordinator.appendWork({
    id: 'int-exp',
    type: 'interaction',
    status: 'expired',
    interaction: { id: 'int-exp', kind: 'question', questions: [{ id: 'q', question: 'ok?' }] },
  });
  assert.throws(
    () => coordinator.updateWork('int-exp', { status: 'pending' }),
    { name: 'AiValidationError' },
  );

  // 5. Valid non-terminal updates are allowed
  const validTool = coordinator.appendWork({ id: 'tool-valid', type: 'tool', toolName: 't', status: 'queued' });
  assert.equal(validTool.status, 'queued');
  const activatedTool = coordinator.updateWork('tool-valid', { status: 'active' });
  assert.equal(activatedTool.status, 'active');
  const completedTool = coordinator.updateWork('tool-valid', { status: 'completed' });
  assert.equal(completedTool.status, 'completed');
});

test('regression: late tool update on terminal turn is ignored by coordinator', async () => {
  const coordinator = new TurnLifecycleCoordinator({
    turnId: 'turn-late-tool',
    sessionId: 'sess-lt',
    provider: 'claude',
  });

  coordinator.recordToolStarted({ toolId: 'tool-finished', toolName: 'bash' });
  coordinator.recordToolCompleted({ toolId: 'tool-finished', output: 'ok', status: 'completed' });
  coordinator.settleTerminal({ outcome: 'completed' });

  assert.equal(coordinator.isTerminal, true);

  // Late tool update from background provider
  const result = coordinator.recordToolUpdated({ toolId: 'tool-finished', output: 'late rogue output' });
  assert.equal(result, null);

  const tool = coordinator.turn.work.find(w => w.id === 'tool-finished');
  assert.equal(tool.output, 'ok');
});

test('regression: cross-provider smoke test for Claude, Codex, and Antigravity event streams', async () => {
  const eventsCaptured = [];
  const multiProvider = {
    descriptor: { id: 'multi-test', label: 'Multi Provider', capabilities },
    async startTurn({ emitDelta, emitReasoningDelta, emitProgressDelta, emitToolStarted, emitToolUpdated, emitToolCompleted, emitUsageUpdated }) {
      emitReasoningDelta('Thinking about architecture...');
      emitProgressDelta('Analyzing files...');
      emitDelta('Here is the plan.');
      emitToolStarted({ toolId: 't-multi', toolName: 'search_files', input: { query: 'test' } });
      emitToolUpdated({ toolId: 't-multi', output: '3 files found', status: 'active' });
      emitToolCompleted({ toolId: 't-multi', output: ['a.js', 'b.js'], durationMs: 50, status: 'completed' });
      emitUsageUpdated({ tokensIn: 100, tokensOut: 200, cost: 0.005 });
      emitDelta('Done.');
    },
    async cancelTurn() {},
  };

  const registry = createAgentProviderRegistry([multiProvider]);
  const runtime = createAgentTurnRuntime({ registry });

  const { turnId } = await runtime.startTurn({
    provider: 'multi-test',
    providerSessionId: 'sess-multi',
    message: 'perform multi test',
  });

  const snapshot = await waitFor(() => runtime.getSnapshot(turnId), v => v.status === 'completed', 'completed');
  assert.equal(snapshot.status, 'completed');
  const turn = runtime.getCanonicalTurn(turnId);
  assert.equal(turn.work.length >= 3, true);
  assert.equal(turn.status.status, 'terminal');
  assert.equal(turn.status.outcome, 'completed');
  runtime.shutdown();
});




