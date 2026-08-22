import assert from 'node:assert/strict';
import test from 'node:test';

import { visibleWorkItemsWhenTerminal, visibleWorkItemsWhileRunning } from '../src/components/work/work-visibility.ts';
import { projectChat } from '../src/lib/chat-projection.ts';

function item(id, status, overrides = {}) {
  return { toolId: id, toolName: `tool-${id}`, input: {}, status, ...overrides };
}

// owner-decisions.md, AC1: a turn producing multiple successful tool calls collapses to
// one Work entry (verified via the same projection Task 03 consumes, not re-derived here).
test('a turn with 5+ successful tool calls collapses to one Work group, not one card per call', () => {
  const messages = [
    {
      id: 'm1',
      role: 'assistant',
      text: 'done',
      turnId: 'turn-1',
      createdAt: '2026-08-22T10:00:00Z',
      toolCalls: Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, name: 'Read', input: {}, status: 'completed' })),
    },
  ];
  const { workByTurn } = projectChat(messages);
  assert.equal(workByTurn.length, 1);
  assert.equal(workByTurn[0].items.length, 6);
});

// owner-decisions.md, AC3: completed Work is expandable to inspect all individual actions.
test('visibleWorkItemsWhenTerminal reveals every action once expanded', () => {
  const work = {
    turnId: 'turn-1',
    messageId: 'm1',
    status: 'completed',
    items: [item('t1', 'completed'), item('t2', 'completed'), item('t3', 'completed')],
  };

  assert.deepEqual(visibleWorkItemsWhenTerminal(work, false), []);
  assert.deepEqual(visibleWorkItemsWhenTerminal(work, true), work.items);
});

// owner-decisions.md, AC5: a failed action is visibly flagged and remains individually
// inspectable even while the rest of the group is collapsed.
test('visibleWorkItemsWhenTerminal keeps failed actions visible while collapsed', () => {
  const work = {
    turnId: 'turn-1',
    messageId: 'm1',
    status: 'failed',
    items: [item('t1', 'completed'), item('t2', 'failed'), item('t3', 'completed')],
  };

  const collapsed = visibleWorkItemsWhenTerminal(work, false);
  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0].toolId, 't2');

  const expanded = visibleWorkItemsWhenTerminal(work, true);
  assert.equal(expanded.length, 3);
});

test('visibleWorkItemsWhileRunning never duplicates the current running item, only prior ones once expanded', () => {
  const work = {
    turnId: 'turn-1',
    messageId: 'm1',
    status: 'current',
    items: [item('t1', 'completed'), item('t2', 'running')],
  };

  assert.deepEqual(visibleWorkItemsWhileRunning(work, false), []);
  const expanded = visibleWorkItemsWhileRunning(work, true);
  assert.equal(expanded.length, 1);
  assert.equal(expanded[0].toolId, 't1');
});

// owner-decisions.md, AC2: while running, a new tool replaces the current slot rather
// than appending another full card.
test('a new tool call becomes the sole currentActivity, replacing the previous one', () => {
  const messages = [
    {
      id: 'm1',
      role: 'assistant',
      text: '',
      turnId: 'turn-1',
      createdAt: '2026-08-22T10:00:00Z',
      toolCalls: [
        { id: 't1', name: 'Read', input: {}, status: 'completed' },
        { id: 't2', name: 'Bash', input: {}, status: 'running' },
      ],
    },
  ];
  const { currentActivity, workByTurn } = projectChat(messages, { activeTurnId: 'turn-1' });
  assert.equal(currentActivity?.toolId, 't2');
  assert.equal(workByTurn[0].status, 'current');
});

// owner-decisions.md, AC6: Work from unrelated turns is not merged.
test('two sequential turns each with tool calls produce two separate Work groups', () => {
  const messages = [
    { id: 'm1', role: 'assistant', text: '', turnId: 'turn-1', createdAt: '2026-08-22T10:00:00Z', toolCalls: [{ id: 't1', name: 'Read', input: {}, status: 'completed' }] },
    { id: 'm2', role: 'assistant', text: '', turnId: 'turn-2', createdAt: '2026-08-22T10:01:00Z', toolCalls: [{ id: 't2', name: 'Bash', input: {}, status: 'completed' }] },
  ];
  const { workByTurn } = projectChat(messages);
  assert.equal(workByTurn.length, 2);
});
