import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  calculateMaxScrollTop,
  calculateDistanceFromBottom,
  isScrolledNearBottom,
  createInitialScrollControllerState,
  handleProgrammaticScroll,
  handleContentArrival,
  handleUserReturnToBottom,
  handleUserUpwardGesture,
  handleScrollEvent,
} from '../src/lib/use-scroll-follow.ts';

function readAiChatSource() {
  return readFileSync(fileURLToPath(new URL('../src/components/ai-chat.tsx', import.meta.url)), 'utf8');
}

function readUseScrollFollowSource() {
  return readFileSync(fileURLToPath(new URL('../src/lib/use-scroll-follow.ts', import.meta.url)), 'utf8');
}

test('Task 08: calculateMaxScrollTop correctly determines maximum scrollTop in viewport coordinate system', () => {
  assert.equal(calculateMaxScrollTop({ scrollHeight: 3000, clientHeight: 700 }), 2300);
  assert.equal(calculateMaxScrollTop({ scrollHeight: 500, clientHeight: 700 }), 0);
  assert.equal(calculateMaxScrollTop({ scrollHeight: 700, clientHeight: 700 }), 0);
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

test('Task 08 / Regression 40553af: Programmatic follow-to-bottom does NOT store scrollHeight as lastScrollTop', () => {
  // Scenario from user bug report:
  // scrollHeight = 3000, clientHeight = 700, actual bottom scrollTop = 2300
  const el = { scrollHeight: 3000, clientHeight: 700 };
  const targetScrollTop = calculateMaxScrollTop(el);
  assert.equal(targetScrollTop, 2300, 'Target scrollTop is in the valid [0, maxScrollTop] coordinate system');

  let state = createInitialScrollControllerState(0);
  assert.equal(state.isFollowing, true);

  // Programmatic scroll executes
  state = handleProgrammaticScroll(state, targetScrollTop);
  assert.equal(state.lastScrollTop, 2300);
  assert.equal(state.isProgrammaticScroll, false, 'Auto programmatic scroll does not hold a programmatic lock');

  // DOM scroll event reports scrollTop = 2300
  state = handleScrollEvent(state, { scrollTop: 2300, scrollHeight: 3000, clientHeight: 700 }, 80);

  // Must remain following=true, unseen=false
  assert.equal(state.isFollowing, true, 'Following remains true after programmatic scroll to bottom');
  assert.equal(state.hasUnseenContent, false, 'Unseen content remains false');
  assert.equal(state.isProgrammaticScroll, false, 'Programmatic lock remains false');
});

test('Task 08: Continuous streaming maintains follow without flipping isFollowing or creating false unseen state', () => {
  let state = createInitialScrollControllerState(0);

  // Content revision 1
  const step1 = handleContentArrival(state);
  assert.equal(step1.shouldScrollToBottom, true);
  state = handleProgrammaticScroll(step1.state, calculateMaxScrollTop({ scrollHeight: 1000, clientHeight: 500 }));
  state = handleScrollEvent(state, { scrollTop: 500, scrollHeight: 1000, clientHeight: 500 });
  assert.equal(state.isFollowing, true);
  assert.equal(state.hasUnseenContent, false);

  // Content revision 2 (streamed tokens increase height to 1500)
  const step2 = handleContentArrival(state);
  assert.equal(step2.shouldScrollToBottom, true);
  state = handleProgrammaticScroll(step2.state, calculateMaxScrollTop({ scrollHeight: 1500, clientHeight: 500 }));
  state = handleScrollEvent(state, { scrollTop: 1000, scrollHeight: 1500, clientHeight: 500 });
  assert.equal(state.isFollowing, true);
  assert.equal(state.hasUnseenContent, false);

  // Content revision 3 (more tokens increase height to 2200)
  const step3 = handleContentArrival(state);
  assert.equal(step3.shouldScrollToBottom, true);
  state = handleProgrammaticScroll(step3.state, calculateMaxScrollTop({ scrollHeight: 2200, clientHeight: 500 }));
  state = handleScrollEvent(state, { scrollTop: 1700, scrollHeight: 2200, clientHeight: 500 });
  assert.equal(state.isFollowing, true);
  assert.equal(state.hasUnseenContent, false);
});

test('Task 08: User upward scroll pauses follow, keeps viewport fixed, and sets unseen content flag', () => {
  // Viewport at bottom (scrollTop=1700, scrollHeight=2200, clientHeight=500)
  let state = createInitialScrollControllerState(1700);

  // User initiates upward gesture / scroll
  state = handleUserUpwardGesture(state);
  assert.equal(state.isFollowing, false);

  // DOM scroll event reports user moved up to scrollTop=1000 (distanceFromBottom=700)
  state = handleScrollEvent(state, { scrollTop: 1000, scrollHeight: 2200, clientHeight: 500 });
  assert.equal(state.isFollowing, false);

  // New content arrives while user is browsing history
  const contentArrival = handleContentArrival(state);
  state = contentArrival.state;
  assert.equal(contentArrival.shouldScrollToBottom, false, 'Does NOT move viewport');
  assert.equal(state.hasUnseenContent, true, 'Flags unseen content badge');
});

test('Task 08: Activating "Nowe wiadomości" returns to bottom and reliably restores auto-follow', () => {
  // User is scrolled up with unseen content
  let state = {
    isFollowing: false,
    hasUnseenContent: true,
    isProgrammaticScroll: false,
    lastScrollTop: 1000,
  };

  // User clicks "Nowe wiadomości"
  const targetScrollTop = calculateMaxScrollTop({ scrollHeight: 3000, clientHeight: 500 });
  const returnAction = handleUserReturnToBottom(state, targetScrollTop, true);
  state = returnAction.state;
  assert.equal(returnAction.behavior, 'smooth');
  assert.equal(state.isFollowing, true);
  assert.equal(state.hasUnseenContent, false);
  assert.equal(state.isProgrammaticScroll, true);

  // Smooth animation intermediate frame (scrollTop=1800, distanceFromBottom=700)
  state = handleScrollEvent(state, { scrollTop: 1800, scrollHeight: 3000, clientHeight: 500 });
  assert.equal(state.isFollowing, true, 'Intermediate animation frames do NOT disable follow');
  assert.equal(state.isProgrammaticScroll, true);

  // Animation reaches bottom (scrollTop=2500, distanceFromBottom=0)
  state = handleScrollEvent(state, { scrollTop: 2500, scrollHeight: 3000, clientHeight: 500 });
  assert.equal(state.isFollowing, true);
  assert.equal(state.hasUnseenContent, false);
  assert.equal(state.isProgrammaticScroll, false, 'Programmatic lock released at bottom');

  // Next streamed content continues following automatically
  const nextArrival = handleContentArrival(state);
  state = nextArrival.state;
  assert.equal(nextArrival.shouldScrollToBottom, true);
});

test('Task 08: Natural downward movement to bottom threshold resumes follow', () => {
  let state = {
    isFollowing: false,
    hasUnseenContent: true,
    isProgrammaticScroll: false,
    lastScrollTop: 1000,
  };

  // User scrolls down to scrollTop=2450 (distanceFromBottom = 3000 - 2450 - 500 = 50px <= threshold 80px)
  state = handleScrollEvent(state, { scrollTop: 2450, scrollHeight: 3000, clientHeight: 500 });
  assert.equal(state.isFollowing, true, 'Reaching bottom threshold restores follow');
  assert.equal(state.hasUnseenContent, false, 'Unseen content cleared on reaching bottom');
});

test('Task 08: Production hook implementation uses calculateMaxScrollTop and unified state machine', () => {
  const source = readUseScrollFollowSource();
  assert.match(source, /calculateMaxScrollTop/);
  assert.match(source, /handleProgrammaticScroll/);
  assert.match(source, /handleContentArrival/);
  assert.match(source, /handleUserReturnToBottom/);
  assert.match(source, /handleUserUpwardGesture/);
  assert.match(source, /handleScrollEvent/);
});

test('Task 08: AiChatPage uses assistant.contentRevision and renders new-content affordance', () => {
  const chatSource = readAiChatSource();
  assert.match(chatSource, /useScrollFollow/);
  assert.match(chatSource, /contentKey:\s*scrollContentKey/);
  assert.match(chatSource, /assistant\.contentRevision/);
  assert.match(chatSource, /hasUnseenContent && !isFollowing/);
  assert.match(chatSource, /Nowe wiadomości/);
  assert.match(chatSource, /scrollToBottom\('smooth'\)/);
});

test('Task 08: No-op auto scroll when already at bottom leaves non-programmatic state and user upward scroll immediately pauses follow', () => {
  // 1. Initial state: already at bottom (scrollTop=2300, scrollHeight=3000, clientHeight=700)
  let state = {
    isFollowing: true,
    hasUnseenContent: false,
    isProgrammaticScroll: false,
    lastScrollTop: 2300,
  };

  // 2. Content revision arrives (no height change, or height stays 3000 so targetScrollTop is still 2300)
  const arrival = handleContentArrival(state);
  assert.equal(arrival.shouldScrollToBottom, true);

  const targetScrollTop = calculateMaxScrollTop({ scrollHeight: 3000, clientHeight: 700 });
  assert.equal(targetScrollTop, 2300);

  // Auto programmatic scroll executes without smooth animation (isSmooth=false)
  state = handleProgrammaticScroll(arrival.state, targetScrollTop, false);
  assert.equal(state.isProgrammaticScroll, false, 'Continuous auto-scroll must NOT hold a programmatic lock');
  assert.equal(state.lastScrollTop, 2300);

  // 3. NO browser scroll event occurs because scrollTop did not change

  // 4. User scrolls upward (e.g. via keyboard ArrowUp/PageUp or scrollbar drag to scrollTop=2100)
  // Distance from bottom is 3000 - 2100 - 700 = 200px (> threshold 80px)
  state = handleScrollEvent(state, { scrollTop: 2100, scrollHeight: 3000, clientHeight: 700 }, 80);

  // 5. Expected: follow is paused (isFollowing=false) without being blocked by a stale programmatic lock
  assert.equal(state.isFollowing, false, 'User upward scroll must immediately pause follow');
  assert.equal(state.lastScrollTop, 2100);

  // 6. Next content revision flags unseen content badge and does not move viewport
  const nextArrival = handleContentArrival(state);
  assert.equal(nextArrival.shouldScrollToBottom, false);
  assert.equal(nextArrival.state.hasUnseenContent, true);
});
