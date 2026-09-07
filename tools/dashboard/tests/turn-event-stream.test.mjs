import assert from 'node:assert/strict';
import test from 'node:test';
import { createTurnEventStream } from '../server/ai/sessions/turns/turn-event-stream.mjs';

test('TurnEventStream: monotonic per-session sequencing across turns', () => {
  const stream = createTurnEventStream();
  stream.registerTurn({ turnId: 'turn-1', provider: 'fake', providerSessionId: 'sess-seq', initialSequence: 0 });
  stream.registerTurn({ turnId: 'turn-2', provider: 'fake', providerSessionId: 'sess-seq', initialSequence: 0 });

  const ev1 = stream.emit('turn-1', 'text.delta', { text: 'hello' });
  const ev2 = stream.emit('turn-1', 'text.delta', { text: ' world' });

  assert.equal(ev1.seq, 1);
  assert.equal(ev2.seq, 2);
  assert.equal(stream.getTurnSequence('turn-1'), 2);

  const ev3 = stream.emit('turn-2', 'text.delta', { text: 'second turn' });
  assert.equal(ev3.seq, 3);
  assert.equal(stream.getTurnSequence('turn-2'), 3);
  assert.equal(stream.getSessionSequence('fake', 'sess-seq'), 3);
});

test('TurnEventStream: per-turn buffer ownership and replay after cursor', () => {
  const stream = createTurnEventStream();
  stream.registerTurn({ turnId: 'turn-replay', provider: 'fake', providerSessionId: 'sess-replay' });

  stream.emit('turn-replay', 'text.delta', { text: 'msg 1' });
  stream.emit('turn-replay', 'text.delta', { text: 'msg 2' });
  stream.emit('turn-replay', 'text.delta', { text: 'msg 3' });

  const replayed = stream.getTurnEvents('turn-replay', 1);
  assert.equal(replayed.length, 2);
  assert.equal(replayed[0].seq, 2);
  assert.equal(replayed[1].seq, 3);

  const received = [];
  const unsubscribe = stream.subscribeToTurn('turn-replay', {
    afterSequence: 2,
    onEvent: (event) => received.push(event),
  });

  assert.equal(received.length, 1);
  assert.equal(received[0].seq, 3);

  stream.emit('turn-replay', 'text.delta', { text: 'msg 4' });
  assert.equal(received.length, 2);
  assert.equal(received[1].seq, 4);

  unsubscribe();
  stream.emit('turn-replay', 'text.delta', { text: 'msg 5' });
  assert.equal(received.length, 2, 'Unsubscribed callback must not receive further events');
});

test('TurnEventStream: session replay after cursor and multi-turn subscriber', () => {
  const stream = createTurnEventStream();
  stream.registerTurn({ turnId: 'turn-a', provider: 'fake', providerSessionId: 'sess-multi' });
  stream.registerTurn({ turnId: 'turn-b', provider: 'fake', providerSessionId: 'sess-multi' });

  stream.emit('turn-a', 'turn.started', { mode: 'edit' });
  stream.emit('turn-a', 'text.delta', { text: 'turn A delta' });

  const sessionReceived = [];
  const unsubSession = stream.subscribeToSession(
    { provider: 'fake', providerSessionId: 'sess-multi' },
    {
      afterSequence: 1,
      onEvent: (event) => sessionReceived.push(event),
    },
  );

  assert.equal(sessionReceived.length, 1);
  assert.equal(sessionReceived[0].seq, 2);

  stream.emit('turn-b', 'text.delta', { text: 'turn B delta' });
  assert.equal(sessionReceived.length, 2);
  assert.equal(sessionReceived[1].turnId, 'turn-b');
  assert.equal(sessionReceived[1].seq, 3);

  unsubSession();
  stream.emit('turn-b', 'text.delta', { text: 'turn B delta 2' });
  assert.equal(sessionReceived.length, 2, 'Unsubscribed session callback must not receive further events');
});

test('TurnEventStream: subscriber cleanup on terminal turn and clearTurnSubscribers', () => {
  const stream = createTurnEventStream();
  stream.registerTurn({ turnId: 'turn-term', provider: 'fake', providerSessionId: 'sess-term' });

  const received = [];
  stream.subscribeToTurn('turn-term', {
    afterSequence: 0,
    onEvent: (event) => received.push(event),
    isTerminal: true,
  });

  stream.emit('turn-term', 'text.delta', { text: 'after term sub' });
  assert.equal(received.length, 0, 'Terminal turn should not register live subscriber');

  const liveReceived = [];
  stream.subscribeToTurn('turn-term', {
    afterSequence: 0,
    onEvent: (event) => liveReceived.push(event),
    isTerminal: false,
  });
  assert.equal(liveReceived.length, 1);

  stream.clearTurnSubscribers('turn-term');
  stream.emit('turn-term', 'text.delta', { text: 'after clear' });
  assert.equal(liveReceived.length, 1, 'Cleared subscribers must not receive new events');
});

test('TurnEventStream: bounded event retention in turn buffer', () => {
  const stream = createTurnEventStream({ maxEventsPerTurn: 5 });
  stream.registerTurn({ turnId: 'turn-bounded', provider: 'fake', providerSessionId: 'sess-bounded' });

  for (let i = 1; i <= 8; i++) {
    stream.emit('turn-bounded', 'text.delta', { i });
  }

  const events = stream.getTurnEvents('turn-bounded', 0);
  assert.equal(events.length, 5);
  assert.equal(events[0].i, 4);
  assert.equal(events[4].i, 8);
});

test('TurnEventStream: dynamic session binding propagates existing and future events', () => {
  let cacheApplied = [];
  const mockCache = {
    async applyEvent(p, s, ev) {
      cacheApplied.push({ p, s, ev });
    },
  };

  const stream = createTurnEventStream({ transcriptCache: mockCache });
  stream.registerTurn({ turnId: 'turn-unbound', initialSequence: 0 });

  const ev1 = stream.emit('turn-unbound', 'turn.started', { mode: 'edit' });
  assert.equal(ev1.seq, 1);

  stream.bindSession('turn-unbound', { provider: 'fake', providerSessionId: 'sess-dynamic' });

  const ev2 = stream.emit('turn-unbound', 'text.delta', { text: 'after bind' });
  assert.equal(ev2.seq, 2);
  assert.equal(cacheApplied.length, 1);
  assert.equal(cacheApplied[0].p, 'fake');
  assert.equal(cacheApplied[0].s, 'sess-dynamic');
  assert.equal(cacheApplied[0].ev.seq, 2);
});
