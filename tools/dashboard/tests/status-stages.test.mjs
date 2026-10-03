import assert from 'node:assert/strict';
import test from 'node:test';

import { stageForStatus, stageForDeterministicState, stageForDeterministicTask } from '../server/specs/status-stages.mjs';

test('maps canonical task statuses to the simplified dashboard lanes', () => {
  assert.equal(stageForStatus('draft'), 'design');
  assert.equal(stageForStatus('approved'), 'ready');
  assert.equal(stageForStatus('in-implementation'), 'implementation');
  assert.equal(stageForStatus('implemented'), 'review');
  assert.equal(stageForStatus('verified'), 'done');
  assert.equal(stageForStatus('archived'), 'done');
  assert.equal(stageForStatus('something-new'), 'new');
});

test('stageForDeterministicState maps pure TaskProjection states to the 6-lane set without step-id branching', () => {
  assert.equal(stageForDeterministicState('draft'), 'design');
  assert.equal(stageForDeterministicState('blocked'), 'ready');
  assert.equal(stageForDeterministicState('ready'), 'ready');
  assert.equal(stageForDeterministicState('active'), 'implementation');
  assert.equal(stageForDeterministicState('human-interaction'), 'review');
  assert.equal(stageForDeterministicState('waiting-for-step-start', 'human'), 'review');
  assert.equal(stageForDeterministicState('waiting-for-step-start', 'agent'), 'implementation');
  assert.equal(stageForDeterministicState('terminal'), 'done');
  assert.equal(stageForDeterministicState('unknown'), 'new');

  // Object signature support
  assert.equal(stageForDeterministicState({ state: 'active', executor: 'agent' }), 'implementation');
  assert.equal(stageForDeterministicState({ state: 'human-interaction', executor: 'human' }), 'review');
  assert.equal(stageForDeterministicTask({ state: 'waiting-for-step-start', executor: 'human' }), 'review');

  // Signature check: function takes (state, executor) and never takes a step id
  assert.equal(stageForDeterministicState.length, 1); // 1 formal parameter with default
});
