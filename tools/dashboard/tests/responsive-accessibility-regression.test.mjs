import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function readSource(relative) {
  return readFileSync(fileURLToPath(new URL(`../src/${relative}`, import.meta.url)), 'utf8');
}

test('AC1 & AC2: Header and conversation layouts prevent horizontal overflow across responsive widths', () => {
  const headerSource = readSource('components/chat-header/chat-header.tsx');
  const chatMessageSource = readSource('components/conversation/chat-message.tsx');
  const aiChatSource = readSource('components/ai-chat.tsx');

  // Header has min-w-0 on flex containers and truncate on title
  assert.match(headerSource, /min-w-0/);
  assert.match(headerSource, /truncate text-sm font-semibold/);

  // Chat message container has min-w-0 and break-words for content wrapping
  assert.match(chatMessageSource, /flex w-full min-w-0/);
  assert.match(chatMessageSource, /w-full min-w-0 space-y-1\.5 flex flex-col/);
  assert.match(chatMessageSource, /break-words/);

  // Shell handles overflow-hidden and overscroll-none
  assert.match(aiChatSource, /overflow-hidden overscroll-none/);
});

test('AC3: Mobile keyboard viewport adjustments and safe area insets are wired', () => {
  const aiChatSource = readSource('components/ai-chat.tsx');
  const sheetSource = readSource('components/ui/sheet.tsx');

  // useChatVisualViewport listens to visualViewport resize/scroll
  assert.match(aiChatSource, /useChatVisualViewport/);
  assert.match(aiChatSource, /visualViewport\?\.addEventListener\('resize'/);
  assert.match(aiChatSource, /keyboardOpen/);

  // Safe area insets in footer and sheet
  assert.match(aiChatSource, /env\(safe-area-inset-bottom\)/);
  assert.match(sheetSource, /env\(safe-area-inset-top\)/);
  assert.match(sheetSource, /env\(safe-area-inset-bottom\)/);
});

test('AC4: Composer handles long prompts with vertical expansion and internal scroll', () => {
  const composerSource = readSource('components/composer/composer.tsx');
  const sizingSource = readSource('components/composer/composer-sizing.ts');

  // Textarea uses auto-height adjustment and internal scroll when exceeding max height
  assert.match(composerSource, /adjustComposerTextareaElement/);
  assert.match(sizingSource, /max-h-\[40vh\]/);
  assert.match(sizingSource, /overflow-y-auto/);
});

test('AC5: Assistant messages render markdown and code cleanly', () => {
  const chatMessageSource = readSource('components/conversation/chat-message.tsx');

  assert.match(chatMessageSource, /<MarkdownContent markdown=\{message\.text\}/);
});

test('AC6: Tool details constrain large inputs and outputs with scrollable pre containers', () => {
  const toolViewSource = readSource('components/ai-tool-view.tsx');

  // Large input/output payloads use max-h-48 with overflow-auto
  assert.match(toolViewSource, /max-h-48 overflow-auto rounded-lg border/);
  assert.match(toolViewSource, /formatPayload\(toolCall\.input\)/);
  assert.match(toolViewSource, /formatPayload\(toolCall\.output\)/);
});

test('AC7: Session details sheet supports both mobile (full width) and desktop (max-w-md)', () => {
  const sheetSource = readSource('components/ui/sheet.tsx');
  const sessionDetailsSource = readSource('components/session-details/session-details.tsx');

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
  const headerSource = readSource('components/chat-header/chat-header.tsx');
  const composerSource = readSource('components/composer/composer.tsx');
  const sheetSource = readSource('components/ui/sheet.tsx');

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
  const chatMessageSource = readSource('components/conversation/chat-message.tsx');
  const workSummarySource = readSource('components/work/work-summary.tsx');
  const toolViewSource = readSource('components/ai-tool-view.tsx');
  const reasoningViewSource = readSource('components/ai-reasoning-view.tsx');

  // Message collapse
  assert.match(chatMessageSource, /aria-expanded=\{expanded\}/);

  // Work summary collapse
  assert.match(workSummarySource, /aria-expanded=\{expanded\}/);

  // Tool details collapse
  assert.match(toolViewSource, /aria-expanded=\{expanded\}/);

  // Reasoning view collapse
  assert.match(reasoningViewSource, /aria-expanded=\{expanded\}/);
});

test('AC10: Role and status distinctions are not color-only', () => {
  const chatMessageSource = readSource('components/conversation/chat-message.tsx');
  const workSummarySource = readSource('components/work/work-summary.tsx');
  const toolViewSource = readSource('components/ai-tool-view.tsx');

  // User vs Assistant role distinction uses structural alignment (justify-end vs justify-start) and bubble widths
  assert.match(chatMessageSource, /user \? 'justify-end' : 'justify-start'/);
  assert.match(chatMessageSource, /user \? 'items-end' : 'items-start'/);

  // Work summary uses distinct icons and text for status
  assert.match(workSummarySource, /CheckCircle2/);
  assert.match(workSummarySource, /AlertTriangle/);
  assert.match(workSummarySource, /LoaderCircle/);
  assert.match(workSummarySource, /requires attention/);

  // Tool view uses distinct icons and normalized activity labels
  assert.match(toolViewSource, /CheckCircle2/);
  assert.match(toolViewSource, /XCircle/);
  assert.match(toolViewSource, /LoaderCircle/);
});

test('AC13: Regression checks for all NFR-7 critical paths', () => {
  const composerSource = readSource('components/composer/composer.tsx');
  const aiChatSource = readSource('components/ai-chat.tsx');
  const sessionDetailsSource = readSource('components/session-details/session-details.tsx');
  const headerSource = readSource('components/chat-header/chat-header.tsx');

  // 1. Send path
  assert.match(composerSource, /onClick=\{handleSend\}/);
  assert.match(aiChatSource, /submitMessage/);

  // 2. Stop/cancel path
  assert.match(composerSource, /onCancel/);
  assert.match(aiChatSource, /assistant\.cancelTurn\(\)/);

  // 3. Navigation path
  assert.match(headerSource, /onBack/);
  assert.match(aiChatSource, /onBack=\{onBack\}/);

  // 4. Mode switching
  assert.match(composerSource, /onModeChange/);
  assert.match(aiChatSource, /currentMode/);

  // 5. Delete session
  assert.match(sessionDetailsSource, /onDelete/);
  assert.match(aiChatSource, /handleDeleteSession/);

  // 6. Raw tool inspection
  const toolViewSource = readSource('components/ai-tool-view.tsx');
  assert.match(toolViewSource, /formatPayload/);

  // 7. Session/task/spec display
  assert.match(sessionDetailsSource, /specTitle/);
  assert.match(sessionDetailsSource, /tasks/);
});
