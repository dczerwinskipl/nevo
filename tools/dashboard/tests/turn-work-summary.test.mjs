import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  hasVisibleProse,
  shouldRenderTranscriptMessage,
  visibleWorkItemsWhenTerminal,
  visibleWorkItemsWhileRunning,
} from '../ui/features/agent-sessions/turn-work/turn-work-visibility.ts';
import { activityLabelFor } from '../ui/features/agent-sessions/turn-work/tool-activity-labels.ts';
import { projectTranscript } from '../ui/features/agent-sessions/transcript/projection.ts';

function readWorkSummarySource() {
  return readFileSync(fileURLToPath(new URL('../ui/features/agent-sessions/turn-work/turn-work-summary.tsx', import.meta.url)), 'utf8');
}

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
  const { workByTurn } = projectTranscript(messages);
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

// Finding 2 (follow-up review): a failed action's status is retained and it becomes
// individually inspectable through expansion — collapsed Work must never automatically
// emit historical action cards outside the group, even when one of them failed.
test('visibleWorkItemsWhenTerminal never exposes historical actions — failed or not — while collapsed', () => {
  const work = {
    turnId: 'turn-1',
    messageId: 'm1',
    status: 'failed',
    hasFailures: true,
    items: [item('t1', 'completed'), item('t2', 'failed'), item('t3', 'completed')],
  };

  const collapsed = visibleWorkItemsWhenTerminal(work, false);
  assert.deepEqual(collapsed, []);

  const expanded = visibleWorkItemsWhenTerminal(work, true);
  assert.equal(expanded.length, 3);
  assert.equal(expanded.find(i => i.toolId === 't2').status, 'failed');
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
  const { currentActivity, workByTurn } = projectTranscript(messages, { activeTurnId: 'turn-1' });
  assert.equal(currentActivity?.toolId, 't2');
  assert.equal(workByTurn[0].status, 'current');
});

// owner-decisions.md, AC6: Work from unrelated turns is not merged.
test('two sequential turns each with tool calls produce two separate Work groups', () => {
  const messages = [
    { id: 'm1', role: 'assistant', text: '', turnId: 'turn-1', createdAt: '2026-08-22T10:00:00Z', toolCalls: [{ id: 't1', name: 'Read', input: {}, status: 'completed' }] },
    { id: 'm2', role: 'assistant', text: '', turnId: 'turn-2', createdAt: '2026-08-22T10:01:00Z', toolCalls: [{ id: 't2', name: 'Bash', input: {}, status: 'completed' }] },
  ];
  const { workByTurn } = projectTranscript(messages);
  assert.equal(workByTurn.length, 2);
});

// Required coverage B (follow-up review): eight completed actions collapse to one
// summary; none visible while collapsed; all visible once expanded.
test('B: eight successful actions collapse to one Work summary, no cards while collapsed, all visible expanded', () => {
  const work = {
    turnId: 'turn-1',
    messageId: 'm1',
    status: 'completed',
    hasFailures: false,
    items: Array.from({ length: 8 }, (_, i) => item(`t${i}`, 'completed')),
  };

  assert.deepEqual(visibleWorkItemsWhenTerminal(work, false), []);
  const expanded = visibleWorkItemsWhenTerminal(work, true);
  assert.equal(expanded.length, 8);
});

// Required coverage D (follow-up review, Finding 3): current activity uses Task 04's
// human-readable normalization, never the raw provider tool name. `turn-work-summary.tsx`
// cannot be imported into this test runner (JSX, no loader for it here — see G below),
// so this combines (1) proving the normalization itself never renders a raw tool name
// for a realistic running item, with (2) a source check that `WorkCurrentActivity`
// actually calls the normalization function rather than rendering `item.toolName`.
test('D: current activity label uses Task 04 normalization, not the raw tool name', () => {
  const runningItem = activityLabelFor('Read', { path: 'specs/active/chat-ux-improvements-pt1/foo.md' });
  assert.notEqual(runningItem.label, 'Read', 'must not render the raw provider tool name');
  assert.equal(runningItem.label, 'Reading specs/active/chat-ux-improvements-pt1/foo.md');

  const bashItem = activityLabelFor('Bash', { command: 'node tools/specs.mjs validate' });
  assert.equal(bashItem.label, 'Running: node tools/specs.mjs validate');

  const source = readWorkSummarySource();
  const currentActivityMatch = source.match(/const WorkCurrentActivity[\s\S]*?\n\}\);/);
  assert.ok(currentActivityMatch, 'WorkCurrentActivity must exist in turn-work-summary.tsx');
  assert.match(currentActivityMatch[0], /activityLabelFor\(/, 'must call the Task 04 normalization function');
  assert.doesNotMatch(currentActivityMatch[0], />\{item\.toolName\}</, 'must not render the raw tool name directly');
});

// Required coverage F (follow-up review, Findings 5/8): a Work-only turn (no assistant
// prose) still renders — via Work, not an empty assistant bubble/card/placeholder — and
// a turn with no content at all yet renders nothing rather than an empty placeholder.
test('F: a Work-only assistant message renders (has Work), an empty one does not', () => {
  const workOnlyMessage = { role: 'assistant', text: '', reasoning: undefined };
  assert.equal(hasVisibleProse(workOnlyMessage), false);
  assert.equal(shouldRenderTranscriptMessage(workOnlyMessage, true), true, 'Work alone is enough to render');
  assert.equal(shouldRenderTranscriptMessage(workOnlyMessage, false), false, 'no prose and no Work renders nothing — no empty placeholder');

  const proseMessage = { role: 'assistant', text: 'Hello', reasoning: undefined };
  assert.equal(shouldRenderTranscriptMessage(proseMessage, false), true, 'prose alone is enough to render');

  const userMessage = { role: 'user', text: '', reasoning: undefined };
  assert.equal(shouldRenderTranscriptMessage(userMessage, false), true, 'a user message always renders');
});

// Required coverage G (follow-up review, Finding 6): collapsed Work renders as a
// lightweight transcript row, not a card/bubble container. `turn-work-summary.tsx` cannot be
// rendered in this test runner (no jsdom/RTL, and Node's loader does not transform
// JSX), so this asserts the component-structure invariant the way it exists here: the
// collapsed row's own class list carries no card chrome (border/rounded-xl/background),
// only a hover affordance — a structural check on the source, not a pixel comparison.
test('G: the collapsed Work row source carries no card container styling', () => {
  const source = readWorkSummarySource();
  const collapsedSummaryMatch = source.match(/const WorkCollapsedSummary[\s\S]*?\n\}\);/);
  assert.ok(collapsedSummaryMatch, 'WorkCollapsedSummary must exist in turn-work-summary.tsx');
  const collapsedSummarySource = collapsedSummaryMatch[0];
  assert.doesNotMatch(collapsedSummarySource, /rounded-xl/, 'no large rounded card container');
  assert.doesNotMatch(collapsedSummarySource, /\bborder\b/, 'no prominent border');
  assert.match(collapsedSummarySource, /hover:bg-white\/4/, 'reads as a lightweight row with only a hover affordance');
});
// ── New required scenarios (PR #35 review, Issue 2) ───────────────────────────────────

// When Work reports 'requires attention' solely because of a turnError (no failed tools),
// expanding must expose the turn error — otherwise the UI says "requires attention" with
// no visible reason.
test('L: a turnError-only Work group — no failed tools — surfaces turnError via hasFailures', () => {
  const messages = [
    { id: 'm1', role: 'assistant', text: '', turnId: 'turn-1', createdAt: '2026-08-22T10:00:00Z',
      toolCalls: [{ id: 't1', name: 'Read', input: { path: 'a.ts' }, output: 'ok', status: 'completed' }],
      turnError: { code: 'AI_SESSION_LIMIT', message: "You've hit your session limit" } },
  ];
  const { workByTurn } = projectTranscript(messages, { activeTurnId: null });
  assert.equal(workByTurn.length, 1, 'Work exists');
  assert.equal(workByTurn[0].status, 'failed', 'turn is terminal and failed');
  assert.equal(workByTurn[0].hasFailures, true, 'hasFailures reflects turnError presence');
  // The successful tool remains successful — turnError must not corrupt per-tool statuses.
  assert.equal(workByTurn[0].items[0].status, 'completed', 'successful tool remains completed');
  // The turnError is present for the expanded-Work row to render.
  assert.deepEqual(workByTurn[0].turnError, { code: 'AI_SESSION_LIMIT', message: "You've hit your session limit" });
});

// A failed tool AND a turnError are independently inspectable — neither overwrites the other.
test('L: failed tool + turnError are independently inspectable in Work projection', () => {
  const messages = [
    { id: 'm1', role: 'assistant', text: '', turnId: 'turn-1', createdAt: '2026-08-22T10:00:00Z',
      toolCalls: [
        { id: 't1', name: 'Read', input: { path: 'a.ts' }, output: 'ok', status: 'completed' },
        { id: 't2', name: 'Bash', input: { command: 'bad' }, status: 'failed' },
      ],
      turnError: { code: 'AI_PROVIDER_EXIT_ERROR', message: 'Process exited with code 1' } },
  ];
  const { workByTurn } = projectTranscript(messages, { activeTurnId: null });
  assert.equal(workByTurn[0].hasFailures, true);
  // Each tool retains its own status — the failed tool is still failed,
  // the completed tool is still completed.
  assert.equal(workByTurn[0].items.find(i => i.toolId === 't1')?.status, 'completed');
  assert.equal(workByTurn[0].items.find(i => i.toolId === 't2')?.status, 'failed');
  // Turn error is independently present.
  assert.deepEqual(workByTurn[0].turnError, { code: 'AI_PROVIDER_EXIT_ERROR', message: 'Process exited with code 1' });
});

// Source check: TurnErrorRow must exist in turn-work-summary.tsx and must render the turnError
// fields, not a string-matched hardcoded message.
test('L: turn-work-summary.tsx source contains TurnErrorRow that renders turnError fields', () => {
  const source = readFileSync(fileURLToPath(new URL('../ui/features/agent-sessions/turn-work/turn-work-summary.tsx', import.meta.url)), 'utf8');
  assert.match(source, /const TurnErrorRow/, 'TurnErrorRow component must exist');
  assert.match(source, /turnError\.message/, 'must render turnError.message');
  assert.match(source, /turnError\.code/, 'must render turnError.code as secondary info');
  // Must NOT use string matching on session-limit text or similar heuristics.
  assert.doesNotMatch(source, /session.limit/i, 'must not use string-matching heuristics');
  assert.doesNotMatch(source, /includes\s*\(/, 'must not classify error text with includes()');
});

test('Finding 3: visibleWorkItemsWhileRunning retains older running tools when multiple are running', () => {
  const work = {
    turnId: 'turn-1',
    messageId: 'm1',
    status: 'current',
    currentActivity: item('t2', 'running'),
    items: [item('t1', 'running'), item('t2', 'running')],
  };

  assert.deepEqual(visibleWorkItemsWhileRunning(work, false), []);
  const expanded = visibleWorkItemsWhileRunning(work, true);
  assert.equal(expanded.length, 1, 'older running tool t1 must remain inspectable in expanded list');
  assert.equal(expanded[0].toolId, 't1');
});

test('Finding 3: TurnWorkSummary does not independently rederive current activity with find', () => {
  const source = readFileSync(fileURLToPath(new URL('../ui/features/agent-sessions/turn-work/turn-work-summary.tsx', import.meta.url)), 'utf8');
  assert.match(source, /work\.currentActivity/, 'TurnWorkSummary must consume work.currentActivity from projection');
  assert.doesNotMatch(source, /items\.find\([^)]*status === ['"]running['"]\)/, 'TurnWorkSummary must not use find(status === running)');
});

// ── task 11 (semantic Work chat V2), AC1: Level 1 Work indicator ──────────────────────

import { describeCurrentActivityV2, terminalHeaderLabelV2 } from '../ui/features/agent-sessions/work-v2/activity-model-v2.ts';

function workIndicatorV2Source() {
  return readFileSync(fileURLToPath(new URL('../ui/features/agent-sessions/work-v2/work-indicator-v2.tsx', import.meta.url)), 'utf8');
}

test('V2 AC1: describeCurrentActivityV2 truthfully labels every current-activity kind', () => {
  const startedAt = '2026-08-30T10:00:00Z';

  assert.deepEqual(describeCurrentActivityV2(null), null, 'no evidence must not fabricate a current activity');

  const tool = describeCurrentActivityV2({ kind: 'tool', title: 'Read file', description: 'a.ts', toolKind: 'read', startedAt });
  assert.equal(tool.label, 'Read file');
  assert.equal(tool.textFirst, false, 'tool current activity is icon+label, never text-first');

  const thinking = describeCurrentActivityV2({ kind: 'thinking', text: 'Comparing options', startedAt });
  assert.equal(thinking.label, 'Comparing options');
  assert.equal(thinking.textFirst, true, 'thinking never gets a type icon');

  const thinkingNoText = describeCurrentActivityV2({ kind: 'thinking', text: '', startedAt });
  assert.equal(thinkingNoText.label, 'Thinking…', 'silence alone must still be truthfully labeled, never blank');

  const commentary = describeCurrentActivityV2({ kind: 'commentary', text: 'Here is', startedAt });
  assert.equal(commentary.label, 'Here is');
  assert.equal(commentary.textFirst, true);

  const waitingForModel = describeCurrentActivityV2({ kind: 'waiting_for_model', startedAt });
  assert.equal(waitingForModel.label, 'Waiting for model response');

  const waitingForTool = describeCurrentActivityV2({ kind: 'waiting_for_tool', startedAt });
  assert.equal(waitingForTool.label, 'Waiting for tool execution');

  const attention = describeCurrentActivityV2({ kind: 'requires_attention', title: 'Permission required for Bash', startedAt });
  assert.equal(attention.label, 'Permission required for Bash');
  assert.equal(attention.textFirst, false);

  const cancelling = describeCurrentActivityV2({ kind: 'cancelling', startedAt });
  assert.equal(cancelling.label, 'Cancelling turn…');
});

test('V2 AC1: terminalHeaderLabelV2 truthfully reports completed/failed/cancelled/interrupted, null while non-terminal', () => {
  assert.equal(terminalHeaderLabelV2({ status: 'active', detail: 'processing', since: '', source: '' }), null);
  assert.equal(terminalHeaderLabelV2({ status: 'waiting', reason: 'provider_response', since: '', source: '' }), null);
  assert.equal(terminalHeaderLabelV2({ status: 'terminal', outcome: 'completed', initiator: 'provider', since: '', source: '' }), 'Completed');
  assert.equal(terminalHeaderLabelV2({ status: 'terminal', outcome: 'failed', initiator: 'provider', since: '', source: '' }), 'Failed');
  assert.equal(terminalHeaderLabelV2({ status: 'terminal', outcome: 'cancelled', initiator: 'user', since: '', source: '' }), 'Cancelled');
  assert.equal(terminalHeaderLabelV2({ status: 'terminal', outcome: 'interrupted', initiator: 'system', since: '', source: '' }), 'Interrupted');
});

test('V2 AC1: WorkIndicatorV2 (Level 1) never renders historical activity, only count/state/current', () => {
  const source = workIndicatorV2Source();
  assert.doesNotMatch(source, /historicalWork/, 'Level 1 must not read historicalWork — no historical activity at this level');
  assert.match(source, /turn\.activityCount/, 'must show the top-level activity count');
  assert.match(source, /describeCurrentActivityV2/, 'current activity must come from the shared formatter, not be re-derived');
});

// ── task 11 correction: Work header interaction ownership ─────────────────────────────

function turnWorkPanelV2Source() {
  return readFileSync(fileURLToPath(new URL('../ui/features/agent-sessions/work-v2/turn-work-panel-v2.tsx', import.meta.url)), 'utf8');
}

test('V2 correction: the Work header row is the single full-width expand/collapse target in Level 1', () => {
  const source = turnWorkPanelV2Source();

  // WorkIndicatorV2 (the header, including its own chevron) receives the toggle handler
  // and is the clean full-width header for Level 1, with no competing/interfering tiny buttons.
  assert.match(source, /<WorkIndicatorV2 turn=\{turn\} expanded=\{expanded\} onToggle=\{toggleExpanded\}/);
});

test('V2 correction: Level 3 Work Details is accessed directly from Level 2 item selection and footer action', () => {
  const source = turnWorkPanelV2Source();

  // Level 3 inspection is wired cleanly from Level 2 timeline:
  // - onSelectItem opens the specific item in Details (openDetailsForItem)
  // - onOpenDetails opens the full overview in Details (openDetailsOverview)
  // - Level 1 contains no competing redundant button that interferes with expanding Level 2
  assert.match(source, /onSelectItem=\{openDetailsForItem\}/);
  assert.match(source, /onClick=\{openDetailsOverview\}/);
  assert.match(source, /<Search className="size-3"/);
});

test('V2 correction: selecting a row in Level 2 opens Work Details without toggling Level 2 collapse state', () => {
  const source = turnWorkPanelV2Source();
  // WorkTimelineV2's row-selection callback opens Details (openDetailsForItem) — a
  // distinct handler from toggleExpanded, so inspecting a row never collapses history.
  assert.match(source, /onSelectItem=\{openDetailsForItem\}/);
  assert.doesNotMatch(source, /onSelectItem=\{toggleExpanded\}/);
});
