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
import { buildTimelineRowsV2 } from '../ui/features/agent-sessions/work-v2/timeline-projection-v2.ts';

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

// ── 6 & 7. Level 2 Visual Hierarchy & Commentary as Narration ───────────────────────

test('Requirement 6 & 7: Level 2 renders compact tool titles and indented narration-style commentary', () => {
  const timelineSource = readV2Source('work-timeline-v2.tsx');

  // ToolRow uses compact body typography with modest emphasis (not heavy white heading)
  assert.match(timelineSource, /font-normal text-\[var\(--foreground-muted\)\]/);
  assert.match(timelineSource, /text-xs leading-5/);

  // CommentaryRow uses subtle pl-5 indentation, no type icon, and plain preview text
  assert.match(timelineSource, /pl-5/);
  assert.match(timelineSource, /font-normal leading-relaxed text-\[var\(--muted\)\]/);
  assert.doesNotMatch(timelineSource, />\s*Commentary\s*</, 'Level 2 commentary must not render a "Commentary" heading label');

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
  assert.match(detailsSource, /<Check className="size-3\.5 text-\[var\(--success\)\]"/);

  // Status badges reserved for exceptions (błąd, przerwano, aktywne)
  assert.match(detailsSource, /AlertTriangle/);
  assert.match(detailsSource, /Błąd/);
  assert.match(detailsSource, /Przerwano/);

  // Secondary line resolves subject (file, path, command, query) and duration
  assert.match(detailsSource, /resolveToolSubject/);
  assert.match(detailsSource, /formatDuration/);
});

// ── 11. Work Header Interaction ─────────────────────────────────────────────────────

test('Requirement 11: Work header expands/collapses Level 2; Info icon opens Level 3 sheet', () => {
  const panelSource = readV2Source('turn-work-panel-v2.tsx');

  // Primary indicator button toggles Level 2
  assert.match(panelSource, /<WorkIndicatorV2 turn=\{turn\} expanded=\{expanded\} onToggle=\{toggleExpanded\}/);

  // Details button is separate sibling that calls openDetailsOverview
  assert.match(panelSource, /onClick=\{openDetailsOverview\}/);
  assert.match(panelSource, /aria-label="(?:Work Details|Szczegóły Work)"/);
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

// ── Level 2 Density & Invariants Test Matrix (Section 8) ───────────────────────────

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
  assert.equal(rows[0].row, 'tool');
  assert.equal(rows[0].item.title, 'Read file');
  assert.equal(rows[0].item.subject, 'ui-ux-guidelines.md');
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

test('Level 2 Contract 6: 100+ WorkItems in canonical order preserves exact temporal sequence without category regrouping', () => {
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
  // Verify ordering is identical to canonical sequence (tool -> commentary -> reasoning -> tool...)
  for (let i = 0; i < 120; i++) {
    const expectedRowType = i % 3 === 0 ? 'tool' : i % 3 === 1 ? 'commentary' : 'reasoning';
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
  assert.ok(!rows.some((r) => r.item.text === 'Final assistant answer for the user'));
});
