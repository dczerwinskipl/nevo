import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { projectTranscript } from '../ui/features/agent-sessions/transcript/projection.ts';
import { buildTimelineRowsV2 } from '../ui/features/agent-sessions/work-v2/timeline-projection-v2.ts';

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

test('projectTranscript groups a multi-tool-call turn into one Work entry, not one per tool', () => {
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

  const { workByTurn } = projectTranscript(messages);
  assert.equal(workByTurn.length, 1);
  assert.equal(workByTurn[0].turnId, 'turn-1');
  assert.equal(workByTurn[0].items.length, 2);
  assert.equal(workByTurn[0].status, 'completed');
});

test('projectTranscript marks a turn current while its active tool is still running, and surfaces it as currentActivity', () => {
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

  const { workByTurn, currentActivity } = projectTranscript(messages, { activeTurnId: 'turn-1' });
  assert.equal(workByTurn[0].status, 'current');
  assert.equal(currentActivity?.toolId, 't2');
});

test('projectTranscript flags a turn with any failed tool call with severity warning and hasFailures true', () => {
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

  const { workByTurn } = projectTranscript(messages, { activeTurnId: null });
  assert.equal(workByTurn[0].status, 'completed', 'turn completed its execution');
  assert.equal(workByTurn[0].severity, 'warning', 'tool failure is a warning, not a turn error');
  assert.equal(workByTurn[0].hasFailures, true);
});

test('projectTranscript surfaces a turn that failed with no tool calls at all via turnError, not silently dropped', () => {
  const messages = [
    userMsg('u1', 'go'),
    assistantMsg({
      id: 'm1',
      turnId: 'turn-1',
      turnError: { code: 'AI_PROVIDER_EXIT_ERROR', message: 'process crashed' },
    }),
  ];

  const { workByTurn, turnOutcome } = projectTranscript(messages);
  assert.equal(workByTurn.length, 1);
  assert.equal(workByTurn[0].status, 'failed');
  assert.deepEqual(workByTurn[0].turnError, { code: 'AI_PROVIDER_EXIT_ERROR', message: 'process crashed' });
  assert.deepEqual(turnOutcome, {
    turnId: 'turn-1',
    turnError: { code: 'AI_PROVIDER_EXIT_ERROR', message: 'process crashed' },
  });
});

test('projectTranscript does not merge Work from two unrelated turns', () => {
  const messages = [
    userMsg('u1', 'first'),
    assistantMsg({
      id: 'm1',
      turnId: 'turn-1',
      toolCalls: [{ id: 't1', name: 'Read', input: {}, status: 'completed' }],
    }),
    userMsg('u2', 'second'),
    assistantMsg({
      id: 'm2',
      turnId: 'turn-2',
      toolCalls: [{ id: 't2', name: 'Bash', input: {}, status: 'completed' }],
    }),
  ];

  const { workByTurn } = projectTranscript(messages);
  assert.equal(workByTurn.length, 2);
  assert.deepEqual(
    workByTurn.map((w) => w.turnId),
    ['turn-1', 'turn-2'],
  );
  assert.equal(workByTurn[0].items[0].toolId, 't1');
  assert.equal(workByTurn[1].items[0].toolId, 't2');
});

test('projectTranscript reports the most recent non-active turn outcome as successful when it has no turnError', () => {
  const messages = [
    userMsg('u1', 'go'),
    assistantMsg({
      id: 'm1',
      turnId: 'turn-1',
      toolCalls: [{ id: 't1', name: 'Read', input: {}, status: 'completed' }],
    }),
  ];

  const { turnOutcome } = projectTranscript(messages, { activeTurnId: null });
  assert.deepEqual(turnOutcome, { turnId: 'turn-1', turnError: null });
});

test('projectTranscript excludes the currently active turn from turnOutcome', () => {
  const messages = [
    userMsg('u1', 'go'),
    assistantMsg({ id: 'm1', turnId: 'turn-1', toolCalls: [{ id: 't1', name: 'Read', input: {}, status: 'running' }] }),
  ];

  const { turnOutcome } = projectTranscript(messages, { activeTurnId: 'turn-1' });
  assert.equal(turnOutcome, null);
});

test('projectTranscript preserves raw technical detail (toolName, input, output, duration, status) on Work items', () => {
  const messages = [
    assistantMsg({
      id: 'm1',
      turnId: 'turn-1',
      toolCalls: [
        { id: 't1', name: 'Bash', input: { command: 'npm test' }, output: 'ok', status: 'completed', durationMs: 42 },
      ],
    }),
  ];

  const { workByTurn } = projectTranscript(messages);
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

  const { workByTurn, currentActivity } = projectTranscript(messages, { activeTurnId: 'turn-1' });
  assert.equal(workByTurn.length, 1);
  assert.equal(workByTurn[0].status, 'current', 'lifecycle stays current despite the earlier failure');
  assert.equal(workByTurn[0].hasFailures, true, 'failure information is retained');
  assert.equal(workByTurn[0].items.length, 3, 'the failed historical action is not dropped');
  assert.equal(currentActivity?.toolId, 't3', 'the running action remains current activity');
});

// Required coverage C (follow-up review): a terminal turn with a failed action reports
// status completed (the turn completed), severity warning, and hasFailures true.
test('C: a terminal turn with a failed action reports status completed, severity warning, and hasFailures true', () => {
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

  const { workByTurn } = projectTranscript(messages, { activeTurnId: null });
  assert.equal(workByTurn[0].status, 'completed', 'turn completed its execution');
  assert.equal(workByTurn[0].severity, 'warning', 'tool failure is a warning, not an error');
  assert.equal(workByTurn[0].hasFailures, true);
});

// ── Presentation severity test matrix (Product correction: tool failure = warning, turn failure = error) ───

test('Severity matrix 1: turn completed + 0 failed tools -> severity normal', () => {
  const messages = [
    userMsg('u1', 'go'),
    assistantMsg({
      id: 'm1',
      turnId: 'turn-1',
      toolCalls: [
        { id: 't1', name: 'Read', input: {}, status: 'completed' },
        { id: 't2', name: 'Bash', input: {}, status: 'completed' },
      ],
    }),
  ];
  const { workByTurn } = projectTranscript(messages, { activeTurnId: null });
  assert.equal(workByTurn[0].status, 'completed');
  assert.equal(workByTurn[0].severity, 'normal');
  assert.equal(workByTurn[0].hasFailures, false);
});

test('Severity matrix 2: turn completed + 1 failed tool -> severity warning', () => {
  const messages = [
    userMsg('u1', 'go'),
    assistantMsg({
      id: 'm1',
      turnId: 'turn-1',
      toolCalls: [
        { id: 't1', name: 'Read', input: {}, status: 'failed' },
        { id: 't2', name: 'Bash', input: {}, status: 'completed' },
      ],
    }),
  ];
  const { workByTurn } = projectTranscript(messages, { activeTurnId: null });
  assert.equal(workByTurn[0].status, 'completed');
  assert.equal(workByTurn[0].severity, 'warning');
  assert.equal(workByTurn[0].hasFailures, true);
});

test('Severity matrix 3: turn completed + several failed tools -> severity warning', () => {
  const messages = [
    userMsg('u1', 'go'),
    assistantMsg({
      id: 'm1',
      turnId: 'turn-1',
      toolCalls: [
        { id: 't1', name: 'Read', input: {}, status: 'failed' },
        { id: 't2', name: 'Grep', input: {}, status: 'failed' },
        { id: 't3', name: 'Bash', input: {}, status: 'completed' },
      ],
    }),
  ];
  const { workByTurn } = projectTranscript(messages, { activeTurnId: null });
  assert.equal(workByTurn[0].status, 'completed');
  assert.equal(workByTurn[0].severity, 'warning');
  assert.equal(workByTurn[0].hasFailures, true);
});

test('Severity matrix 4: turn.failed AI_PROVIDER_ERROR + 0 failed tools -> severity error', () => {
  const messages = [
    userMsg('u1', 'go'),
    assistantMsg({
      id: 'm1',
      turnId: 'turn-1',
      toolCalls: [{ id: 't1', name: 'Read', input: {}, status: 'completed' }],
      turnError: { code: 'AI_PROVIDER_ERROR', message: 'Model service unavailable' },
    }),
  ];
  const { workByTurn } = projectTranscript(messages, { activeTurnId: null });
  assert.equal(workByTurn[0].status, 'failed');
  assert.equal(workByTurn[0].severity, 'error');
  assert.equal(workByTurn[0].hasFailures, true);
});

test('Severity matrix 5: turn.failed AI_PROVIDER_ERROR + failed tool exists too -> severity error', () => {
  const messages = [
    userMsg('u1', 'go'),
    assistantMsg({
      id: 'm1',
      turnId: 'turn-1',
      toolCalls: [{ id: 't1', name: 'Read', input: {}, status: 'failed' }],
      turnError: { code: 'AI_PROVIDER_ERROR', message: 'Process crashed' },
    }),
  ];
  const { workByTurn } = projectTranscript(messages, { activeTurnId: null });
  assert.equal(workByTurn[0].status, 'failed');
  assert.equal(workByTurn[0].severity, 'error');
  assert.equal(workByTurn[0].hasFailures, true);
});

test('Severity matrix 6: AI_TURN_CANCELLED -> non-error (severity normal)', () => {
  const messages = [
    userMsg('u1', 'go'),
    assistantMsg({
      id: 'm1',
      turnId: 'turn-1',
      toolCalls: [{ id: 't1', name: 'Read', input: {}, status: 'completed' }],
      turnError: { code: 'AI_TURN_CANCELLED', message: 'Turn was cancelled by user' },
    }),
  ];
  const { workByTurn } = projectTranscript(messages, { activeTurnId: null });
  assert.equal(workByTurn[0].status, 'completed');
  assert.equal(workByTurn[0].severity, 'normal', 'cancellation must not be treated as error');
  assert.equal(workByTurn[0].hasFailures, false);
});

test('Severity matrix 7: stale Antigravity ERROR compatibility case + valid response + tool failure -> turn completed, Work warning, NOT error', () => {
  // TURN N: tool fails and recovers
  // TURN N+1: completed response emitted, turn ends normally
  const messages = [
    userMsg('u1', 'first turn'),
    assistantMsg({
      id: 'm1',
      turnId: 'turn-1',
      text: 'First answer',
      toolCalls: [
        { id: 't1', name: 'Edit', input: {}, status: 'failed' },
        { id: 't2', name: 'Edit', input: {}, status: 'completed' },
      ],
    }),
    userMsg('u2', 'second turn (asking question)'),
    assistantMsg({
      id: 'm2',
      turnId: 'turn-2',
      text: 'Second answer explaining error cleanly',
      // No turnError attached because non-empty response completed successfully
    }),
  ];
  const { workByTurn, entries } = projectTranscript(messages, { activeTurnId: null });
  assert.equal(workByTurn.length, 1, 'Only turn-1 had tool calls');
  assert.equal(workByTurn[0].turnId, 'turn-1');
  assert.equal(workByTurn[0].status, 'completed');
  assert.equal(workByTurn[0].severity, 'warning', 'turn-1 has warning because of failed edit tool');

  // Turn 2 is completely clean
  assert.equal(entries.find((c) => c.id === 'm2')?.text, 'Second answer explaining error cleanly');
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

  const { workByTurn, entries } = projectTranscript(messages, { activeTurnId: null });
  assert.equal(workByTurn.length, 1);
  assert.equal(workByTurn[0].turnId, 'turn-1');
  const assistantEntry = entries.find((entry) => entry.id === 'm1');
  assert.equal(assistantEntry.text, 'Here is what I found.');
});

test('projectTranscript carries turnId onto transcript entries without merging distinct turns', () => {
  const messages = [
    userMsg('u1', 'first'),
    assistantMsg({ id: 'm1', turnId: 'turn-1', text: 'first reply' }),
    userMsg('u2', 'second'),
    assistantMsg({ id: 'm2', turnId: 'turn-2', text: 'second reply' }),
  ];

  const { entries } = projectTranscript(messages);
  assert.deepEqual(
    entries.map((entry) => entry.turnId),
    [undefined, 'turn-1', undefined, 'turn-2'],
  );
  assert.deepEqual(
    entries.map((entry) => entry.text),
    ['first', 'first reply', 'second', 'second reply'],
  );
});

test('projectTranscript selects the newest started running tool as currentActivity when multiple are running', () => {
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

  const { workByTurn, currentActivity } = projectTranscript(messages, { activeTurnId: 'turn-1' });
  assert.equal(workByTurn.length, 1);
  assert.equal(workByTurn[0].status, 'current');
  assert.equal(workByTurn[0].currentActivity?.toolId, 't2', 'turn currentActivity must be the newest running tool t2');
  assert.equal(currentActivity?.toolId, 't2', 'projection currentActivity must be the newest running tool t2');
});

// ── task 11 (semantic Work chat V2), AC2 & AC3: Level 2 timeline ──────────────────────

function commentaryV2(id, seq, text) {
  return { id, type: 'commentary', seq, text, status: 'completed', createdAt: '', updatedAt: '' };
}
function toolV2(id, seq, { kind = 'read', status = 'completed', title = `tool-${id}` } = {}) {
  return { id, type: 'tool', seq, toolName: title, kind, title, status, actions: [], createdAt: '', updatedAt: '' };
}

test('V2 AC2: commentary/tool/commentary/tool ordering is preserved exactly in Level 2 rows', () => {
  const historicalWork = [
    commentaryV2('c1', 1, 'Looking at the file'),
    toolV2('t1', 2, { kind: 'read' }),
    commentaryV2('c2', 3, 'Now editing'),
    toolV2('t2', 4, { kind: 'edit' }),
  ];
  const rows = buildTimelineRowsV2(historicalWork);
  assert.deepEqual(
    rows.map((r) => r.id),
    ['c1', 't1', 'c2', 't2'],
    'row order must match acceptance order exactly, never regrouped by type',
  );
});

test('V2 AC2: a compound tool invocation keeps its ToolActions nested, never promoted to sibling rows', () => {
  const compound = {
    id: 'cmd-1',
    type: 'tool',
    seq: 1,
    toolName: 'command',
    kind: 'command',
    title: 'Inspect specification',
    status: 'completed',
    createdAt: '',
    updatedAt: '',
    actions: [
      { id: 'act-1', seq: 1, kind: 'search', title: 'Search workflow documentation' },
      { id: 'act-2', seq: 2, kind: 'read', title: 'Read change.yaml' },
    ],
  };
  const rows = buildTimelineRowsV2([compound]);
  assert.equal(rows.length, 1, 'one provider operation must stay one row, not one row per action');
  assert.equal(rows[0].row, 'tool_group');
  assert.equal(rows[0].items[0].actions.length, 2, 'ToolActions remain nested children of the invocation');
});

test('V2 AC2: dozens of consecutive completed same-kind tools compress into grouped timeline row in Level 2', () => {
  const historicalWork = Array.from({ length: 40 }, (_, i) =>
    toolV2(`t${i}`, i + 1, { kind: 'read', title: 'Read file' }),
  );
  const rows = buildTimelineRowsV2(historicalWork);
  assert.equal(rows.length, 1, 'consecutive completed same-kind tools group into one Level 2 row');
  assert.equal(rows[0].count, 40);
  assert.equal(rows[0].items.length, 40, 'underlying canonical items are preserved for inspection');
});

test('V2 AC2: repeated same-kind tools interleaved with other kinds stay in their exact original order', () => {
  const historicalWork = [
    toolV2('t1', 1, { kind: 'read', title: 'Read file' }),
    toolV2('t2', 2, { kind: 'read', title: 'Read file' }),
    toolV2('t3', 3, { kind: 'edit', title: 'Edit file' }),
    toolV2('t4', 4, { kind: 'read', title: 'Read file', status: 'failed' }),
    toolV2('t5', 5, { kind: 'read', title: 'Read file' }),
  ];
  const rows = buildTimelineRowsV2(historicalWork);
  assert.equal(rows.length, 4, 'adjacent happy-path items group, while different kinds and exceptions remain separate');
  assert.equal(rows[0].count, 2);
  assert.equal(rows[1].title, 'Edit file');
  assert.equal(
    rows[2].status,
    'failed',
    'a failed tool stays individually visible, in its exact chronological position',
  );
  assert.equal(rows[3].count, 1);
});

test('V2 AC3: the timeline never fabricates an active item — it only ever renders exactly what historicalWork contains', () => {
  // historicalWork is server-derived to already exclude the active/streaming item (see
  // CanonicalTurnV2.historicalWork) — this asserts the client projection does not
  // reintroduce or duplicate anything beyond that input, satisfying "no duplicate active
  // activity" from the UI side of the contract.
  const historicalWork = [toolV2('t1', 1, { status: 'completed' })];
  const rows = buildTimelineRowsV2(historicalWork);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].items[0].id, 't1');
  assert.ok(
    rows.every((r) => r.row !== 'tool_group' || r.status !== 'active'),
    'no active-status tool ever appears in Level 2 rows',
  );
});

// ── task 11 correction: compact Commentary/Reasoning preview (Level 2 vs Level 3) ────

import { previewPlainText } from '../ui/features/agent-sessions/work-v2/text-preview-v2.ts';

test('V2 correction: previewPlainText collapses multi-paragraph Markdown into one compact plain-text line', () => {
  const markdown = [
    '# Research Report: V2 Semantic Chat Projection —',
    'Server Wire Contract vs. Current UI Consumption',
    '',
    'Found the existing V2 server projection and current UI consumption gap.',
    '',
    '```js',
    'const x = 1;',
    '```',
    '',
    '- item one',
    '- item two',
  ].join('\n');

  const preview = previewPlainText(markdown);
  assert.ok(!preview.includes('\n'), 'preview must be a single line');
  assert.ok(!preview.startsWith('#'), 'heading markers must not survive into the preview');
  assert.ok(!preview.includes('```'), 'code fence syntax must not survive into the preview');
  assert.ok(!preview.includes('- item'), 'list markers must not survive into the preview');
  assert.match(preview, /^Research Report/, 'the heading text itself remains, just without the # marker');
});

test('V2 correction: previewPlainText truncates long text with an ellipsis instead of exploding the timeline row', () => {
  const longText = 'word '.repeat(100).trim();
  const preview = previewPlainText(longText, 140);
  assert.ok(preview.length <= 140);
  assert.ok(preview.endsWith('…'));
});

test('V2 correction: Work Details (Level 3) is the only surface allowed to render full Markdown for Commentary/Reasoning', () => {
  const detailsSource = readFileSync(
    fileURLToPath(new URL('../ui/features/agent-sessions/work-v2/work-details-sheet-v2.tsx', import.meta.url)),
    'utf8',
  );
  assert.match(
    detailsSource,
    /<MarkdownContent markdown=\{item\.text\}/,
    'Level 3 must render the complete, unmodified text',
  );

  const timelineSource = readFileSync(
    fileURLToPath(new URL('../ui/features/agent-sessions/work-v2/work-timeline-v2.tsx', import.meta.url)),
    'utf8',
  );
  assert.doesNotMatch(
    timelineSource,
    /MarkdownContent/,
    'Level 2 must never render Markdown — only the plain-text preview',
  );
  assert.match(timelineSource, /previewPlainText/);
});
