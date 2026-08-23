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

test('AC3 & AC4: Composer supports compact state when unfocused and expanded edit state on focus with overflow scroll', () => {
  const source = readComposerSource();

  // Has focused state tracking
  assert.match(source, /const \[isFocused, setIsFocused\] = useState\(false\)/);
  assert.match(source, /onFocus=\{\(\) => setIsFocused\(true\)\}/);
  assert.match(source, /onBlur=\{\(\) => setIsFocused\(false\)\}/);

  // Expanded edit mode class names with max-height and internal scroll
  assert.match(source, /max-h-\[40vh\] overflow-y-auto/);
  assert.match(source, /min-h-11 max-h-12 overflow-hidden/);
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
