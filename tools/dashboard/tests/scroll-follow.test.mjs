import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  calculateDistanceFromBottom,
  isScrolledNearBottom,
  createInitialScrollState,
  handleScrollEvent,
  handleContentArrival,
  handleUserReturnToBottom,
} from '../src/lib/use-scroll-follow.ts';

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

test('Task 08 / Issue 1: State machine ensures upward scroll immediately pauses follow even within threshold', () => {
  // 1. Initial state: following = true
  let state = createInitialScrollState();
  assert.equal(state.isFollowing, true);

  // 2. User moves wheel/touch upward: isScrollingUp = true, distanceFromBottom = 20px (<= threshold 80px)
  // Crucial fix: user intent to scroll UP must pause follow immediately rather than snapping back
  state = handleScrollEvent(state, true, true, 20);
  assert.equal(state.isFollowing, false, 'Upward scroll pauses follow even within threshold');

  // 3. New token/tool arrives while user is browsing history
  const contentArrival = handleContentArrival(state);
  state = contentArrival.state;
  assert.equal(contentArrival.shouldScrollToBottom, false, 'Does NOT scroll when browsing history');
  assert.equal(state.hasUnseenContent, true, 'Flags unseen content badge');

  // 4. User scrolls back down to bottom: isNearBottom = true, isScrollingUp = false, distanceFromBottom = 0
  state = handleScrollEvent(state, true, false, 0);
  assert.equal(state.isFollowing, true, 'Resumes follow upon reaching bottom downwards');
  assert.equal(state.hasUnseenContent, false);
});

test('Task 08 / Issue 1: State machine ensures programmatic smooth return does not self-cancel', () => {
  let state = createInitialScrollState();

  // User scrolls upward away from bottom
  state = handleScrollEvent(state, false, true, 300);
  assert.equal(state.isFollowing, false);

  // User clicks "Nowe wiadomości" -> initiate smooth return to bottom
  const returnAction = handleUserReturnToBottom(state, true);
  state = returnAction.state;
  assert.equal(returnAction.behavior, 'smooth');
  assert.equal(state.isFollowing, true, 'isFollowing immediately resumes');
  assert.equal(state.hasUnseenContent, false);
  assert.equal(state.isProgrammaticScroll, true);

  // Smooth animation fires intermediate scroll events where isNearBottom is still FALSE (e.g. 200px away)
  state = handleScrollEvent(state, false, false, 200);
  assert.equal(state.isFollowing, true, 'Intermediate animation scroll event does NOT disable follow');
  assert.equal(state.isProgrammaticScroll, true);

  // Smooth animation finishes at bottom (distanceFromBottom <= 10)
  state = handleScrollEvent(state, true, false, 0);
  assert.equal(state.isFollowing, true);
  assert.equal(state.isProgrammaticScroll, false, 'programmatic lock released on bottom reach');

  // Subsequent streamed tokens continue following
  const step = handleContentArrival(state);
  state = step.state;
  assert.equal(step.shouldScrollToBottom, true, 'Subsequent streamed content continues following');
  assert.equal(state.hasUnseenContent, false);
});

test('Task 08 / Issue 1: useScrollFollow recognizes user gesture directions and auto positioning', () => {
  const source = readUseScrollFollowSource();

  // Streaming follow uses immediate 'auto' positioning to prevent animation races
  assert.match(source, /behavior:\s*'auto'/);

  // Programmatic scroll lock is tracked
  assert.match(source, /isProgrammaticScrollRef/);

  // Direction-aware gesture listeners for wheel and touch
  assert.match(source, /deltaY\s*<\s*0/);
  assert.match(source, /touchmove/);
  assert.match(source, /isScrollingUp/);
});

test('Task 08 / Issue 3: AiChatPage uses assistant.contentRevision and renders new-content affordance', () => {
  const chatSource = readAiChatSource();

  // Uses useScrollFollow with contentKey linked to contentRevision
  assert.match(chatSource, /useScrollFollow/);
  assert.match(chatSource, /contentKey:\s*scrollContentKey/);
  assert.match(chatSource, /assistant\.contentRevision/);

  // Keyboard open auto-scroll is guarded with isFollowing
  assert.match(chatSource, /!chatViewport\.keyboardOpen\s*\|\|\s*!isFollowing/);

  // Renders new content affordance when paused with unseen content
  assert.match(chatSource, /hasUnseenContent && !isFollowing/);
  assert.match(chatSource, /Nowe wiadomości/);
  assert.match(chatSource, /scrollToBottom\('smooth'\)/);
});
