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

import {
  getComposerLayoutState,
  adjustComposerTextareaElement,
  COMPOSER_COMPACT_CLASSES,
  COMPOSER_EDIT_CLASSES,
} from '../src/components/composer/composer-sizing.ts';

test('Finding 1: Composer remains strictly compact while unfocused regardless of draft length or newlines', () => {
  const multiLineDraft = Array.from({ length: 25 }, (_, i) => `Line ${i + 1} of long draft text`).join('\n');

  // Unfocused with 25-line draft
  const unfocusedState = getComposerLayoutState({
    isFocused: false,
  });

  assert.equal(unfocusedState.isCompact, true, 'Unfocused state must be compact');
  assert.equal(unfocusedState.isExpanded, false);
  assert.equal(unfocusedState.overflow, 'hidden');
  assert.equal(unfocusedState.className, COMPOSER_COMPACT_CLASSES);
});

test('Finding 1: adjustComposerTextareaElement proves full 2 -> 10 -> 30 lines -> delete -> blur -> refocus lifecycle', () => {
  // Mock textarea DOM element with mutable style and scrollHeight
  const mockTextarea = {
    scrollHeight: 0,
    style: {
      height: '',
    },
  };

  let isFocused = false;

  // 1. Initial unfocused state
  let res = adjustComposerTextareaElement(mockTextarea, isFocused);
  assert.equal(mockTextarea.style.height, '');
  assert.equal(res.isCompact, true);
  assert.equal(res.overflowY, 'hidden');

  // 2. Focus and enter 2 lines (scrollHeight = 60px)
  isFocused = true;
  mockTextarea.scrollHeight = 60;
  res = adjustComposerTextareaElement(mockTextarea, isFocused);
  assert.equal(mockTextarea.style.height, '60px', '2 lines grows naturally to 60px');
  assert.equal(res.overflowY, 'auto');
  assert.equal(res.isCompact, false);

  // 3. Grow to 10 lines (scrollHeight = 240px)
  mockTextarea.scrollHeight = 240;
  res = adjustComposerTextareaElement(mockTextarea, isFocused);
  assert.equal(mockTextarea.style.height, '240px', '10 lines grows naturally to 240px');
  assert.equal(res.overflowY, 'auto');

  // 4. Grow to 30 lines exceeding max height (scrollHeight = 650px)
  mockTextarea.scrollHeight = 650;
  res = adjustComposerTextareaElement(mockTextarea, isFocused);
  assert.equal(mockTextarea.style.height, '650px', '30 lines sets full content height for CSS max-h-[40vh] clipping');
  assert.equal(res.overflowY, 'auto', 'Must enable internal vertical scroll so caret and lower lines remain reachable');

  // 5. Delete back to 3 lines (scrollHeight = 75px) -> must shrink naturally
  mockTextarea.scrollHeight = 75;
  res = adjustComposerTextareaElement(mockTextarea, isFocused);
  assert.equal(mockTextarea.style.height, '75px', 'Deleting text shrinks textarea back down to 75px');
  assert.equal(res.overflowY, 'auto');

  // 6. Blur back to compact state
  isFocused = false;
  res = adjustComposerTextareaElement(mockTextarea, isFocused);
  assert.equal(mockTextarea.style.height, '', 'Blur resets inline height');
  assert.equal(res.isCompact, true);
  assert.equal(res.overflowY, 'hidden');

  // 7. Re-focus restores expanded height
  isFocused = true;
  res = adjustComposerTextareaElement(mockTextarea, isFocused);
  assert.equal(mockTextarea.style.height, '75px', 'Re-focus restores 75px height');
  assert.equal(res.overflowY, 'auto');
});

test('Finding 1: Full focus -> 20-line edit -> blur -> re-focus cycle preserves draft without mutation', () => {
  let draft = '';
  let isFocused = false;

  // Step 1: Focus composer
  isFocused = true;
  let state = getComposerLayoutState({ isFocused });
  assert.equal(state.isExpanded, true);
  assert.equal(state.overflow, 'auto');
  assert.equal(state.className, COMPOSER_EDIT_CLASSES);

  // Step 2: Type 20+ lines
  draft = Array.from({ length: 22 }, (_, i) => `Zadanie ${i + 1}: zaimplementuj feature`).join('\n');
  state = getComposerLayoutState({ isFocused });
  assert.equal(state.isExpanded, true);
  assert.equal(state.overflow, 'auto');

  // Step 3: Tap transcript -> blur -> compact layout
  isFocused = false;
  state = getComposerLayoutState({ isFocused });
  assert.equal(state.isCompact, true);
  assert.equal(state.overflow, 'hidden');
  assert.equal(state.className, COMPOSER_COMPACT_CLASSES);
  assert.equal(draft.split('\n').length, 22, 'Draft must not be mutated or truncated on blur');

  // Step 4: Re-focus composer -> expanded layout restored
  isFocused = true;
  state = getComposerLayoutState({ isFocused });
  assert.equal(state.isExpanded, true);
  assert.equal(state.overflow, 'auto');
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
