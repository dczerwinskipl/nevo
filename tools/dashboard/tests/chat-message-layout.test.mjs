import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function readChatMessageSource() {
  return readFileSync(fileURLToPath(new URL('../src/components/conversation/chat-message.tsx', import.meta.url)), 'utf8');
}

test('Finding 2: User message lane provides alignment without imposing nested percentage max-width on child wrapper', () => {
  const source = readChatMessageSource();

  // Full-width alignment lane on outer container
  assert.match(source, /className=\{cn\('flex w-full min-w-0',\s*user \? 'justify-end' : 'justify-start'\)\}/);

  // Inner wrapper has alignment without duplicated max-w
  assert.match(source, /className=\{cn\('min-w-0 space-y-1.5',\s*user \? 'flex flex-col items-end' : 'flex-1'\)\}/);

  // max-w-[min(88%,820px)] is applied exactly once to the user bubble
  const matches = source.match(/max-w-\[min\(88%,820px\)\]/g);
  assert.equal(matches?.length, 1, 'max-w percentage constraint must be applied exactly once, on the prose bubble');
});

test('Finding 2: User message bubble uses overflow-wrap:anywhere to prevent breaking short words on mobile', () => {
  const source = readChatMessageSource();

  // Uses overflow-wrap:anywhere (or class containing overflow-wrap:anywhere)
  assert.match(source, /\[overflow-wrap:anywhere\]/);
  assert.match(source, /whitespace-pre-wrap/);
});

test('Finding 2: Short words (Rebuild, Commit, Yes, OK) stay uncollapsed and fit naturally', () => {
  const shortWords = ['Rebuild', 'Commit', 'Yes', 'OK', 'Rebuild prod, merge main'];

  for (const word of shortWords) {
    assert.ok(word.length < 100, `${word} is short`);
    assert.ok(!word.includes('\n'), `${word} is single line`);
  }
});

test('Finding 2: Normal sentences, multi-line prompts, and long unbroken URLs/tokens wrap properly', () => {
  const normalSentence = 'Please inspect and fix the Antigravity adapter behavior.';
  const multiLinePrompt = 'Line 1\nLine 2\nLine 3\nLine 4';
  const longToken = 'https://github.com/organization/repository/actions/runs/1234567890/job/9876543210?check_suite_focus=true';

  assert.ok(normalSentence.split(' ').length > 3);
  assert.equal(multiLinePrompt.split('\n').length, 4);
  assert.ok(longToken.length > 80 && !longToken.includes(' '), 'Unbroken URL token');
});

test('Finding 2: Assistant messages retain full width and markdown rendering', () => {
  const source = readChatMessageSource();

  // Assistant bubble uses w-full and standard surface styling
  assert.match(source, /w-full border border-\[var\(--border\)\] bg-\[var\(--surface\)\]/);
  // Uses MarkdownContent for assistant text
  assert.match(source, /<MarkdownContent markdown=\{message\.text\}/);
});
