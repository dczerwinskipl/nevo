import assert from 'node:assert/strict';
import test from 'node:test';

import { stageForStatus } from '../shared/status-stages.js';

test('maps canonical task statuses to the simplified dashboard lanes', () => {
  assert.equal(stageForStatus('draft'), 'design');
  assert.equal(stageForStatus('approved'), 'ready');
  assert.equal(stageForStatus('in-implementation'), 'implementation');
  assert.equal(stageForStatus('implemented'), 'review');
  assert.equal(stageForStatus('verified'), 'done');
  assert.equal(stageForStatus('archived'), 'done');
  assert.equal(stageForStatus('something-new'), 'new');
});
