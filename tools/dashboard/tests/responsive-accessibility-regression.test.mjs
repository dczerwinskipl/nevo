import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function readSource(relative) {
  return readFileSync(fileURLToPath(new URL(`../ui/${relative}`, import.meta.url)), 'utf8');
}

test('AC1 & AC2: Header and transcript layouts prevent horizontal overflow across responsive widths', () => {
  const headerSource = readSource('features/agent-sessions/agent-session-header.tsx');
  const transcriptSource = readSource('features/agent-sessions/work/agent-session-transcript.tsx');
  const agentSessionPageSource = readSource('features/agent-sessions/agent-session-page.tsx');

  // Header has min-w-0 on flex containers and truncate on title
  assert.match(headerSource, /min-w-0/);
  assert.match(headerSource, /truncate text-sm font-semibold/);

  // Transcript message container has min-w-0 and break-words for content wrapping
  assert.match(transcriptSource, /flex w-full min-w-0/);
  assert.match(transcriptSource, /break-words/);

  // Shell handles overflow-hidden and overscroll-none
  assert.match(agentSessionPageSource, /overflow-hidden overscroll-none/);
});

test('Documentation layout constrains both grid tracks and rendered Markdown to the viewport', () => {
  const specDetailSource = readSource('features/specifications/detail/documentation-panel.tsx');
  const documentSectionSource = readSource('features/specifications/detail/document-section-panel.tsx');
  const directorySectionSource = readSource('features/specifications/detail/directory-section-panel.tsx');
  const stylesSource = readSource('index.css');

  assert.match(specDetailSource, /lg:grid-cols-\[minmax\(0,280px\)_minmax\(0,1fr\)\]/);
  assert.match(specDetailSource, /w-full max-w-full min-w-0/);
  assert.match(documentSectionSource, /w-full max-w-full min-w-0/);
  assert.match(directorySectionSource, /w-full max-w-full min-w-0/);
  assert.match(stylesSource, /\.markdown-body \{\s+width: 100%;\s+min-width: 0;\s+max-width: 100%;/);
});

test('AC3: Mobile keyboard viewport adjustments and safe area insets are wired', () => {
  const agentSessionPageSource = readSource('features/agent-sessions/agent-session-page.tsx');
  const viewportSource = readSource('features/agent-sessions/transcript/use-visual-viewport.ts');
  const sheetSource = readSource('shared/ui/sheet.tsx');

  // AgentSessionPage consumes useVisualViewport's keyboardOpen state
  assert.match(agentSessionPageSource, /useVisualViewport/);
  assert.match(agentSessionPageSource, /keyboardOpen/);

  // useVisualViewport listens to visualViewport resize/scroll
  assert.match(viewportSource, /visualViewport\?\.addEventListener\('resize'/);
  assert.match(viewportSource, /keyboardOpen/);

  // Safe area insets in chat surface and sheet
  const chatSurfaceSource = readSource('features/agent-sessions/agent-session-chat-surface.tsx');
  assert.match(chatSurfaceSource, /env\(safe-area-inset-bottom\)/);
  assert.match(sheetSource, /env\(safe-area-inset-top\)/);
  assert.match(sheetSource, /env\(safe-area-inset-bottom\)/);
});

test('AC4: Composer handles long prompts with vertical expansion and internal scroll', () => {
  const composerSource = readSource('features/agent-sessions/composer/agent-session-composer.tsx');
  const sizingSource = readSource('features/agent-sessions/composer/composer-sizing.ts');

  // Textarea uses auto-height adjustment and internal scroll when exceeding max height
  assert.match(composerSource, /adjustComposerTextareaElement/);
  assert.match(sizingSource, /max-h-\[40vh\]/);
  assert.match(sizingSource, /overflow-y-auto/);
});

test('AC5: Assistant messages render markdown and code cleanly', () => {
  const finalAnswerSource = readSource('features/agent-sessions/work/final-answer-view.tsx');

  assert.match(finalAnswerSource, /<MarkdownContent markdown=\{finalAnswer\.text\}/);
});

test('AC6: Tool details constrain large inputs and outputs with scrollable pre containers', () => {
  const detailsSheetSource = readSource('features/agent-sessions/work/work-details-sheet.tsx');

  // Large input/output payloads use max-h-48 with overflow-auto
  assert.match(detailsSheetSource, /max-h-48 overflow-auto rounded-lg border/);
  assert.match(detailsSheetSource, /formatPayload\(item\.input\)/);
  assert.match(detailsSheetSource, /formatPayload\(item\.output\)/);
});

test('AC7: Session details sheet supports both mobile (full width) and desktop (max-w-md)', () => {
  const sheetSource = readSource('shared/ui/sheet.tsx');
  const sessionDetailsSource = readSource('features/agent-sessions/agent-session-details.tsx');

  // Responsive width in sheetVariants
  assert.match(sheetSource, /w-full .* sm:max-w-md/);

  // Session details components render spec, tasks, provider, mode, and delete
  assert.match(sessionDetailsSource, /specTitle/);
  assert.match(sessionDetailsSource, /tasks/);
  assert.match(sessionDetailsSource, /provider/);
  assert.match(sessionDetailsSource, /mode/);
  assert.match(sessionDetailsSource, /onDelete/);
});

test('AC8: Core interactive controls have accessible names and labels', () => {
  const headerSource = readSource('features/agent-sessions/agent-session-header.tsx');
  const composerSource = readSource('features/agent-sessions/composer/agent-session-composer.tsx');
  const sheetSource = readSource('shared/ui/sheet.tsx');

  // Back button and details button have accessible names
  assert.match(headerSource, /aria-label=\{backLabel\}/);
  assert.match(headerSource, /aria-label="Szczegóły sesji"/);

  // Composer textarea and buttons have accessible names
  assert.match(composerSource, /<span className="sr-only">Wiadomość<\/span>/);
  assert.match(composerSource, /aria-label="Przerwij generowanie"/);
  assert.match(composerSource, /aria-label="Wyślij wiadomość"/);

  // Sheet close button
  assert.match(sheetSource, /aria-label="Zamknij"/);
});

test('AC9: Expanded/collapsed state is exposed via aria-expanded on all collapsible controls', () => {
  const transcriptSource = readSource('features/agent-sessions/work/agent-session-transcript.tsx');
  const indicatorSource = readSource('features/agent-sessions/work/work-indicator.tsx');

  // Message collapse
  assert.match(transcriptSource, /aria-expanded=\{expanded\}/);

  // Work indicator collapse
  assert.match(indicatorSource, /aria-expanded=\{expanded\}/);
});

test('AC10: Role and status distinctions are not color-only', () => {
  const transcriptSource = readSource('features/agent-sessions/work/agent-session-transcript.tsx');
  const indicatorSource = readSource('features/agent-sessions/work/work-indicator.tsx');

  // User vs Assistant role distinction uses structural alignment
  assert.match(transcriptSource, /justify-end/);

  // Work indicator uses distinct icons and text for status
  assert.match(indicatorSource, /CheckCircle2/);
  assert.match(indicatorSource, /AlertTriangle/);
  assert.match(indicatorSource, /LoaderCircle/);
  assert.match(indicatorSource, /requires_attention/);
});

test('AC11: Keyboard focus management, tab order, and keydown handlers are structured for desktop keyboard navigation', () => {
  const buttonSource = readSource('shared/ui/button.tsx');
  const composerSource = readSource('features/agent-sessions/composer/agent-session-composer.tsx');
  const headerSource = readSource('features/agent-sessions/agent-session-header.tsx');
  const transcriptSource = readSource('features/agent-sessions/work/agent-session-transcript.tsx');
  const detailsSheetSource = readSource('features/agent-sessions/work/work-details-sheet.tsx');
  const scrollFollowSource = readSource('features/agent-sessions/transcript/use-scroll-follow.ts');

  // Interactive buttons have focus-visible rings defined
  assert.match(buttonSource, /focus-visible:ring-2/);
  assert.match(headerSource, /<Button/);

  // Expand/collapse controls use native semantic button types
  assert.match(composerSource, /type="button"/);
  assert.match(transcriptSource, /type="button"/);
  assert.match(detailsSheetSource, /type="button"/);

  // Scroll follow handles PageUp and Home keys for keyboard history navigation
  assert.match(scrollFollowSource, /e\.key === 'PageUp' \|\| e\.key === 'Home'/);
});

// ── task 11 (semantic Work chat), AC8: desktop/mobile Work UX responsiveness/a11y ──

function readWorkSource(relative) {
  return readSource(`features/agent-sessions/work/${relative}`);
}

test('AC8: Level 2 timeline rows stay one line with truncation, no horizontal scroll', () => {
  const timelineSource = readWorkSource('work-timeline.tsx');
  assert.match(timelineSource, /min-w-0 flex-1 truncate/, 'row text must truncate, not wrap/overflow horizontally');
  assert.doesNotMatch(
    timelineSource,
    /overflow-x-auto|overflow-x-scroll/,
    'Level 2 must not introduce horizontal scrolling',
  );
});

test('AC8: Work Details opens as a Sheet (portal), never expanding the chat transcript vertically', () => {
  const detailsSource = readWorkSource('work-details-sheet.tsx');
  assert.match(
    detailsSource,
    /from '@\/shared\/ui\/sheet'/,
    'must reuse the shared Sheet primitive, not an inline expanding panel',
  );
  assert.match(
    detailsSource,
    /<SheetContent side="right"/,
    'reuses the same responsive side="right" variant as AgentSessionDetailsSheet (full width on mobile, max-w-md on desktop)',
  );
});

test('AC8: Level 2 never inlines full input/output/command — that stays exclusive to Work Details', () => {
  const timelineSource = readWorkSource('work-timeline.tsx');
  assert.doesNotMatch(
    timelineSource,
    /\.input\b|\.output\b|\.command\b/,
    'Level 2 rows must never render raw technical payloads inline',
  );
  const detailsSource = readWorkSource('work-details-sheet.tsx');
  assert.match(detailsSource, /item\.input/);
  assert.match(detailsSource, /item\.output/);
});

test('AC8: expand/collapse and Work Details triggers expose aria-expanded / are native buttons for keyboard/touch accessibility', () => {
  const indicatorSource = readWorkSource('work-indicator.tsx');
  const timelineSource = readWorkSource('work-timeline.tsx');
  assert.match(indicatorSource, /aria-expanded=\{expanded\}/);
  assert.match(
    indicatorSource,
    /type="button"/,
    'the Work indicator must be a native, keyboard/touch-accessible button',
  );
  assert.match(
    timelineSource,
    /type="button"/,
    'Level 2 timeline row triggers must be native, keyboard/touch-accessible buttons',
  );
});

test('AC13: Regression checks for all NFR-7 critical paths', () => {
  const composerSource = readSource('features/agent-sessions/composer/agent-session-composer.tsx');
  const agentSessionPageSource = readSource('features/agent-sessions/agent-session-page.tsx');
  const sessionDetailsSource = readSource('features/agent-sessions/agent-session-details.tsx');
  const headerSource = readSource('features/agent-sessions/agent-session-header.tsx');

  // 1. Send path
  assert.match(composerSource, /onClick=\{handleSend\}/);
  assert.match(agentSessionPageSource, /handleComposerSubmit/);

  // 2. Stop/cancel path
  assert.match(composerSource, /onCancel/);
  assert.match(agentSessionPageSource, /assistant\.cancelTurn\(\)/);

  // 3. Navigation path
  assert.match(headerSource, /onBack/);
  assert.match(agentSessionPageSource, /onBack=\{onBack\}/);

  // 4. Mode switching
  assert.match(composerSource, /onModeChange/);
  assert.match(agentSessionPageSource, /currentMode/);

  // 5. Delete session
  assert.match(sessionDetailsSource, /onDelete/);
  assert.match(agentSessionPageSource, /handleDeleteSession/);

  // 6. Raw tool inspection
  const detailsSheetSource = readSource('features/agent-sessions/work/work-details-sheet.tsx');
  assert.match(detailsSheetSource, /formatPayload/);

  // 7. Session/task/spec display
  assert.match(sessionDetailsSource, /specTitle/);
  assert.match(sessionDetailsSource, /tasks/);
});
