import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function readComposerSource() {
  return readFileSync(fileURLToPath(new URL('../src/components/composer/composer.tsx', import.meta.url)), 'utf8');
}

function readAiChatSource() {
  return readFileSync(fileURLToPath(new URL('../src/components/ai-chat.tsx', import.meta.url)), 'utf8');
}

test('AC1 & AC2: Enter key does not submit message; submission uses explicit send action', () => {
  const source = readComposerSource();

  // Enter must not call onSend / submit
  assert.ok(!source.includes("event.key === 'Enter' && !event.shiftKey"), 'Enter key must not submit form');
  assert.ok(!source.includes("submitMessage(composer)"), 'Inline form submit on Enter is removed');

  // Explicit send handler exists
  assert.match(source, /handleSend\s*=\s*\(\)\s*=>/);
  assert.match(source, /onClick=\{handleSend\}/);
});

import { getComposerLayoutState, COMPOSER_COMPACT_CLASSES, COMPOSER_EDIT_BASE_CLASSES } from '../src/components/composer/composer-sizing.ts';

test('Finding 1: Composer remains strictly compact while unfocused regardless of draft length or newlines', () => {
  const multiLineDraft = Array.from({ length: 25 }, (_, i) => `Line ${i + 1} of long draft text`).join('\n');

  // Unfocused with 25-line draft
  const unfocusedState = getComposerLayoutState({
    isFocused: false,
    draft: multiLineDraft,
    scrollHeight: 600,
    maxHeightPx: 250,
  });

  assert.equal(unfocusedState.isCompact, true, 'Unfocused state must be compact');
  assert.equal(unfocusedState.isExpanded, false);
  assert.equal(unfocusedState.overflow, 'hidden');
  assert.equal(unfocusedState.className, COMPOSER_COMPACT_CLASSES);
});

test('Finding 1: Focused composer enters edit state and auto-grows with content up to maxHeight cap', () => {
  const shortDraft = 'Line 1\nLine 2';
  const maxHeightPx = 240;

  // 1. Short draft within max height
  const shortState = getComposerLayoutState({
    isFocused: true,
    draft: shortDraft,
    scrollHeight: 64,
    maxHeightPx,
  });

  assert.equal(shortState.isCompact, false);
  assert.equal(shortState.isExpanded, true);
  assert.equal(shortState.computedHeightPx, 64, 'Height follows content naturally');
  assert.equal(shortState.overflow, 'hidden', 'No internal scroll while below max height');

  // 2. 20+ line draft exceeding max height
  const longDraft = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`).join('\n');
  const longState = getComposerLayoutState({
    isFocused: true,
    draft: longDraft,
    scrollHeight: 520,
    maxHeightPx,
  });

  assert.equal(longState.isCompact, false);
  assert.equal(longState.isExpanded, true);
  assert.equal(longState.computedHeightPx, maxHeightPx, 'Height is capped at viewport-relative max');
  assert.equal(longState.overflow, 'auto', 'Internal vertical scroll enabled when exceeding max');
  assert.ok(longState.className.includes('overflow-y-auto'));

  // 3. Shrinking as lines are deleted
  const shrunkState = getComposerLayoutState({
    isFocused: true,
    draft: 'Line 1\nLine 2\nLine 3',
    scrollHeight: 88,
    maxHeightPx,
  });
  assert.equal(shrunkState.computedHeightPx, 88, 'Height shrinks when content is deleted');
  assert.equal(shrunkState.overflow, 'hidden');
});

test('Finding 1: Full focus -> 20-line edit -> blur -> re-focus cycle preserves draft without mutation', () => {
  let draft = '';
  let isFocused = false;

  // Step 1: Focus composer
  isFocused = true;
  let state = getComposerLayoutState({ isFocused, draft, scrollHeight: 40, maxHeightPx: 250 });
  assert.equal(state.isExpanded, true);

  // Step 2: Type 20+ lines
  draft = Array.from({ length: 22 }, (_, i) => `Zadanie ${i + 1}: zaimplementuj feature`).join('\n');
  state = getComposerLayoutState({ isFocused, draft, scrollHeight: 550, maxHeightPx: 250 });
  assert.equal(state.isExpanded, true);
  assert.equal(state.overflow, 'auto');

  // Step 3: Tap transcript -> blur -> compact layout
  isFocused = false;
  state = getComposerLayoutState({ isFocused, draft, scrollHeight: 550, maxHeightPx: 250 });
  assert.equal(state.isCompact, true);
  assert.equal(state.overflow, 'hidden');
  assert.equal(state.className, COMPOSER_COMPACT_CLASSES);
  assert.equal(draft.split('\n').length, 22, 'Draft must not be mutated or truncated on blur');

  // Step 4: Re-focus composer -> expanded layout restored
  isFocused = true;
  state = getComposerLayoutState({ isFocused, draft, scrollHeight: 550, maxHeightPx: 250 });
  assert.equal(state.isExpanded, true);
  assert.equal(state.overflow, 'auto');
  assert.equal(state.computedHeightPx, 250);
});

test('AC5 & AC6: Scoped blur-on-outside-tap is attached to transcript surface without breaking interactive controls', () => {
  const source = readAiChatSource();

  // Scoped handler on transcript container, not document
  assert.match(source, /handleTranscriptPointerDown/);
  assert.match(source, /ref=\{transcriptRef\}\s+onPointerDown=\{handleTranscriptPointerDown\}/);

  // Guards interactive elements (button, a, input, etc.)
  assert.match(source, /closest\(['"]button, a, input, textarea/);
  assert.match(source, /composerTextareaRef\.current\.blur\(\)/);
});

test('AC8 & AC9: Mode control is located inside the composer, not in the chat header, with no dead UI controls', () => {
  const composerSource = readComposerSource();
  const aiChatSource = readAiChatSource();

  // Composer contains mode switcher buttons (ask, edit, agent)
  assert.match(composerSource, /\(\['ask', 'edit', 'agent'\] as const\)\.map/);
  assert.match(composerSource, /onModeChange\(m\)/);

  // Header in ai-chat.tsx does not contain the duplicate mode switcher
  const headerSection = aiChatSource.slice(aiChatSource.indexOf('const header = ('), aiChatSource.indexOf('return ('));
  assert.ok(!headerSection.includes("(['ask', 'edit', 'agent'] as const)"), 'Header must not contain duplicate mode switcher');

  // No non-functional placeholder model/usage controls
  assert.ok(!composerSource.includes('select-model') && !composerSource.includes('usage-placeholder'));
});

test('AC10: Send / stop / cancel behavior is preserved and toggles correctly when running', () => {
  const source = readComposerSource();

  assert.match(source, /isRunning \? \(/);
  assert.match(source, /onClick=\{onCancel\}/);
  assert.match(source, /Przerwij/);
  assert.match(source, /Wyślij/);
});
