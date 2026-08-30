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
