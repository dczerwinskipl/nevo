import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAiAdapterRegistry } from '../ai/registry.mjs';
import { createAiTurnRuntime } from '../ai/turn-runtime.mjs';
import { createTranscriptCacheService } from '../ai/transcript-cache.mjs';


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

function createFixture({ sessionLookupGate, transcriptCache } = {}) {
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
        emitToolCompleted({ toolId: 't1', output: ['file.txt'], durationMs: 40 });
        emitUsageUpdated({ tokensIn: 50, tokensOut: 20 });
      } else if (message === 'hang') {
        await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
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
  const runtime = createAiTurnRuntime({
    registry: createAiAdapterRegistry([adapter]),
    transcriptCache: cache,
    idFactory: () => String(++id),
    clock: (() => { let tick = 0; return () => new Date(Date.UTC(2026, 7, 15, 10, 0, tick++)); })(),
  });
  return { runtime, get starts() { return starts; }, get cancels() { return cancels; }, get continuations() { return continuations; } };
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
    await rm(tmpDir, { recursive: true, force: true });
  }
});
