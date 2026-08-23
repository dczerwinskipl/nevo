import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function readChatHeaderSource() {
  return readFileSync(fileURLToPath(new URL('../src/components/chat-header/chat-header.tsx', import.meta.url)), 'utf8');
}

function readAiChatSource() {
  return readFileSync(fileURLToPath(new URL('../src/components/ai-chat.tsx', import.meta.url)), 'utf8');
}

test('Task 05 / Issue 4: ChatHeader component contains only essentials (back, title, compact status, details)', () => {
  const source = readChatHeaderSource();

  // Navigation (back button)
  assert.match(source, /onClick=\{onBack\}/);
  assert.match(source, /ArrowLeft/);

  // Title
  assert.match(source, /\{title\}/);

  // Compact status badge
  assert.match(source, /\{status\}/);

  // Session details entry point (Info button)
  assert.match(source, /onClick=\{onOpenDetails\}/);
  assert.match(source, /Info/);

  // Stop/Cancel is NOT in the header — primary cancel affordance lives in ChatComposer
  assert.doesNotMatch(source, /CircleStop/);
  assert.doesNotMatch(source, /Przerwij/);
  assert.doesNotMatch(source, /onCancel/);
});

test('Task 05: ChatHeader does NOT include removed controls (mode switcher, delete, dead UI, metadata subtitle)', () => {
  const headerSource = readChatHeaderSource();

  // Mode switcher must not be present in the header
  assert.doesNotMatch(headerSource, /onModeChange/);
  assert.doesNotMatch(headerSource, /AgentExecutionMode/);
  assert.doesNotMatch(headerSource, /Tryb/);

  // Delete button must not be present in the header (moved to Session details)
  assert.doesNotMatch(headerSource, /handleDeleteSession/);
  assert.doesNotMatch(headerSource, /Trash2/);
  assert.doesNotMatch(headerSource, /Usuń sesję/);

  // No dead model/usage UI
  assert.doesNotMatch(headerSource, /tokens/i);
  assert.doesNotMatch(headerSource, /usage/i);
  assert.doesNotMatch(headerSource, /modelSelector/i);

  // No multiline metadata subtitle in ChatHeader
  assert.doesNotMatch(headerSource, /cała specyfikacja/);
});

test('Task 05: AiChatPage delegates header rendering to ChatHeader and controls SessionDetails Sheet', () => {
  const chatSource = readAiChatSource();

  // Imports and renders ChatHeader
  assert.match(chatSource, /import \{ ChatHeader \} from '@/);
  assert.match(chatSource, /<ChatHeader/);

  // Details sheet trigger opens SessionDetails
  assert.match(chatSource, /onOpenDetails=\{/);
  assert.match(chatSource, /<SessionDetails/);
  assert.match(chatSource, /<Sheet open=\{isSessionDetailsOpen\}/);

  // Header in AiChatPage has no inline Trash or mode switcher
  assert.doesNotMatch(chatSource, /Trash2/);
});
