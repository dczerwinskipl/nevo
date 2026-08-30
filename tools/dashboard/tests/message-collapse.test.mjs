import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldCollapseMessage } from '../ui/features/agent-sessions/transcript/message-collapse.ts';

// Task 02, AC4: short messages remain naturally sized — never collapsed.
test('a short message never collapses', () => {
  assert.equal(shouldCollapseMessage(''), false);
  assert.equal(shouldCollapseMessage('Quick question about the build.'), false);
});

// AC4: long user messages collapse by default — either dimension can trigger it.
test('a message with many lines collapses even when individually short', () => {
  const text = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n');
  assert.equal(shouldCollapseMessage(text), true);
});

test('a long single-line message collapses even with no newlines', () => {
  assert.equal(shouldCollapseMessage('x'.repeat(500)), true);
});

test('a message just under both thresholds stays uncollapsed', () => {
  const text = Array.from({ length: 6 }, () => 'short line').join('\n');
  assert.equal(shouldCollapseMessage(text), false);
  assert.ok(text.length < 480);
});
