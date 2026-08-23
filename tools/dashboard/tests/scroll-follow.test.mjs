import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { calculateDistanceFromBottom, isScrolledNearBottom, computeTranscriptContentKey } from '../src/lib/use-scroll-follow.ts';

function readAiChatSource() {
  return readFileSync(fileURLToPath(new URL('../src/components/ai-chat.tsx', import.meta.url)), 'utf8');
}

function readUseScrollFollowSource() {
  return readFileSync(fileURLToPath(new URL('../src/lib/use-scroll-follow.ts', import.meta.url)), 'utf8');
}

test('Task 08 / Issue 3: computeTranscriptContentKey produces stable keys for unrelated rerenders and reacts to real content', () => {
  const initialMessages = [
    {
      id: 'm1',
      role: 'user',
      text: 'Hello',
      createdAt: '2026-08-23T12:00:00.000Z',
    },
  ];

  const key1 = computeTranscriptContentKey(initialMessages, null, null);
  assert.ok(typeof key1 === 'string' && key1.length > 0);

  // Unrelated rerenders (same messages, same interaction, same error) yield identical key
  const key1Clone = computeTranscriptContentKey(initialMessages, null, null);
  assert.equal(key1Clone, key1, 'Identical message state produces exact same key');

  // Adding a new assistant message changes the key
  const messagesWithAssistant = [
    ...initialMessages,
    {
      id: 'm2',
      role: 'assistant',
      text: 'Hi there',
      createdAt: '2026-08-23T12:00:01.000Z',
    },
  ];
  const key2 = computeTranscriptContentKey(messagesWithAssistant, null, null);
  assert.notEqual(key2, key1, 'New message changes content key');

  // Streaming text delta into assistant message changes key
  const messagesStreamed = [
    initialMessages[0],
    {
      id: 'm2',
      role: 'assistant',
      text: 'Hi there, how can I help?',
      createdAt: '2026-08-23T12:00:01.000Z',
    },
  ];
  const key3 = computeTranscriptContentKey(messagesStreamed, null, null);
  assert.notEqual(key3, key2, 'Streaming text delta changes content key');

  // Adding a tool call changes key
  const messagesWithTool = [
    initialMessages[0],
    {
      id: 'm2',
      role: 'assistant',
      text: 'Hi there, how can I help?',
      toolCalls: [{ id: 'tc1', name: 'read_file', input: {}, status: 'running' }],
      createdAt: '2026-08-23T12:00:01.000Z',
    },
  ];
  const key4 = computeTranscriptContentKey(messagesWithTool, null, null);
  assert.notEqual(key4, key3, 'Tool call addition changes content key');

  // Updating tool call status changes key
  const messagesWithToolCompleted = [
    initialMessages[0],
    {
      id: 'm2',
      role: 'assistant',
      text: 'Hi there, how can I help?',
      toolCalls: [{ id: 'tc1', name: 'read_file', input: {}, status: 'completed', durationMs: 150 }],
      createdAt: '2026-08-23T12:00:01.000Z',
    },
  ];
  const key5 = computeTranscriptContentKey(messagesWithToolCompleted, null, null);
  assert.notEqual(key5, key4, 'Tool call completion changes content key');

  // Pending interaction changes key
  const key6 = computeTranscriptContentKey(messagesWithToolCompleted, 'interaction-1', null);
  assert.notEqual(key6, key5, 'Pending interaction requested changes content key');

  // Submission error changes key
  const key7 = computeTranscriptContentKey(messagesWithToolCompleted, null, 'Network failure');
  assert.notEqual(key7, key5, 'Submission error changes content key');
});

test('Task 08: calculateDistanceFromBottom accurately calculates scroll distance from bottom', () => {
  // Exactly at bottom
  assert.equal(calculateDistanceFromBottom({ scrollHeight: 1000, scrollTop: 600, clientHeight: 400 }), 0);

  // Near bottom (50px away)
  assert.equal(calculateDistanceFromBottom({ scrollHeight: 1000, scrollTop: 550, clientHeight: 400 }), 50);

  // Scrolled far up (400px away)
  assert.equal(calculateDistanceFromBottom({ scrollHeight: 1000, scrollTop: 200, clientHeight: 400 }), 400);

  // Overscroll / clamped at 0
  assert.equal(calculateDistanceFromBottom({ scrollHeight: 1000, scrollTop: 700, clientHeight: 400 }), 0);
});

test('Task 08: isScrolledNearBottom respects threshold for follow detection', () => {
  const threshold = 80;

  // At bottom
  assert.equal(isScrolledNearBottom({ scrollHeight: 1000, scrollTop: 600, clientHeight: 400 }, threshold), true);

  // Within threshold (40px away)
  assert.equal(isScrolledNearBottom({ scrollHeight: 1000, scrollTop: 560, clientHeight: 400 }, threshold), true);

  // Exactly at threshold (80px away)
  assert.equal(isScrolledNearBottom({ scrollHeight: 1000, scrollTop: 520, clientHeight: 400 }, threshold), true);

  // Just past threshold (81px away)
  assert.equal(isScrolledNearBottom({ scrollHeight: 1000, scrollTop: 519, clientHeight: 400 }, threshold), false);

  // Far up (300px away)
  assert.equal(isScrolledNearBottom({ scrollHeight: 1000, scrollTop: 300, clientHeight: 400 }, threshold), false);
});

test('Task 08: useScrollFollow manages following, paused, and unseen content state transitions', () => {
  const source = readUseScrollFollowSource();

  // Tracks isFollowing and hasUnseenContent states
  assert.match(source, /isFollowing/);
  assert.match(source, /hasUnseenContent/);

  // Auto-scrolls when isFollowing is true
  assert.match(source, /isFollowingRef\.current/);
  assert.match(source, /scrollTo\(\{ top: el\.scrollHeight/);

  // Sets hasUnseenContent when paused and new content arrives
  assert.match(source, /setHasUnseenContent\(true\)/);

  // scrollToBottom clears hasUnseenContent and resumes isFollowing
  assert.match(source, /setHasUnseenContent\(false\)/);
  assert.match(source, /setIsFollowing\(true\)/);
});

test('Task 08 / Issue 3: AiChatPage uses stable memoized contentKey and renders new-content affordance', () => {
  const chatSource = readAiChatSource();

  // Uses useScrollFollow with contentKey
  assert.match(chatSource, /useScrollFollow/);
  assert.match(chatSource, /contentKey:\s*transcriptContentKey/);
  assert.match(chatSource, /computeTranscriptContentKey/);

  // No inline array recreation in useScrollFollow call
  assert.doesNotMatch(chatSource, /contentSignal:\s*\[/);

  // Renders new content affordance when paused with unseen content
  assert.match(chatSource, /hasUnseenContent && !isFollowing/);
  assert.match(chatSource, /Nowe wiadomości/);
  assert.match(chatSource, /scrollToBottom\('smooth'\)/);
});
