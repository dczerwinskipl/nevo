import assert from 'node:assert/strict';
import test from 'node:test';
import { TurnEventStream, createTurnEventStream } from '../server/ai/sessions/turns/turn-event-stream.mjs';

function createMockTurnState({ turnId = 'turn-1', provider = 'fake', providerSessionId = 'sess-1', status = 'running', initialSeq = 0 } = {}) {
  return {
    turnId,
    provider,
    providerSessionId,
    status,
    sequence: initialSeq,
    events: [],
    subscribers: new Set(),
  };
}

test('TurnEventStream: monotonic per-session sequencing across turns', () => {
  const stream = createTurnEventStream();
  const state1 = createMockTurnState({ turnId: 'turn-1', provider: 'fake', providerSessionId: 'sess-seq', initialSeq: 0 });
  const state2 = createMockTurnState({ turnId: 'turn-2', provider: 'fake', providerSessionId: 'sess-seq', initialSeq: 0 });

  const ev1 = stream.emit(state1, 'text.delta', { text: 'hello' });
  const ev2 = stream.emit(state1, 'text.delta', { text: ' world' });

  assert.equal(ev1.seq, 1);
  assert.equal(ev2.seq, 2);
  assert.equal(state1.sequence, 2);

  const ev3 = stream.emit(state2, 'text.delta', { text: 'second turn' });
  assert.equal(ev3.seq, 3);
  assert.equal(state2.sequence, 3);
  assert.equal(stream.getSessionSequence('fake', 'sess-seq'), 3);
});

test('TurnEventStream: turn replay after cursor and live event delivery', () => {
  const stream = createTurnEventStream();
  const state = createMockTurnState({ turnId: 'turn-replay', provider: 'fake', providerSessionId: 'sess-replay' });

  stream.emit(state, 'text.delta', { text: 'msg 1' });
  stream.emit(state, 'text.delta', { text: 'msg 2' });
  stream.emit(state, 'text.delta', { text: 'msg 3' });

  const replayed = stream.getEvents(state.events, 1);
  assert.equal(replayed.length, 2);
  assert.equal(replayed[0].seq, 2);
  assert.equal(replayed[1].seq, 3);

  const received = [];
  const unsubscribe = stream.subscribeToTurn(state, {
    afterSequence: 2,
    onEvent: (event) => received.push(event),
  });

  assert.equal(received.length, 1);
  assert.equal(received[0].seq, 3);

  stream.emit(state, 'text.delta', { text: 'msg 4' });
  assert.equal(received.length, 2);
  assert.equal(received[1].seq, 4);

  unsubscribe();
  stream.emit(state, 'text.delta', { text: 'msg 5' });
  assert.equal(received.length, 2, 'Unsubscribed callback must not receive further events');
});

test('TurnEventStream: session replay after cursor and multi-turn subscriber', () => {
  const stream = createTurnEventStream();
  const stateA = createMockTurnState({ turnId: 'turn-a', provider: 'fake', providerSessionId: 'sess-multi' });
  const stateB = createMockTurnState({ turnId: 'turn-b', provider: 'fake', providerSessionId: 'sess-multi' });

  stream.emit(stateA, 'turn.started', { mode: 'edit' });
  stream.emit(stateA, 'text.delta', { text: 'turn A delta' });

  const sessionReceived = [];
  const unsubSession = stream.subscribeToSession(
    { provider: 'fake', providerSessionId: 'sess-multi' },
    {
      afterSequence: 1,
      onEvent: (event) => sessionReceived.push(event),
    }
  );

  assert.equal(sessionReceived.length, 1);
  assert.equal(sessionReceived[0].seq, 2);

  stream.emit(stateB, 'text.delta', { text: 'turn B delta' });
  assert.equal(sessionReceived.length, 2);
  assert.equal(sessionReceived[1].turnId, 'turn-b');
  assert.equal(sessionReceived[1].seq, 3);

  unsubSession();
  stream.emit(stateB, 'text.delta', { text: 'turn B delta 2' });
  assert.equal(sessionReceived.length, 2, 'Unsubscribed session callback must not receive further events');
});

test('TurnEventStream: subscriber cleanup when turn reaches terminal state', () => {
  const stream = createTurnEventStream();
  const state = createMockTurnState({ turnId: 'turn-term', provider: 'fake', providerSessionId: 'sess-term', status: 'completed' });

  const received = [];
  const unsub = stream.subscribeToTurn(state, {
    afterSequence: 0,
    onEvent: (event) => received.push(event),
  });

  assert.equal(state.subscribers.size, 0, 'Terminal turn should not retain new subscribers in its Set');
  unsub();
});

test('TurnEventStream: bounded event retention in turn buffer', () => {
  const stream = createTurnEventStream({ maxEventsPerTurn: 5 });
  const state = createMockTurnState({ turnId: 'turn-bounded', provider: 'fake', providerSessionId: 'sess-bounded' });

  for (let i = 1; i <= 8; i++) {
    stream.emit(state, 'text.delta', { i });
  }

  assert.equal(state.events.length, 5);
  assert.equal(state.events[0].i, 4);
  assert.equal(state.events[4].i, 8);
});
