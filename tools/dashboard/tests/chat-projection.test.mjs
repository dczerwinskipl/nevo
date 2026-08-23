import assert from 'node:assert/strict';
import test from 'node:test';

import { projectChat } from '../src/lib/chat-projection.ts';

function userMsg(id, text, createdAt = '2026-08-22T10:00:00Z') {
  return { id, role: 'user', text, createdAt };
}

function assistantMsg({ id, turnId, text = '', reasoning, toolCalls, turnError, createdAt = '2026-08-22T10:00:01Z' }) {
  return {
    id,
    role: 'assistant',
    text,
    turnId,
    createdAt,
    ...(reasoning === undefined ? {} : { reasoning }),
    ...(toolCalls === undefined ? {} : { toolCalls }),
    ...(turnError === undefined ? {} : { turnError }),
  };
}

test('projectChat groups a multi-tool-call turn into one Work entry, not one per tool', () => {
  const messages = [
    userMsg('u1', 'do the thing'),
    assistantMsg({
      id: 'm1',
      turnId: 'turn-1',
      text: 'done',
      toolCalls: [
        { id: 't1', name: 'Read', input: { path: 'a.ts' }, output: 'contents', status: 'completed', durationMs: 5 },
        { id: 't2', name: 'Bash', input: { command: 'ls' }, output: 'file.txt', status: 'completed', durationMs: 12 },
      ],
    }),
  ];

  const { workByTurn } = projectChat(messages);
  assert.equal(workByTurn.length, 1);
  assert.equal(workByTurn[0].turnId, 'turn-1');
  assert.equal(workByTurn[0].items.length, 2);
  assert.equal(workByTurn[0].status, 'completed');
});

test('projectChat marks a turn current while its active tool is still running, and surfaces it as currentActivity', () => {
  const messages = [
    userMsg('u1', 'go'),
    assistantMsg({
      id: 'm1',
      turnId: 'turn-1',
      toolCalls: [
        { id: 't1', name: 'Read', input: {}, status: 'completed' },
        { id: 't2', name: 'Bash', input: { command: 'npm test' }, status: 'running' },
      ],
    }),
  ];

  const { workByTurn, currentActivity } = projectChat(messages, { activeTurnId: 'turn-1' });
  assert.equal(workByTurn[0].status, 'current');
  assert.equal(currentActivity?.toolId, 't2');
});

test('projectChat flags a turn with any failed tool call, even once the turn itself is no longer active', () => {
  const messages = [
    userMsg('u1', 'go'),
    assistantMsg({
      id: 'm1',
      turnId: 'turn-1',
      toolCalls: [
        { id: 't1', name: 'Read', input: {}, status: 'completed' },
        { id: 't2', name: 'Bash', input: { command: 'bad-cmd' }, status: 'failed' },
      ],
    }),
  ];

  const { workByTurn } = projectChat(messages, { activeTurnId: null });
  assert.equal(workByTurn[0].status, 'failed');
});

test('projectChat surfaces a turn that failed with no tool calls at all via turnError, not silently dropped', () => {
  const messages = [
    userMsg('u1', 'go'),
    assistantMsg({ id: 'm1', turnId: 'turn-1', turnError: { code: 'AI_PROVIDER_EXIT_ERROR', message: 'process crashed' } }),
  ];

  const { workByTurn, turnOutcome } = projectChat(messages);
  assert.equal(workByTurn.length, 1);
  assert.equal(workByTurn[0].status, 'failed');
  assert.deepEqual(workByTurn[0].turnError, { code: 'AI_PROVIDER_EXIT_ERROR', message: 'process crashed' });
  assert.deepEqual(turnOutcome, { turnId: 'turn-1', turnError: { code: 'AI_PROVIDER_EXIT_ERROR', message: 'process crashed' } });
});

test('projectChat does not merge Work from two unrelated turns', () => {
  const messages = [
    userMsg('u1', 'first'),
    assistantMsg({ id: 'm1', turnId: 'turn-1', toolCalls: [{ id: 't1', name: 'Read', input: {}, status: 'completed' }] }),
    userMsg('u2', 'second'),
    assistantMsg({ id: 'm2', turnId: 'turn-2', toolCalls: [{ id: 't2', name: 'Bash', input: {}, status: 'completed' }] }),
  ];

  const { workByTurn } = projectChat(messages);
  assert.equal(workByTurn.length, 2);
  assert.deepEqual(workByTurn.map(w => w.turnId), ['turn-1', 'turn-2']);
  assert.equal(workByTurn[0].items[0].toolId, 't1');
  assert.equal(workByTurn[1].items[0].toolId, 't2');
});

test('projectChat reports the most recent non-active turn outcome as successful when it has no turnError', () => {
  const messages = [
    userMsg('u1', 'go'),
    assistantMsg({ id: 'm1', turnId: 'turn-1', toolCalls: [{ id: 't1', name: 'Read', input: {}, status: 'completed' }] }),
  ];

  const { turnOutcome } = projectChat(messages, { activeTurnId: null });
  assert.deepEqual(turnOutcome, { turnId: 'turn-1', turnError: null });
});

test('projectChat excludes the currently active turn from turnOutcome', () => {
  const messages = [
    userMsg('u1', 'go'),
    assistantMsg({ id: 'm1', turnId: 'turn-1', toolCalls: [{ id: 't1', name: 'Read', input: {}, status: 'running' }] }),
  ];

  const { turnOutcome } = projectChat(messages, { activeTurnId: 'turn-1' });
  assert.equal(turnOutcome, null);
});

test('projectChat preserves raw technical detail (toolName, input, output, duration, status) on Work items', () => {
  const messages = [
    assistantMsg({
      id: 'm1',
      turnId: 'turn-1',
      toolCalls: [{ id: 't1', name: 'Bash', input: { command: 'npm test' }, output: 'ok', status: 'completed', durationMs: 42 }],
    }),
  ];

  const { workByTurn } = projectChat(messages);
  assert.deepEqual(workByTurn[0].items[0], {
    toolId: 't1',
    toolName: 'Bash',
    input: { command: 'npm test' },
    output: 'ok',
    status: 'completed',
    durationMs: 42,
  });
});

// Required coverage A (follow-up review, Finding 1): an active turn containing
// completed, failed, and running actions stays 'current' — a failed historical action
// must never prematurely terminate an otherwise still-active turn's Work group.
test('A: an active turn with a mix of completed, failed, and running actions stays current, with hasFailures retained', () => {
  const messages = [
    userMsg('u1', 'go'),
    assistantMsg({
      id: 'm1',
      turnId: 'turn-1',
      toolCalls: [
        { id: 't1', name: 'Read', input: { path: 'a.ts' }, status: 'failed' },
        { id: 't2', name: 'Bash', input: { command: 'npm test' }, status: 'completed' },
        { id: 't3', name: 'Edit', input: { path: 'b.ts' }, status: 'running' },
      ],
    }),
  ];

  const { workByTurn, currentActivity } = projectChat(messages, { activeTurnId: 'turn-1' });
  assert.equal(workByTurn.length, 1);
  assert.equal(workByTurn[0].status, 'current', 'lifecycle stays current despite the earlier failure');
  assert.equal(workByTurn[0].hasFailures, true, 'failure information is retained');
  assert.equal(workByTurn[0].items.length, 3, 'the failed historical action is not dropped');
  assert.equal(currentActivity?.toolId, 't3', 'the running action remains current activity');
});

// Required coverage C (follow-up review): a terminal turn with a failure surfaces
// hasFailures/status: 'failed', independent of the lifecycle question above.
test('C: a terminal turn with a failed action reports status failed and hasFailures true', () => {
  const messages = [
    userMsg('u1', 'go'),
    assistantMsg({
      id: 'm1',
      turnId: 'turn-1',
      toolCalls: [
        { id: 't1', name: 'Read', input: {}, status: 'completed' },
        { id: 't2', name: 'Bash', input: {}, status: 'failed' },
      ],
    }),
  ];

  const { workByTurn } = projectChat(messages, { activeTurnId: null });
  assert.equal(workByTurn[0].status, 'failed');
  assert.equal(workByTurn[0].hasFailures, true);
});

// Required coverage H (follow-up review): one turn with both tool activity and
// assistant prose produces exactly one Work group alongside the prose-bearing message.
test('H: a turn with both tool activity and assistant prose produces one Work group and preserves the prose', () => {
  const messages = [
    userMsg('u1', 'go'),
    assistantMsg({
      id: 'm1',
      turnId: 'turn-1',
      text: 'Here is what I found.',
      toolCalls: [{ id: 't1', name: 'Read', input: { path: 'a.ts' }, status: 'completed' }],
    }),
  ];

  const { workByTurn, conversation } = projectChat(messages, { activeTurnId: null });
  assert.equal(workByTurn.length, 1);
  assert.equal(workByTurn[0].turnId, 'turn-1');
  const assistantEntry = conversation.find(entry => entry.id === 'm1');
  assert.equal(assistantEntry.text, 'Here is what I found.');
});

test('projectChat carries turnId onto conversation entries without merging distinct turns', () => {
  const messages = [
    userMsg('u1', 'first'),
    assistantMsg({ id: 'm1', turnId: 'turn-1', text: 'first reply' }),
    userMsg('u2', 'second'),
    assistantMsg({ id: 'm2', turnId: 'turn-2', text: 'second reply' }),
  ];

  const { conversation } = projectChat(messages);
  assert.deepEqual(conversation.map(entry => entry.turnId), [undefined, 'turn-1', undefined, 'turn-2']);
  assert.deepEqual(conversation.map(entry => entry.text), ['first', 'first reply', 'second', 'second reply']);
});

test('projectChat selects the newest started running tool as currentActivity when multiple are running', () => {
  const messages = [
    userMsg('u1', 'run both'),
    assistantMsg({
      id: 'm1',
      turnId: 'turn-1',
      toolCalls: [
        { id: 't1', name: 'Read', input: { path: 'first.ts' }, status: 'running' },
        { id: 't2', name: 'Bash', input: { command: 'ls' }, status: 'running' },
      ],
    }),
  ];

  const { workByTurn, currentActivity } = projectChat(messages, { activeTurnId: 'turn-1' });
  assert.equal(workByTurn.length, 1);
  assert.equal(workByTurn[0].status, 'current');
  assert.equal(workByTurn[0].currentActivity?.toolId, 't2', 'turn currentActivity must be the newest running tool t2');
  assert.equal(currentActivity?.toolId, 't2', 'projection currentActivity must be the newest running tool t2');
});
