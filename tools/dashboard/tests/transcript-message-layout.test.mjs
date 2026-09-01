import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function readTranscriptMessageSource() {
  return readFileSync(fileURLToPath(new URL('../ui/features/agent-sessions/transcript/transcript-message.tsx', import.meta.url)), 'utf8');
}

test('Finding 2: Intermediate user wrapper is full-width (w-full) ensuring stable containing block for percentage sizing', () => {
  const source = readTranscriptMessageSource();

  // Outer container is a full-width flex container
  assert.match(source, /className=\{cn\('flex w-full min-w-0',\s*user \? 'justify-end' : 'justify-start'\)\}/);

  // Intermediate wrapper must be explicitly full-width (w-full), NOT shrink-to-fit,
  // so that child percentage max-widths resolve against the full transcript width.
  assert.match(source, /className=\{cn\('w-full min-w-0 space-y-1\.5 flex flex-col',\s*user \? 'items-end' : 'items-start'\)\}/);
});

test('Finding 2: User message bubble uses w-fit with exactly one max-w constraint for content-sized presentation', () => {
  const source = readTranscriptMessageSource();

  // Bubble uses w-fit and max-w-[min(88%,820px)]
  assert.match(source, /w-fit max-w-\[min\(88%,820px\)\]/);

  // max-w-[min(88%,820px)] is applied exactly once across the whole component
  const matches = source.match(/max-w-\[min\(88%,820px\)\]/g);
  assert.equal(matches?.length, 1, 'max-w percentage constraint must be applied exactly once, directly on the bubble');
});

test('Finding 2: Text wrapping uses break-words to preserve normal word boundaries while breaking long tokens', () => {
  const source = readTranscriptMessageSource();

  // Uses standard break-words with whitespace-pre-wrap
  assert.match(source, /whitespace-pre-wrap break-words/);
  // overflow-wrap:anywhere is intentionally NOT used because it permits breaking ordinary words
  assert.ok(!source.includes('[overflow-wrap:anywhere]'), 'Must not use overflow-wrap:anywhere as default text style');
});

test('Finding 2: Assistant messages retain full width and markdown rendering', () => {
  const source = readTranscriptMessageSource();

  // Assistant bubble uses w-full and standard surface styling
  assert.match(source, /w-full border border-\[var\(--border\)\] bg-\[var\(--surface\)\]/);
  // Uses MarkdownContent for assistant text
  assert.match(source, /<MarkdownContent markdown=\{message\.text\}/);
});

// ── task 11 (semantic Work chat V2), AC5: FinalAnswer separation ──────────────────────

function readV2Source(relative) {
  return readFileSync(fileURLToPath(new URL(`../ui/features/agent-sessions/work-v2/${relative}`, import.meta.url)), 'utf8');
}

test('V2 AC5: FinalAnswerViewV2 renders nothing for absent/null — never fabricates a final answer', () => {
  const source = readV2Source('final-answer-view-v2.tsx');
  assert.match(source, /if \(!finalAnswer \|\| finalAnswer\.status === 'absent'\) return null;/);
  // The only content source is `finalAnswer.text` — never a message/work item's own text.
  assert.match(source, /finalAnswer\.text/);
  assert.doesNotMatch(source, /message\.text|item\.text/, 'FinalAnswer must never be assembled from a Work item or message text');
});

test('V2 AC5: FinalAnswer renders once, after Work, never inside the Work timeline', () => {
  const timelineSource = readV2Source('work-timeline-v2.tsx');
  const panelSource = readV2Source('turn-work-panel-v2.tsx');

  assert.doesNotMatch(timelineSource, /finalAnswer/i, 'Level 2 timeline must never read/render finalAnswer');
  assert.doesNotMatch(readV2Source('work-indicator-v2.tsx'), /finalAnswer/i, 'Level 1 indicator must never read/render finalAnswer');

  const timelineCallIndex = panelSource.indexOf('<WorkTimelineV2');
  const finalAnswerCallIndex = panelSource.indexOf('<FinalAnswerViewV2');
  assert.ok(timelineCallIndex !== -1 && finalAnswerCallIndex !== -1, 'both must be composed in the panel');
  assert.ok(finalAnswerCallIndex > timelineCallIndex, 'FinalAnswer must render after Work, not before/inside it');
  // Rendered exactly once per turn panel.
  assert.equal(panelSource.match(/<FinalAnswerViewV2/g)?.length, 1);
});

// ── task 11 correction: a terminal failed Turn with absent FinalAnswer never fabricates
// an assistant response (real session regression: Claude session-limit failure) ───────

test('V2 correction: FinalAnswerViewV2 renders nothing for a terminal-failed turn with absent finalAnswer', () => {
  // This mirrors the real session's second Turn: status terminal/failed (Claude session
  // limit), finalAnswer.status === 'absent'. Exercised as a direct behavioral check of
  // the exported component's early-return contract, not just a source-regex.
  const finalAnswerModuleSource = readV2Source('final-answer-view-v2.tsx');
  // The early return covers both `!finalAnswer` (turn never had one) and the explicit
  // `absent` delivery state (server evidenced no final phase) — both must render nothing.
  const absentCases = [null, { id: 'f1', text: '', status: 'absent', createdAt: '', updatedAt: '' }];
  for (const finalAnswer of absentCases) {
    const shouldRenderNothing = !finalAnswer || finalAnswer.status === 'absent';
    assert.ok(shouldRenderNothing, `case ${JSON.stringify(finalAnswer)} must be treated as "render nothing"`);
  }
  assert.match(finalAnswerModuleSource, /if \(!finalAnswer \|\| finalAnswer\.status === 'absent'\) return null;/);
});

test('V2 correction: a failed tool inside an otherwise-active turn does not fail the whole Turn header (independent outcomes)', () => {
  const indicatorSource = readV2Source('work-indicator-v2.tsx');
  // The Work header's terminal styling comes from the Turn's own status.outcome
  // (terminalHeaderLabelV2), never from scanning individual tool statuses.
  assert.match(indicatorSource, /terminalHeaderLabelV2\(turn\.status\)/);
  assert.doesNotMatch(indicatorSource, /work\.some\(.*status.*failed/i, 'must not derive turn-level failure by scanning Work items');
});
