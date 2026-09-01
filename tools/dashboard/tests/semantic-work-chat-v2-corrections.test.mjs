import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { projectChatV1, deriveLegacyUserMessageText } from '../server/ai/contracts.mjs';
import { shouldCollapseMessage } from '../ui/features/agent-sessions/transcript/message-collapse.ts';
import { previewPlainText } from '../ui/features/agent-sessions/work-v2/text-preview-v2.ts';
import { describeCurrentActivityV2, terminalHeaderLabelV2 } from '../ui/features/agent-sessions/work-v2/activity-model-v2.ts';

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

  // ToolRow uses compact body typography with medium weight
  assert.match(timelineSource, /font-medium text-\[var\(--foreground\)\]/);
  assert.match(timelineSource, /text-xs leading-5/);

  // CommentaryRow uses subtle pl-5 indentation, no type icon, and plain preview text
  assert.match(timelineSource, /pl-5/);
  assert.match(timelineSource, /font-normal leading-relaxed text-\[var\(--foreground-muted\)\]/);
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
  assert.match(panelSource, /aria-label="Szczegóły Work"/);
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
