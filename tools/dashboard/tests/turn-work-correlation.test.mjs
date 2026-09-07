import assert from 'node:assert/strict';
import test from 'node:test';

import { applyTurnUpdated } from '../ui/features/agent-sessions/runtime/agent-session-runtime.ts';

function canonicalTurn(id, overrides = {}) {
  return {
    id,
    turnId: id,
    sessionId: 's1',
    provider: 'claude',
    providerSessionId: 's1',
    mode: 'agent',
    status: { status: 'active', detail: 'processing', since: '', source: 'coordinator' },
    work: [],
    historicalWork: [],
    activityCount: 0,
    currentActivity: null,
    finalAnswer: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

test('Turn snapshot correlation: multiple turn.updated snapshots for the same turn.id correlate to exactly one entry, always the latest', () => {
  let turns = [];
  turns = applyTurnUpdated(turns, canonicalTurn('turn-1', { activityCount: 0 }));
  turns = applyTurnUpdated(turns, canonicalTurn('turn-1', { activityCount: 1 }));
  turns = applyTurnUpdated(turns, canonicalTurn('turn-1', { activityCount: 2 }));

  assert.equal(turns.length, 1, 'one turn.id must correlate to exactly one entry, never a growing history');
  assert.equal(turns[0].activityCount, 2, 'the latest snapshot must win — this is a full replace, not a delta merge');
});

test('Turn snapshot correlation: turn A stays byte-identical when turn B receives a turn.updated snapshot', () => {
  const turnA = canonicalTurn('turn-A', { activityCount: 3 });
  let turns = [turnA];
  turns = applyTurnUpdated(turns, canonicalTurn('turn-B', { activityCount: 1 }));
  turns = applyTurnUpdated(
    turns,
    canonicalTurn('turn-B', {
      activityCount: 1,
      status: { status: 'terminal', outcome: 'completed', initiator: 'provider', since: '', source: 'coordinator' },
    }),
  );

  assert.equal(
    turns.find((t) => t.id === 'turn-A'),
    turnA,
    'a terminal event for turn B must never touch turn A',
  );
  assert.equal(turns.find((t) => t.id === 'turn-B').status.status, 'terminal');
});

test('Turn snapshot correlation: replaying the same turn.updated snapshot twice (SSE reconnect replay) is idempotent, no duplication', () => {
  const snapshot = canonicalTurn('turn-1', { activityCount: 5 });
  let turns = [];
  turns = applyTurnUpdated(turns, snapshot);
  const afterFirst = turns;
  turns = applyTurnUpdated(turns, snapshot);
  assert.equal(turns, afterFirst, 'replaying an identical snapshot must not produce a new array/entry');
  assert.equal(turns.length, 1);
});
