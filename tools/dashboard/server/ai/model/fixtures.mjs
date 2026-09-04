import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  createCanonicalTurn,
  appendWorkItem,
  addToolAction,
  setFinalAnswer,
  setTurnStatus,
  validateCanonicalTurn,
} from './canonical-turn.mjs';
import { createTurnStatus } from './turn-status.mjs';

export function createMockCanonicalTurn({
  id = `turn-${randomUUID()}`,
  sessionId = `sess-${randomUUID()}`,
  provider = 'mock',
  providerSessionId = `prov-sess-${randomUUID()}`,
  mode = 'edit',
  status = 'active',
  statusDetails = { detail: 'processing' },
  createdAt = new Date().toISOString(),
} = {}) {
  const statusObj = typeof status === 'string' ? createTurnStatus(status, statusDetails) : status;
  return createCanonicalTurn({
    id,
    sessionId,
    provider,
    providerSessionId,
    mode,
    status: statusObj,
    createdAt,
  });
}

/**
 * Builds a realistic representative turn for Claude scenarios:
 * commentary -> tool -> reasoning -> parallel tools -> final answer
 */
export function buildClaudeScenarioTurn({ id = `turn-claude-${randomUUID()}`, sessionId = 'sess-claude-1' } = {}) {
  const turn = createMockCanonicalTurn({ id, sessionId, provider: 'claude', providerSessionId: 'claude-uuid-1' });

  // 1. Commentary narration
  appendWorkItem(turn, {
    id: `work-${randomUUID()}`,
    type: 'commentary',
    text: "I'll inspect the test suite and run the tests.",
    status: 'completed',
    confidence: 'derived',
  });

  // 2. Tool invocation (search)
  appendWorkItem(turn, {
    id: `work-${randomUUID()}`,
    type: 'tool',
    toolName: 'GlobTool',
    kind: 'search',
    title: 'Find test files',
    status: 'completed',
    input: { pattern: '**/*.test.mjs' },
    output: ['tests/claude-provider.test.mjs'],
    durationMs: 45,
    confidence: 'authoritative',
  });

  // 3. Reasoning
  appendWorkItem(turn, {
    id: `work-${randomUUID()}`,
    type: 'reasoning',
    representation: 'raw_text',
    text: 'Identified 1 relevant test file. Now running verification.',
    status: 'completed',
    confidence: 'authoritative',
  });

  // 4. Final answer
  setFinalAnswer(turn, {
    id: 'final-answer',
    text: 'All test files have been verified.',
    status: 'completed',
    confidence: 'authoritative',
  });

  // 5. Completed terminal status
  setTurnStatus(
    turn,
    createTurnStatus('terminal', { outcome: 'completed', initiator: 'provider', finishReason: 'end_turn' }),
  );

  return turn;
}

/**
 * Builds a realistic representative turn for Codex scenarios:
 * commentary -> command with multiple nested commandActions -> final answer
 */
export function buildCodexScenarioTurn({ id = `turn-codex-${randomUUID()}`, sessionId = 'sess-codex-1' } = {}) {
  const turn = createMockCanonicalTurn({ id, sessionId, provider: 'codex', providerSessionId: 'codex-thread-1' });

  // 1. Commentary
  appendWorkItem(turn, {
    id: `work-${randomUUID()}`,
    type: 'commentary',
    text: 'Running workspace checks and reading change specifications.',
    status: 'completed',
    confidence: 'authoritative',
  });

  // 2. Compound ToolInvocation with multiple nested commandActions
  const toolItem = appendWorkItem(turn, {
    id: `work-${randomUUID()}`,
    type: 'tool',
    toolName: 'commandExecution',
    kind: 'command',
    title: 'Inspect repository state',
    status: 'completed',
    input: { command: 'node tools/specs.mjs check' },
    output: 'Validated 21 changes — no errors.',
    durationMs: 320,
    confidence: 'authoritative',
    actions: [],
  });

  // Nested actions: listing, reading, searching
  addToolAction(toolItem, {
    id: `act-1`,
    kind: 'list',
    title: 'List active changes in specs/active',
    target: 'specs/active',
    status: 'completed',
  });

  addToolAction(toolItem, {
    id: `act-2`,
    kind: 'read',
    title: 'Read change manifest',
    target: 'specs/active/ai-session-issues-and-diagnostics/change.yaml',
    status: 'completed',
  });

  addToolAction(toolItem, {
    id: `act-3`,
    kind: 'search',
    title: 'Search references for turn contract',
    target: 'specs/active/ai-session-issues-and-diagnostics/areas',
    status: 'completed',
  });

  // 3. Final answer
  setFinalAnswer(turn, {
    id: 'final-answer',
    text: 'Repository check completed successfully with no errors.',
    status: 'completed',
    confidence: 'authoritative',
  });

  setTurnStatus(
    turn,
    createTurnStatus('terminal', { outcome: 'completed', initiator: 'provider', finishReason: 'turn_completed' }),
  );

  return turn;
}

/**
 * Builds a realistic representative turn for Antigravity scenarios:
 * reasoning -> step tool -> question interaction -> resolution -> final answer
 */
export function buildAntigravityScenarioTurn({ id = `turn-ag-${randomUUID()}`, sessionId = 'sess-ag-1' } = {}) {
  const turn = createMockCanonicalTurn({ id, sessionId, provider: 'antigravity', providerSessionId: 'ag-sess-1' });

  // 1. Reasoning
  appendWorkItem(turn, {
    id: `work-${randomUUID()}`,
    type: 'reasoning',
    representation: 'raw_text',
    text: 'Analyzing requested changes.',
    status: 'completed',
    confidence: 'authoritative',
  });

  // 2. Question interaction
  const intId = `int-${randomUUID()}`;
  appendWorkItem(turn, {
    id: intId,
    type: 'interaction',
    status: 'resolved',
    interaction: {
      id: intId,
      kind: 'question',
      questions: [
        {
          id: 'q1',
          question: 'Do you want to proceed with Option B?',
          options: [{ label: 'Yes' }, { label: 'No' }],
        },
      ],
      resumePolicy: 'live-operation',
    },
    response: { answers: [{ questionId: 'q1', value: 'Yes' }] },
  });

  // 3. Final answer
  setFinalAnswer(turn, {
    id: 'final-answer',
    text: 'Proceeding with Option B implementation.',
    status: 'completed',
    confidence: 'derived',
  });

  setTurnStatus(
    turn,
    createTurnStatus('terminal', { outcome: 'completed', initiator: 'provider', finishReason: 'done' }),
  );

  return turn;
}

/**
 * Conformance assertion: verifies that a turn satisfies all canonical invariants.
 */
export function assertValidCanonicalTurn(turn) {
  const validated = validateCanonicalTurn(turn);
  assert.ok(validated.id, 'Turn must have id');
  assert.ok(validated.turnId, 'Turn must have turnId');
  assert.ok(validated.sessionId, 'Turn must have sessionId');
  assert.ok(validated.provider, 'Turn must have provider');
  assert.ok(validated.providerSessionId, 'Turn must have providerSessionId');
  assert.ok(validated.status, 'Turn must have status');
  assert.equal(validated.activityCount, validated.work.length, 'activityCount must equal work.length');

  // Verify Work order
  assertWorkOrderIntegrity(validated);

  return validated;
}

/**
 * Conformance assertion: verifies strict Work sequence ordering and monotonic integrity.
 */
export function assertWorkOrderIntegrity(turnOrWork) {
  const work = Array.isArray(turnOrWork) ? turnOrWork : turnOrWork.work;
  assert.ok(Array.isArray(work), 'work must be an array');

  for (let i = 0; i < work.length; i++) {
    const item = work[i];
    assert.equal(item.seq, i + 1, `Work item at index ${i} must have seq ${i + 1}`);
    assert.ok(item.id, `Work item at index ${i} must have non-empty id`);
    assert.ok(
      ['commentary', 'reasoning', 'tool', 'interaction'].includes(item.type),
      `Work item ${item.id} has invalid type: ${item.type}`,
    );

    if (item.type === 'tool') {
      assertToolActionHierarchy(item);
    }
  }
}

/**
 * Conformance assertion: verifies that ToolAction children are nested properly and do not violate order.
 */
export function assertToolActionHierarchy(toolInvocation) {
  assert.equal(toolInvocation.type, 'tool', 'Must be a tool WorkItem');
  if (toolInvocation.actions && toolInvocation.actions.length > 0) {
    for (let i = 0; i < toolInvocation.actions.length; i++) {
      const act = toolInvocation.actions[i];
      assert.equal(act.seq, i + 1, `ToolAction at index ${i} in tool '${toolInvocation.id}' must have seq ${i + 1}`);
      assert.ok(act.id, `ToolAction must have id`);
      assert.ok(act.title, `ToolAction must have title`);
      assert.ok(act.kind, `ToolAction must have kind`);
    }
  }
}
