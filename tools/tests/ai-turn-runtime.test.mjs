import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAiAdapterRegistry } from '../ai/registry.mjs';
import { createAiTurnRuntime } from '../ai/turn-runtime.mjs';
import { createTranscriptCacheService } from '../ai/transcript-cache.mjs';

const capabilities = {
  interactivePermissions: true,
  interactiveQuestions: true,
  interactiveConfirmations: true,
  resumeSession: false,
  cancelTurn: true,
  toolCalls: true,
  reasoning: true,
  usage: true,
  listSessions: true,
  sessionMetadata: true,
  messages: true,
  createSession: true,
  startTurn: true,
  streamEvents: true,
};

function createFixture({ sessionLookupGate, transcriptCache } = {}) {
  let starts = 0;
  let cancels = 0;
  let status = 'idle';
  const adapter = {
    descriptor: { id: 'fake', label: 'Fake', capabilities },
    async getSession(sessionId) {
      if (sessionLookupGate) await sessionLookupGate;
      return { sessionId, status };
    },
    onTurnState(update) { status = update.sessionStatus; },
    async startTurn({ message, emitDelta, emitTextDelta, emitReasoningDelta, emitToolStarted, emitToolCompleted, emitUsageUpdated, requestInteraction, signal }) {
      starts += 1;
      emitDelta('one ');
      if (message === 'permission') {
        const response = await requestInteraction({ kind: 'permission', toolName: 'Shell', input: { command: 'npm test' } });
        emitDelta(response.decision);
      } else if (message === 'question') {
        const response = await requestInteraction({
          kind: 'question',
          questions: [{ question: 'Same?' }, { question: 'Same?' }],
        });
        emitDelta(response.answers.map(answer => answer.value).join(','));
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
    async cancelTurn() { cancels += 1; },
  };
  let id = 0;
  const runtime = createAiTurnRuntime({
    registry: createAiAdapterRegistry([adapter]),
    transcriptCache,
    idFactory: () => String(++id),
    clock: (() => { let tick = 0; return () => new Date(Date.UTC(2026, 7, 15, 10, 0, tick++)); })(),
  });
  return { runtime, get starts() { return starts; }, get cancels() { return cancels; } };
}

async function waitFor(read, predicate, message = 'condition') {
  for (let index = 0; index < 100; index += 1) {
    const value = read();
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  assert.fail(`Timed out waiting for ${message}.`);
}

test('turns stream ordered deltas (text.delta) and complete with a waiting session', async () => {
  const fixture = createFixture();
  const { turnId } = await fixture.runtime.startTurn({ provider: 'fake', providerSessionId: 's1', message: 'normal' });
  const snapshot = await waitFor(() => fixture.runtime.getSnapshot(turnId), value => value.status === 'completed', 'completion');
  assert.deepEqual(snapshot.events.map(event => event.type), ['turn.started', 'text.delta', 'text.delta', 'turn.completed']);
  assert.deepEqual(snapshot.events.map(event => event.id), [1, 2, 3, 4]);
  assert.equal(snapshot.sessionStatus, 'waitingForUser');
});

test('permission and question interactions pause, resolve by stable IDs, and continue the same turn', async () => {
  const fixture = createFixture();
  const permission = await fixture.runtime.startTurn({ provider: 'fake', providerSessionId: 'permission', message: 'permission' });
  const paused = await waitFor(() => fixture.runtime.getSnapshot(permission.turnId), value => value.pendingInteraction, 'permission');
  assert.equal(paused.status, 'waitingForUser');
  await fixture.runtime.resolveInteraction(permission.turnId, paused.pendingInteraction.id, { decision: 'allow' });
  const completed = await waitFor(() => fixture.runtime.getSnapshot(permission.turnId), value => value.status === 'completed', 'permission completion');
  assert.equal(completed.events.filter(event => event.type === 'turn.started').length, 1);

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

test('unsubscribe does not cancel and reconnect replays missed events plus pending snapshot', async () => {
  const fixture = createFixture();
  const { turnId } = await fixture.runtime.startTurn({ provider: 'fake', providerSessionId: 'reconnect', message: 'permission' });
  const firstEvents = [];
  const unsubscribe = fixture.runtime.subscribe(turnId, { onEvent: event => firstEvents.push(event) });
  unsubscribe();
  const paused = await waitFor(() => fixture.runtime.getSnapshot(turnId), value => value.pendingInteraction, 'pending interaction');
  assert.equal(fixture.cancels, 0);
  const replay = [];
  const close = fixture.runtime.subscribe(turnId, { afterSequence: 1, onEvent: event => replay.push(event) });
  assert.ok(replay.some(event => event.type === 'interaction.requested'));
  assert.equal(paused.pendingInteraction.kind, 'permission');
  close();
  fixture.runtime.shutdown();
});

test('explicit cancellation is capability-aware and produces one terminal event', async () => {
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
  assert.equal(snapshot.sessionId, 'shutdown');
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

  await new Promise(resolve => setImmediate(resolve));
  releaseLookup();
  const results = await Promise.allSettled(starts);
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

