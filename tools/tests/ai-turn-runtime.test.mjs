import assert from 'node:assert/strict';
import test from 'node:test';
import { createAiAdapterRegistry } from '../ai/registry.mjs';
import { createAiTurnRuntime } from '../ai/turn-runtime.mjs';

const capabilities = {
  listSessions: true,
  sessionMetadata: true,
  messages: true,
  createSession: true,
  startTurn: true,
  streamEvents: true,
  resumeTurn: false,
  resolveInteractions: true,
  cancelTurn: true,
};

function createFixture() {
  let starts = 0;
  let cancels = 0;
  let status = 'idle';
  const adapter = {
    descriptor: { id: 'fake', label: 'Fake', capabilities },
    async getSession(sessionId) {
      return { sessionId, status };
    },
    onTurnState(update) { status = update.sessionStatus; },
    async startTurn({ message, emitDelta, requestInteraction, signal }) {
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

test('turns stream ordered deltas and complete with a waiting session', async () => {
  const fixture = createFixture();
  const { turnId } = await fixture.runtime.startTurn({ provider: 'fake', sessionId: 's1', message: 'normal' });
  const snapshot = await waitFor(() => fixture.runtime.getSnapshot(turnId), value => value.status === 'completed', 'completion');
  assert.deepEqual(snapshot.events.map(event => event.type), ['turn.started', 'message.delta', 'message.delta', 'turn.completed']);
  assert.deepEqual(snapshot.events.map(event => event.id), [1, 2, 3, 4]);
  assert.equal(snapshot.sessionStatus, 'waitingForUser');
});

test('permission and question interactions pause, resolve by stable IDs, and continue the same turn', async () => {
  const fixture = createFixture();
  const permission = await fixture.runtime.startTurn({ provider: 'fake', sessionId: 'permission', message: 'permission' });
  const paused = await waitFor(() => fixture.runtime.getSnapshot(permission.turnId), value => value.pendingInteraction, 'permission');
  assert.equal(paused.status, 'waitingForUser');
  await fixture.runtime.resolveInteraction(permission.turnId, paused.pendingInteraction.id, { decision: 'allow' });
  const completed = await waitFor(() => fixture.runtime.getSnapshot(permission.turnId), value => value.status === 'completed', 'permission completion');
  assert.equal(completed.events.filter(event => event.type === 'turn.started').length, 1);

  const question = await fixture.runtime.startTurn({ provider: 'fake', sessionId: 'question', message: 'question' });
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
  const first = await fixture.runtime.startTurn({ provider: 'fake', sessionId: 'first', message: 'permission' });
  const second = await fixture.runtime.startTurn({ provider: 'fake', sessionId: 'second', message: 'permission' });
  const one = await waitFor(() => fixture.runtime.getSnapshot(first.turnId), value => value.pendingInteraction, 'first pending');
  const two = await waitFor(() => fixture.runtime.getSnapshot(second.turnId), value => value.pendingInteraction, 'second pending');
  await assert.rejects(() => fixture.runtime.resolveInteraction(first.turnId, two.pendingInteraction.id, { decision: 'allow' }), { name: 'AiNotFoundError' });
  await fixture.runtime.resolveInteraction(first.turnId, one.pendingInteraction.id, { decision: 'deny' });
  await assert.rejects(() => fixture.runtime.resolveInteraction(first.turnId, one.pendingInteraction.id, { decision: 'deny' }), { name: 'AiNotFoundError' });
  fixture.runtime.shutdown();
});

test('unsubscribe does not cancel and reconnect replays missed events plus pending snapshot', async () => {
  const fixture = createFixture();
  const { turnId } = await fixture.runtime.startTurn({ provider: 'fake', sessionId: 'reconnect', message: 'permission' });
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
  const { turnId } = await fixture.runtime.startTurn({ provider: 'fake', sessionId: 'cancel', message: 'hang' });
  await waitFor(() => fixture.runtime.getSnapshot(turnId), value => value.events.length >= 2, 'started turn');
  const snapshot = await fixture.runtime.cancelTurn(turnId);
  assert.equal(fixture.cancels, 1);
  assert.equal(snapshot.events.filter(event => event.type === 'turn.failed').length, 1);
  await fixture.runtime.cancelTurn(turnId);
  assert.equal(fixture.cancels, 1);
});

test('shutdown interrupts active turns without losing session identity', async () => {
  const fixture = createFixture();
  const { turnId } = await fixture.runtime.startTurn({ provider: 'fake', sessionId: 'shutdown', message: 'hang' });
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
  const first = await fixture.runtime.startTurn({ provider: 'fake', sessionId: 'locked', message: 'hang', idempotencyKey: 'request-1' });
  const retry = await fixture.runtime.startTurn({ provider: 'fake', sessionId: 'locked', message: 'hang', idempotencyKey: 'request-1' });
  assert.deepEqual(retry, { turnId: first.turnId, idempotent: true });
  await assert.rejects(() => fixture.runtime.startTurn({ provider: 'fake', sessionId: 'locked', message: 'hang', idempotencyKey: 'request-2' }), error => {
    assert.equal(error.code, 'AI_TURN_CONFLICT');
    assert.equal(error.turnId, first.turnId);
    return true;
  });
  assert.equal(fixture.starts, 1);
  fixture.runtime.shutdown();
});
