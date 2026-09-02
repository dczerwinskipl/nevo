import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { projectChatV1, deriveLegacyUserMessageText } from '../server/ai/contracts.mjs';
import { createCanonicalTurn, appendWorkItem } from '../server/ai/model/canonical-turn.mjs';
import { serializePublicTurn } from '../server/ai/model/serialization.mjs';
import { mapAntigravityTool } from '../server/ai/providers/antigravity/provider.mjs';
import { shouldCollapseMessage } from '../ui/features/agent-sessions/transcript/message-collapse.ts';
import { previewPlainText } from '../ui/features/agent-sessions/work-v2/text-preview-v2.ts';
import { describeCurrentActivityV2, terminalHeaderLabelV2 } from '../ui/features/agent-sessions/work-v2/activity-model-v2.ts';
import { buildTimelineRowsV2, projectTimelineV2, normalizeCommentaryText } from '../ui/features/agent-sessions/work-v2/timeline-projection-v2.ts';

function readV2Source(relative) {
  return readFileSync(fileURLToPath(new URL(`../ui/features/agent-sessions/work-v2/${relative}`, import.meta.url)), 'utf8');
}

function readPageSource() {
  return readFileSync(fileURLToPath(new URL('../ui/features/agent-sessions/agent-session-page.tsx', import.meta.url)), 'utf8');
}

function readRuntimeSource() {
  return readFileSync(fileURLToPath(new URL('../ui/features/agent-sessions/runtime/agent-session-runtime.ts', import.meta.url)), 'utf8');
}

// ── 1. Collapsible User Messages in V2 ──────────────────────────────────────────────

test('Requirement 1: UserMessageBubble in V2 uses shouldCollapseMessage and provides line-clamp-6 toggle with accessible aria-expanded', () => {
  const source = readV2Source('agent-session-transcript-v2.tsx');

  assert.match(source, /shouldCollapseMessage\(text\)/, 'must use canonical shouldCollapseMessage helper');
  assert.match(source, /line-clamp-6/, 'must apply line-clamp-6 when collapsed');
  assert.match(source, /aria-expanded=\{expanded\}/, 'must provide accessible aria-expanded attribute on toggle button');
  assert.match(source, /Pokaż więcej/, 'must provide Polish expand label');
  assert.match(source, /Zwiń/, 'must provide Polish collapse label');

  // Verify shouldCollapseMessage contract
  const shortText = 'Krótka wiadomość';
  assert.equal(shouldCollapseMessage(shortText), false);

  const longMultiline = Array.from({ length: 8 }, (_, i) => `Line ${i + 1}`).join('\n');
  assert.equal(shouldCollapseMessage(longMultiline), true);

  const longSingleLine = 'A'.repeat(500);
  assert.equal(shouldCollapseMessage(longSingleLine), true);
});

// ── 2. One Conversation: V1 and V2 share authoritative Turn state ────────────────────

test('Requirement 2 & 16: AgentSessionPage uses single unified session runtime and projects to V1 and V2', () => {
  const pageSource = readPageSource();

  // Exactly one call to useAgentSessionRuntime
  const runtimeMatches = pageSource.match(/useAgentSessionRuntime\(/g) || [];
  assert.equal(runtimeMatches.length, 1, 'must have exactly one runtime instance');
  assert.doesNotMatch(pageSource, /useAgentSessionRuntimeV2/, 'duplicate runtime instance must be removed');

  // V2 transcript receives turns from the unified runtime
  assert.match(pageSource, /<AgentSessionTranscriptV2[\s\S]*?turns=\{assistant\.turns\}/);
  assert.match(pageSource, /<AgentSessionTranscript[\s\S]*?messages=\{assistant\.messages\}/);

  // Composer submit sends through shared runtime
  assert.match(pageSource, /await assistant\.sendTurn\(trimmed/);
});

// ── 3. Authoritative User-Message Contract in projectChatV1 ─────────────────────────

test('Requirement 3: projectChatV1 prefers canonical userMessage.text and falls back to clean legacy prompt', () => {
  const turns = [
    {
      id: 'turn-1',
      userMessage: { id: 'user-1', text: 'Clean user query', createdAt: '2026-08-30T10:00:00Z' },
      prompt: '[NEvo Context: Specification]\n\nClean user query',
      work: [],
      historicalWork: [],
      currentActivity: null,
      activityCount: 0,
      finalAnswer: { id: 'f1', text: 'Answer', status: 'completed' },
      status: { status: 'terminal', outcome: 'completed' },
    },
    {
      id: 'turn-2',
      prompt: '[NEvo Context: Specification "foo"]\nTitle: "bar"\n\nLegacy prompt text',
      work: [],
      historicalWork: [],
      currentActivity: null,
      activityCount: 0,
      finalAnswer: null,
      status: { status: 'terminal', outcome: 'completed' },
    },
  ];

  const messages = projectChatV1(turns);
  assert.equal(messages.length, 4); // 2 user messages + 2 assistant messages (1 completed, 1 terminal outcome)

  const userMessages = messages.filter((m) => m.role === 'user');
  assert.equal(userMessages[0].text, 'Clean user query');
  assert.equal(userMessages[1].text, 'Legacy prompt text');
  assert.doesNotMatch(userMessages[1].text, /NEvo Context/, 'injected context header must be stripped from legacy prompt');
});

// ── 4. Snapshot-First Hydration ────────────────────────────────────────────────────

test('Requirement 4: Runtime hydrates turns and messages atomically from snapshot without event replay', () => {
  const source = readRuntimeSource();

  // Snapshot commit sets turns atomically from snapshot payload
  assert.match(source, /setTurns\(snapshot\.turns \|\| \[\]\)/);
  assert.match(source, /setMessages\(snapshot\.messages \|\| \[\]\)/);

  // SSE cursor resumes from snapshot's lastEventSeq
  assert.match(source, /const cursor = lastSeqRef\.current/);
});

// ── 5. Immediate Working Feedback After Send ────────────────────────────────────────

test('Requirement 5: Optimistic state displays neutral Starting… indicator before server Turn arrives', () => {
  const transcriptSource = readV2Source('agent-session-transcript-v2.tsx');

  assert.match(transcriptSource, /\{optimisticUserMessage && \(/);
  assert.match(transcriptSource, /<span>Starting…<\/span>/, 'must show neutral Starting… feedback, never fake Thinking');
  assert.doesNotMatch(transcriptSource, /<span>Thinking…<\/span>/, 'must not fabricate Thinking without reasoning evidence');

  // Once server turn arrives, describeCurrentActivityV2 truthfully labels waiting_for_model
  const waitingActivity = describeCurrentActivityV2({ kind: 'waiting_for_model', startedAt: '2026-08-30T10:00:00Z' });
  assert.equal(waitingActivity.label, 'Waiting for model response');
});

// ── 6 & 7. Level 2 Visual Hierarchy & Timeline Rail ─────────────────────────────────

test('Requirement 6 & 7: Level 2 renders timeline rail, compact tool titles, and readable prose commentary', () => {
  const timelineSource = readV2Source('work-timeline-v2.tsx');

  // ToolGroupRow uses text-xs typography matching active tool with muted-strong
  assert.match(timelineSource, /text-xs/);
  assert.match(timelineSource, /font-normal text-\[var\(--muted-strong\)\]/);

  // Timeline rail structure and marker positioning centered on the icon column
  assert.match(timelineSource, /left-\[18px\] top-2 w-px -translate-x-1\/2 bg-\[var\(--border\)\]/);

  // Commentary is clean bordered prose cardlet
  assert.match(timelineSource, /bg-white\/\[0\.02\]/);
  assert.match(timelineSource, /line-clamp-2/);

  // Reasoning has distinct "Thinking" cue
  assert.match(timelineSource, /Thinking/);

  // previewPlainText flattens markdown to single line
  const markdownSample = '### Step 1\nRun the test suite.\n\n- item 1\n- item 2';
  const preview = previewPlainText(markdownSample, 100);
  assert.equal(preview, 'Step 1 Run the test suite. item 1 item 2');
  assert.doesNotMatch(preview, /\n/);
});

// ── 9 & 10. Rich Work Details (Level 3) & Quiet Completion Status ───────────────────

test('Requirement 9 & 10: Work Details sheet provides 2-line layout with concrete subject and quiet check icon for completed items', () => {
  const detailsSource = readV2Source('work-details-sheet-v2.tsx');

  // Quiet check icon used for completed status
  assert.match(detailsSource, /<Check className="size-3 text-\[var\(--muted-strong\)\]"/);

  // Status badges reserved for exceptions (błąd, przerwano, aktywne)
  assert.match(detailsSource, /AlertTriangle/);
  assert.match(detailsSource, /Błąd/);
  assert.match(detailsSource, /Przerwano/);

  // Secondary line resolves subject (file, path, command, query) and duration
  assert.match(detailsSource, /resolveToolSubject/);
  assert.match(detailsSource, /formatDuration/);
});

// ── 11. Work Header Interaction ─────────────────────────────────────────────────────

test('Requirement 11: Work header is the single clean Level 2 toggle; Level 3 is accessed from Level 2 items', () => {
  const panelSource = readV2Source('turn-work-panel-v2.tsx');

  // Primary indicator button is full-width toggle for Level 2
  assert.match(panelSource, /<WorkIndicatorV2 turn=\{turn\} expanded=\{expanded\} onToggle=\{toggleExpanded\}/);

  // Level 3 sheet is accessed via Level 2 item selection and details action
  assert.match(panelSource, /onSelectItem=\{openDetailsForItem\}/);
  assert.match(panelSource, /onClick=\{openDetailsOverview\}/);
  assert.match(panelSource, /<Search className="size-3"/);
});

// ── 14. Final Answer Separation ─────────────────────────────────────────────────────

test('Requirement 14: FinalAnswer is outside Work timeline and renders null when absent', () => {
  const finalAnswerSource = readV2Source('final-answer-view-v2.tsx');
  const panelSource = readV2Source('turn-work-panel-v2.tsx');

  assert.match(finalAnswerSource, /if \(!finalAnswer \|\| finalAnswer\.status === 'absent'\) return null;/);

  const timelineIndex = panelSource.indexOf('<WorkTimelineV2');
  const finalAnswerIndex = panelSource.indexOf('<FinalAnswerViewV2');
  assert.ok(finalAnswerIndex > timelineIndex, 'FinalAnswer must render after Work');
});

// ── Level 2 Density & Invariants Test Matrix ────────────────────────────────────────

test('Level 2 Contract 1: ToolInvocation with short subject renders title + concise subject', () => {
  const mapped = mapAntigravityTool('view_file', {
    AbsolutePath: 'D:\\repos\\git\\nevo\\docs\\development\\ui-ux-guidelines.md',
  });
  assert.equal(mapped.title, 'Read file');
  assert.equal(mapped.subject, 'ui-ux-guidelines.md');

  const rows = buildTimelineRowsV2([
    {
      id: 'tool-1',
      seq: 1,
      type: 'tool',
      toolName: 'view_file',
      kind: mapped.kind,
      title: mapped.title,
      subject: mapped.subject,
      description: mapped.description,
      status: 'completed',
      actions: [],
      createdAt: '2026-09-01T20:00:00Z',
      updatedAt: '2026-09-01T20:00:01Z',
    },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].row, 'tool_group');
  assert.equal(rows[0].title, 'Read file');
  assert.equal(rows[0].subject, 'ui-ux-guidelines.md');
  assert.equal(rows[0].count, 1);
});

test('Level 2 Contract 2: ToolInvocation containing long full technical path does not expose full path in Level 2 subject', () => {
  const fullPath = 'D:\\repos\\git\\nevo\\tools\\dashboard\\server\\ai\\providers\\antigravity\\provider.mjs';
  const mapped = mapAntigravityTool('replace_file_content', {
    TargetFile: fullPath,
  });

  assert.equal(mapped.title, 'Edit file');
  assert.equal(mapped.subject, 'provider.mjs');
  assert.equal(mapped.description, fullPath);

  // Level 2 uses item.subject ('provider.mjs')
  assert.doesNotMatch(mapped.subject, /[\\/]/, 'Level 2 subject must be a concise basename, not full path');
});

test('Level 2 Contract 3: Long command line maps to concise semantic summary for Level 2 while preserving full command for Details', () => {
  const longCmd = 'node --experimental-strip-types --test tools/dashboard/tests/antigravity-provider.test.mjs --verbose';
  const mapped = mapAntigravityTool('run_command', {
    CommandLine: longCmd,
    toolSummary: 'Run dashboard tests',
  });

  assert.equal(mapped.title, 'Run command');
  assert.equal(mapped.subject, 'Run dashboard tests');
  assert.equal(mapped.description, longCmd);
});

test('Level 2 Contract 4: Multi-paragraph Markdown Commentary collapses to one plain preview for Level 2', () => {
  const multiParagraphMarkdown = `### Final Verification Report

The verification step passed with 100% test success rate.

- Test 1: PASSED
- Test 2: PASSED

\`\`\`json
{ "status": "ok" }
\`\`\`
`;

  const preview = previewPlainText(multiParagraphMarkdown, 140);
  assert.doesNotMatch(preview, /###/, 'must strip markdown headings');
  assert.doesNotMatch(preview, /```/, 'must strip code fences');
  assert.doesNotMatch(preview, /\n/, 'must collapse all newlines to single line');
  assert.ok(preview.length <= 140, 'must stay bounded to single line preview');
});

test('Level 2 Contract 5: Reasoning renders compact single-line preview only', () => {
  const reasoningMarkdown = `Thinking Process:
1. First inspect the model architecture.
2. Formulate hypothesis about state transitions.
3. Verify with unit test assertions.`;

  const preview = previewPlainText(reasoningMarkdown, 100);
  assert.doesNotMatch(preview, /\n/);
  assert.ok(preview.startsWith('Thinking Process: First inspect'));
});

test('Level 2 Contract 6: Interleaved WorkItems preserve exact temporal sequence without global regrouping', () => {
  const turn = createCanonicalTurn({ id: 'turn-large-1', provider: 'antigravity' });

  // Alternate tools, commentary, reasoning for 120 items
  for (let i = 1; i <= 120; i++) {
    if (i % 3 === 1) {
      appendWorkItem(turn, {
        id: `tool-${i}`,
        type: 'tool',
        toolName: 'view_file',
        kind: 'read',
        title: `Read file ${i}`,
        subject: `file-${i}.ts`,
        description: `/path/to/file-${i}.ts`,
        status: 'completed',
        actions: [],
      });
    } else if (i % 3 === 2) {
      appendWorkItem(turn, {
        id: `comm-${i}`,
        type: 'commentary',
        text: `Commentary narration ${i}`,
        status: 'completed',
      });
    } else {
      appendWorkItem(turn, {
        id: `reas-${i}`,
        type: 'reasoning',
        text: `Reasoning step ${i}`,
        status: 'completed',
        representation: 'summary',
      });
    }
  }

  const publicTurn = serializePublicTurn(turn);
  const rows = buildTimelineRowsV2(publicTurn.historicalWork);

  assert.equal(rows.length, 120);
  // Verify ordering is identical to canonical sequence (tool_group -> commentary -> reasoning -> tool_group...)
  for (let i = 0; i < 120; i++) {
    const expectedRowType = i % 3 === 0 ? 'tool_group' : i % 3 === 1 ? 'commentary' : 'reasoning';
    assert.equal(rows[i].row, expectedRowType, `row at index ${i} must preserve exact chronological type`);
  }
});

test('Level 2 Contract 7: Active item is projected as currentActivity and omitted from historicalWork (no duplicate current item)', () => {
  const turn = createCanonicalTurn({ id: 'turn-active-item', provider: 'antigravity' });

  appendWorkItem(turn, {
    id: 'tool-completed-1',
    type: 'tool',
    toolName: 'view_file',
    kind: 'read',
    title: 'Read file',
    subject: 'a.ts',
    status: 'completed',
    actions: [],
  });

  appendWorkItem(turn, {
    id: 'tool-active-2',
    type: 'tool',
    toolName: 'replace_file_content',
    kind: 'edit',
    title: 'Edit file',
    subject: 'b.ts',
    status: 'active',
    actions: [],
  });

  const publicTurn = serializePublicTurn(turn);

  // currentActivity represents the active tool
  assert.ok(publicTurn.currentActivity);
  assert.equal(publicTurn.currentActivity.subjectId, 'tool-active-2');
  assert.equal(publicTurn.currentActivity.title, 'Edit file');
  assert.equal(publicTurn.currentActivity.subject, 'b.ts');

  // historicalWork only contains the completed tool
  assert.equal(publicTurn.historicalWork.length, 1);
  assert.equal(publicTurn.historicalWork[0].id, 'tool-completed-1');
});

test('Level 2 Contract 8: FinalAnswer is absent from Work timeline', () => {
  const turn = createCanonicalTurn({ id: 'turn-final-answer', provider: 'antigravity' });

  appendWorkItem(turn, {
    id: 'tool-1',
    type: 'tool',
    toolName: 'run_command',
    kind: 'command',
    title: 'Run command',
    subject: 'git status',
    status: 'completed',
    actions: [],
  });

  turn.finalAnswer = {
    id: 'final-1',
    text: 'Final assistant answer for the user',
    status: 'completed',
    createdAt: '2026-09-01T20:00:02Z',
    updatedAt: '2026-09-01T20:00:02Z',
  };

  const publicTurn = serializePublicTurn(turn);
  const rows = buildTimelineRowsV2(publicTurn.historicalWork);

  // Work items contain only tools/commentary/reasoning/interaction — never FinalAnswer
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'tool-1');
  assert.equal(rows[0].row, 'tool_group');
});

// ── Section 16 Grouping & Projection Tests ──────────────────────────────────────────

test('16.1 Adjacent grouping: compresses consecutive happy-path actions while preserving L3 canonical count', () => {
  const items = [
    { id: '1', type: 'tool', toolName: 'view_file', kind: 'read', title: 'Read file', subject: 'a.ts', status: 'completed', actions: [] },
    { id: '2', type: 'tool', toolName: 'view_file', kind: 'read', title: 'Read file', subject: 'b.ts', status: 'completed', actions: [] },
    { id: '3', type: 'tool', toolName: 'view_file', kind: 'read', title: 'Read file', subject: 'c.ts', status: 'completed', actions: [] },
    { id: '4', type: 'tool', toolName: 'grep_search', kind: 'search', title: 'Search files', subject: 'q1', status: 'completed', actions: [] },
    { id: '5', type: 'tool', toolName: 'grep_search', kind: 'search', title: 'Search files', subject: 'q2', status: 'completed', actions: [] },
  ];

  const l2Rows = buildTimelineRowsV2(items);
  assert.equal(l2Rows.length, 2);
  assert.equal(l2Rows[0].row, 'tool_group');
  assert.equal(l2Rows[0].title, 'Read file');
  assert.equal(l2Rows[0].count, 3);
  assert.equal(l2Rows[0].subject, undefined, 'differing subjects should be omitted from grouped summary');

  assert.equal(l2Rows[1].row, 'tool_group');
  assert.equal(l2Rows[1].title, 'Search files');
  assert.equal(l2Rows[1].count, 2);

  // Canonical items remain 5
  assert.equal(items.length, 5);
});

test('16.2 Chronology boundary: Commentary breaks grouping', () => {
  const items = [
    { id: '1', type: 'tool', toolName: 'run_command', kind: 'command', title: 'Run command', status: 'completed', actions: [] },
    { id: '2', type: 'tool', toolName: 'run_command', kind: 'command', title: 'Run command', status: 'completed', actions: [] },
    { id: '3', type: 'commentary', text: 'Port is wrong, retrying.', status: 'completed' },
    { id: '4', type: 'tool', toolName: 'run_command', kind: 'command', title: 'Run command', status: 'completed', actions: [] },
    { id: '5', type: 'tool', toolName: 'view_file', kind: 'read', title: 'Read file', status: 'completed', actions: [] },
    { id: '6', type: 'tool', toolName: 'view_file', kind: 'read', title: 'Read file', status: 'completed', actions: [] },
  ];

  const rows = buildTimelineRowsV2(items);
  assert.equal(rows.length, 4);
  assert.equal(rows[0].row, 'tool_group');
  assert.equal(rows[0].count, 2);
  assert.equal(rows[1].row, 'commentary');
  assert.equal(rows[2].row, 'tool_group');
  assert.equal(rows[2].count, 1);
  assert.equal(rows[3].row, 'tool_group');
  assert.equal(rows[3].count, 2);
});

test('16.3 Reasoning boundary: Reasoning breaks grouping', () => {
  const items = [
    { id: '1', type: 'tool', toolName: 'view_file', kind: 'read', title: 'Read file', status: 'completed', actions: [] },
    { id: '2', type: 'tool', toolName: 'view_file', kind: 'read', title: 'Read file', status: 'completed', actions: [] },
    { id: '3', type: 'reasoning', text: 'Checking types next', status: 'completed', representation: 'summary' },
    { id: '4', type: 'tool', toolName: 'view_file', kind: 'read', title: 'Read file', status: 'completed', actions: [] },
    { id: '5', type: 'tool', toolName: 'view_file', kind: 'read', title: 'Read file', status: 'completed', actions: [] },
  ];

  const rows = buildTimelineRowsV2(items);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].row, 'tool_group');
  assert.equal(rows[0].count, 2);
  assert.equal(rows[1].row, 'reasoning');
  assert.equal(rows[2].row, 'tool_group');
  assert.equal(rows[2].count, 2);
});

test('16.4 Exception boundary: Failed tools are not swallowed into happy-path groups', () => {
  const items = [
    { id: '1', type: 'tool', toolName: 'run_command', kind: 'command', title: 'Run command', status: 'completed', actions: [] },
    { id: '2', type: 'tool', toolName: 'run_command', kind: 'command', title: 'Run command', status: 'completed', actions: [] },
    { id: '3', type: 'tool', toolName: 'run_command', kind: 'command', title: 'Run command', status: 'failed', actions: [] },
    { id: '4', type: 'tool', toolName: 'run_command', kind: 'command', title: 'Run command', status: 'completed', actions: [] },
    { id: '5', type: 'tool', toolName: 'run_command', kind: 'command', title: 'Run command', status: 'completed', actions: [] },
  ];

  const rows = buildTimelineRowsV2(items);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].row, 'tool_group');
  assert.equal(rows[0].count, 2);
  assert.equal(rows[0].status, 'completed');

  assert.equal(rows[1].row, 'tool_group');
  assert.equal(rows[1].count, 1);
  assert.equal(rows[1].status, 'failed', 'failed item must remain standalone with failed status');

  assert.equal(rows[2].row, 'tool_group');
  assert.equal(rows[2].count, 2);
  assert.equal(rows[2].status, 'completed');
});

test('16.5 Different type/title: No global grouping across different tools', () => {
  const items = [
    { id: '1', type: 'tool', toolName: 'view_file', kind: 'read', title: 'Read file', status: 'completed', actions: [] },
    { id: '2', type: 'tool', toolName: 'replace_file_content', kind: 'edit', title: 'Edit file', status: 'completed', actions: [] },
    { id: '3', type: 'tool', toolName: 'view_file', kind: 'read', title: 'Read file', status: 'completed', actions: [] },
  ];

  const rows = buildTimelineRowsV2(items);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].title, 'Read file');
  assert.equal(rows[1].title, 'Edit file');
  assert.equal(rows[2].title, 'Read file');
});

test('16.6 Single subject: Single tool row retains concise subject', () => {
  const items = [
    { id: '1', type: 'tool', toolName: 'view_file', kind: 'read', title: 'Read file', subject: 'provider.mjs', status: 'completed', actions: [] },
  ];

  const rows = buildTimelineRowsV2(items);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].row, 'tool_group');
  assert.equal(rows[0].title, 'Read file');
  assert.equal(rows[0].subject, 'provider.mjs');
  assert.equal(rows[0].count, 1);
});

test('16.7 Group subject: Grouped items with differing subjects do not concatenate filenames', () => {
  const items = [
    { id: '1', type: 'tool', toolName: 'view_file', kind: 'read', title: 'Read file', subject: 'a.ts', status: 'completed', actions: [] },
    { id: '2', type: 'tool', toolName: 'view_file', kind: 'read', title: 'Read file', subject: 'b.ts', status: 'completed', actions: [] },
    { id: '3', type: 'tool', toolName: 'view_file', kind: 'read', title: 'Read file', subject: 'c.ts', status: 'completed', actions: [] },
  ];

  const rows = buildTimelineRowsV2(items);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].count, 3);
  assert.equal(rows[0].subject, undefined);
});

test('16.9 Compression of 40+ consecutive items into compact grouped timeline rows', () => {
  const items = [];
  // 10 Read files
  for (let i = 1; i <= 10; i++) {
    items.push({ id: `r-${i}`, type: 'tool', toolName: 'view_file', kind: 'read', title: 'Read file', subject: `f${i}.ts`, status: 'completed', actions: [] });
  }
  // 10 Search files
  for (let i = 1; i <= 10; i++) {
    items.push({ id: `s-${i}`, type: 'tool', toolName: 'grep_search', kind: 'search', title: 'Search files', subject: `q${i}`, status: 'completed', actions: [] });
  }
  // 1 Commentary
  items.push({ id: 'c-1', type: 'commentary', text: 'I found the relevant projection and am checking tests.', status: 'completed' });
  // 5 Run commands
  for (let i = 1; i <= 5; i++) {
    items.push({ id: `cmd-${i}`, type: 'tool', toolName: 'run_command', kind: 'command', title: 'Run command', status: 'completed', actions: [] });
  }
  // 1 Reasoning
  items.push({ id: 'reas-1', type: 'reasoning', text: 'Verifying grouping boundaries...', status: 'completed', representation: 'summary' });
  // 1 Edit file
  items.push({ id: 'edit-1', type: 'tool', toolName: 'replace_file_content', kind: 'edit', title: 'Edit file', subject: 'timeline-projection-v2.ts', status: 'completed', actions: [] });
  // 1 Failed command
  items.push({ id: 'cmd-fail', type: 'tool', toolName: 'run_command', kind: 'command', title: 'Run command', status: 'failed', actions: [] });

  assert.equal(items.length, 29);

  const l2Rows = buildTimelineRowsV2(items);
  // Expected L2 rows:
  // 1. Read file (10)
  // 2. Search files (10)
  // 3. Commentary
  // 4. Run command (5)
  // 5. Reasoning
  // 6. Edit file · timeline-projection-v2.ts
  // 7. Run command (failed)
  assert.equal(l2Rows.length, 7);
  assert.equal(l2Rows[0].title, 'Read file');
  assert.equal(l2Rows[0].count, 10);
  assert.equal(l2Rows[1].title, 'Search files');
  assert.equal(l2Rows[1].count, 10);
  assert.equal(l2Rows[2].row, 'commentary');
  assert.equal(l2Rows[3].title, 'Run command');
  assert.equal(l2Rows[3].count, 5);
  assert.equal(l2Rows[4].row, 'reasoning');
  assert.equal(l2Rows[5].title, 'Edit file');
  assert.equal(l2Rows[5].count, 1);
  assert.equal(l2Rows[5].subject, 'timeline-projection-v2.ts');
  assert.equal(l2Rows[6].title, 'Run command');
  assert.equal(l2Rows[6].count, 1);
  assert.equal(l2Rows[6].status, 'failed');
});

test('15.5 Repeated Commentary compression: identical narration is presentation-compressed in Level 2 while fully retained in Level 3', () => {
  const repeatedNarration = 'I will wait for the test run to complete.';
  const items = [
    { id: 'c-1', type: 'commentary', text: repeatedNarration, status: 'completed' },
    { id: 't-1', type: 'tool', toolName: 'run_command', kind: 'command', title: 'Run command', status: 'completed', actions: [] },
    { id: 'c-2', type: 'commentary', text: repeatedNarration, status: 'completed' },
    { id: 't-2', type: 'tool', toolName: 'run_command', kind: 'command', title: 'Run command', status: 'completed', actions: [] },
    { id: 'c-3', type: 'commentary', text: repeatedNarration, status: 'completed' },
    { id: 't-3', type: 'tool', toolName: 'run_command', kind: 'command', title: 'Run command', status: 'completed', actions: [] },
  ];

  // Canonical/L3 keeps all 6 individual items
  assert.equal(items.length, 6);

  // L2 projection compresses repeated commentary and groups adjacent tools
  const l2Rows = buildTimelineRowsV2(items);
  assert.equal(l2Rows.length, 2, 'must not render multiple identical commentary rows in L2');

  assert.equal(l2Rows[0].row, 'commentary');
  assert.equal(l2Rows[0].item.text, repeatedNarration);
  assert.equal(l2Rows[0].repeatCount, 3, 'must accurately track repetition count');

  assert.equal(l2Rows[1].row, 'tool_group');
  assert.equal(l2Rows[1].title, 'Run command');
  assert.equal(l2Rows[1].count, 3);
});

test('15.6 Different Commentary preserved: non-identical narration rows remain distinct with no fuzzy dedupe', () => {
  const items = [
    { id: 'c-1', type: 'commentary', text: 'Starting test run...', status: 'completed' },
    { id: 't-1', type: 'tool', toolName: 'run_command', kind: 'command', title: 'Run command', status: 'completed', actions: [] },
    { id: 'c-2', type: 'commentary', text: 'Tests still executing, waiting...', status: 'completed' },
    { id: 't-2', type: 'tool', toolName: 'run_command', kind: 'command', title: 'Run command', status: 'completed', actions: [] },
    { id: 'c-3', type: 'commentary', text: 'Tests finished with 2 failures.', status: 'completed' },
  ];

  const l2Rows = buildTimelineRowsV2(items);
  assert.equal(l2Rows.length, 5, 'all 3 distinct commentaries must remain visible');
  assert.equal(l2Rows[0].row, 'commentary');
  assert.equal(l2Rows[1].row, 'tool_group');
  assert.equal(l2Rows[2].row, 'commentary');
  assert.equal(l2Rows[3].row, 'tool_group');
  assert.equal(l2Rows[4].row, 'commentary');
});

test('15.7 Visible history cap: projectTimelineV2 bounds visible rows and computes accurate hiddenCount', () => {
  // Build a Turn with 15 distinct projected rows
  const items = [];
  for (let i = 1; i <= 15; i++) {
    items.push({
      id: `t-${i}`,
      type: 'tool',
      toolName: 'view_file',
      kind: 'read',
      title: `Read file ${i}`,
      subject: `file-${i}.ts`,
      status: 'completed',
      actions: [],
    });
  }

  const projection = projectTimelineV2(items, { maxRows: 8 });
  assert.equal(projection.allRows.length, 15);
  assert.equal(projection.visibleRows.length, 8);
  assert.equal(projection.hasMore, true);
  assert.equal(projection.hiddenRowCount, 7);
  assert.equal(projection.hiddenCount, 7, 'accurately counts 7 hidden canonical items');

  // When under budget, hasMore is false and all rows visible
  const smallProjection = projectTimelineV2(items.slice(0, 5), { maxRows: 8 });
  assert.equal(smallProjection.visibleRows.length, 5);
  assert.equal(smallProjection.hasMore, false);
  assert.equal(smallProjection.hiddenCount, 0);
});

test('Antigravity tool normalization: manage_task and provider tools map to semantic public titles', () => {
  const taskTool = mapAntigravityTool('manage_task', { Action: 'status', TaskId: 'task-123' });
  assert.equal(taskTool.title, 'Update task');
  assert.equal(taskTool.toolName, 'manage_task');
  assert.doesNotMatch(taskTool.title, /manage_task/, 'raw snake_case tool name must not leak into title');

  const subagentTool = mapAntigravityTool('invoke_subagent', {
    Subagents: [{ Role: 'Codebase Researcher' }],
    toolSummary: 'Research codebase',
  });
  assert.equal(subagentTool.title, 'Invoke subagent');
  assert.equal(subagentTool.subject, 'Codebase Researcher');

  const msgTool = mapAntigravityTool('send_message', { Recipient: 'agent-1', Message: 'Hello' });
  assert.equal(msgTool.title, 'Send message');

  const schedTool = mapAntigravityTool('schedule', { DurationSeconds: 300, Prompt: 'Check progress' });
  assert.equal(schedTool.title, 'Schedule timer');
});

test('16. Visual acceptance fixture: 70+ canonical items compress into bounded L2 timeline rows with accurate disclosure', () => {
  const items = [];
  let seq = 1;

  // 1. Read file group (4 items)
  for (let i = 1; i <= 4; i++) {
    items.push({ id: `item-${seq++}`, type: 'tool', toolName: 'view_file', kind: 'read', title: 'Read file', subject: `spec-${i}.md`, status: 'completed', actions: [] });
  }
  // 2. List directory (1 item)
  items.push({ id: `item-${seq++}`, type: 'tool', toolName: 'list_dir', kind: 'list', title: 'List directory', subject: 'docs', status: 'completed', actions: [] });
  // 3. Read file group (5 items)
  for (let i = 1; i <= 5; i++) {
    items.push({ id: `item-${seq++}`, type: 'tool', toolName: 'view_file', kind: 'read', title: 'Read file', subject: `guide-${i}.md`, status: 'completed', actions: [] });
  }
  // 4. Edit file (1 item)
  items.push({ id: `item-${seq++}`, type: 'tool', toolName: 'replace_file_content', kind: 'edit', title: 'Edit file', subject: 'timeline.ts', status: 'completed', actions: [] });
  // 5. Read file group (3 items)
  for (let i = 1; i <= 3; i++) {
    items.push({ id: `item-${seq++}`, type: 'tool', toolName: 'view_file', kind: 'read', title: 'Read file', subject: `ref-${i}.ts`, status: 'completed', actions: [] });
  }
  // 6. Run command group (2 items)
  for (let i = 1; i <= 2; i++) {
    items.push({ id: `item-${seq++}`, type: 'tool', toolName: 'run_command', kind: 'command', title: 'Run command', subject: 'npm test', status: 'completed', actions: [] });
  }
  // 7. Repeated Commentary (waiting) interleaved with tools (3 repeats)
  const waitingCommentary = 'I will wait for the test run to complete.';
  for (let i = 1; i <= 3; i++) {
    items.push({ id: `item-${seq++}`, type: 'commentary', text: waitingCommentary, status: 'completed' });
    items.push({ id: `item-${seq++}`, type: 'tool', toolName: 'manage_task', kind: 'other', title: 'Update task', subject: 'status', status: 'completed', actions: [] });
  }
  // 8. Meaningful distinct Commentary
  items.push({ id: `item-${seq++}`, type: 'commentary', text: 'Tests completed successfully. Now verifying search results.', status: 'completed' });
  // 9. Search files group (2 items)
  for (let i = 1; i <= 2; i++) {
    items.push({ id: `item-${seq++}`, type: 'tool', toolName: 'grep_search', kind: 'search', title: 'Search files', subject: `query-${i}`, status: 'completed', actions: [] });
  }
  // 10. Run command group (3 items)
  for (let i = 1; i <= 3; i++) {
    items.push({ id: `item-${seq++}`, type: 'tool', toolName: 'run_command', kind: 'command', title: 'Run command', subject: 'git diff', status: 'completed', actions: [] });
  }
  // 11. Reasoning item
  items.push({ id: `item-${seq++}`, type: 'reasoning', text: 'Verifying that all acceptance criteria are met.', status: 'completed', representation: 'summary' });
  // 12. Alternating Read/Edit pairs (10 pairs = 20 items)
  for (let i = 1; i <= 10; i++) {
    items.push({ id: `item-${seq++}`, type: 'tool', toolName: 'view_file', kind: 'read', title: 'Read file', subject: `f${i}.ts`, status: 'completed', actions: [] });
    items.push({ id: `item-${seq++}`, type: 'tool', toolName: 'replace_file_content', kind: 'edit', title: 'Edit file', subject: `f${i}.ts`, status: 'completed', actions: [] });
  }
  // 13. One failed tool
  items.push({ id: `item-${seq++}`, type: 'tool', toolName: 'run_command', kind: 'command', title: 'Run command', subject: 'npm run lint', status: 'failed', actions: [] });
  // 14. Remaining read/search items to reach 75 total items
  for (let i = 1; i <= 25; i++) {
    items.push({ id: `item-${seq++}`, type: 'tool', toolName: 'view_file', kind: 'read', title: 'Read file', subject: `verify-${i}.ts`, status: 'completed', actions: [] });
  }

  assert.ok(items.length >= 70, `must have at least 70 items (actual: ${items.length})`);

  // Canonical / Level 3 retains every single item
  assert.equal(items.length, 75);

  // Stage A projection: groups adjacent happy-path tools and dedupes repeated commentary
  const allL2Rows = buildTimelineRowsV2(items);
  // Stage B projection: caps visible L2 history to default budget (8 rows)
  const projection = projectTimelineV2(items, { maxRows: 8 });

  assert.equal(projection.visibleRows.length, 8, 'must render exactly 8 rows in Level 2');
  assert.equal(projection.hasMore, true);
  assert.ok(projection.hiddenCount > 40, `must accurately report >40 hidden items (actual: ${projection.hiddenCount})`);
  assert.equal(projection.hiddenCount + projection.visibleRows.reduce((sum, r) => sum + (r.row === 'tool_group' ? r.count : (r.row === 'commentary' ? (r.repeatCount || 1) : 1)), 0), items.length, 'hiddenCount + visible items must exactly equal total canonical items');
});

