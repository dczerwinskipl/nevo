import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { calculateDistanceFromBottom, isScrolledNearBottom } from '../src/lib/use-scroll-follow.ts';

function readAiChatSource() {
  return readFileSync(fileURLToPath(new URL('../src/components/ai-chat.tsx', import.meta.url)), 'utf8');
}

function readUseScrollFollowSource() {
  return readFileSync(fileURLToPath(new URL('../src/lib/use-scroll-follow.ts', import.meta.url)), 'utf8');
}

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

test('Task 08: AiChatPage has NO unconditional per-event scroll and renders new-content affordance', () => {
  const chatSource = readAiChatSource();

  // Uses useScrollFollow
  assert.match(chatSource, /useScrollFollow/);

  // No unconditional useEffect with transcriptRef.current?.scrollTo on every message
  assert.doesNotMatch(chatSource, /useEffect\(\(\) => \{\s*transcriptRef\.current\?\.scrollTo/);

  // Renders new content affordance when paused with unseen content
  assert.match(chatSource, /hasUnseenContent && !isFollowing/);
  assert.match(chatSource, /Nowe wiadomości/);
  assert.match(chatSource, /scrollToBottom\('smooth'\)/);
});
