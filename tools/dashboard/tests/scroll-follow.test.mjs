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
} from '../ui/components/ai-chat/use-scroll-follow.ts';

function readAiChatSource() {
  return readFileSync(fileURLToPath(new URL('../ui/components/ai-chat/ai-chat.tsx', import.meta.url)), 'utf8');
}

function readUseScrollFollowSource() {
  return readFileSync(fileURLToPath(new URL('../ui/components/ai-chat/use-scroll-follow.ts', import.meta.url)), 'utf8');
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

test('Task 08: Upward scroll from inside threshold immediately detaches follow', () => {
  // User is at bottom: scrollTop=2300, scrollHeight=3000, clientHeight=700 (distance=0)
  let state = {
    isFollowing: true,
    hasUnseenContent: false,
    isProgrammaticScroll: false,
    lastScrollTop: 2300,
  };

  // User scrolls up by 30px to scrollTop=2270 (distanceFromBottom = 30px <= threshold 80px)
  state = handleScrollEvent(state, { scrollTop: 2270, scrollHeight: 3000, clientHeight: 700 }, 80);
  assert.equal(state.isFollowing, false, 'Upward scroll inside threshold MUST immediately detach follow');
  assert.equal(state.lastScrollTop, 2270);

  // When next token arrives, it must NOT scroll to bottom
  const arrival = handleContentArrival(state);
  assert.equal(arrival.shouldScrollToBottom, false, 'Must not pull viewport back to bottom');
  assert.equal(arrival.state.hasUnseenContent, true, 'Flags unseen content');
});

test('Task 08 Regression: 8-step streaming lifecycle with upward scroll and resume', () => {
  // Step 1: Start following at bottom
  let scrollContainer = { scrollHeight: 2000, clientHeight: 600, scrollTop: 1400 };
  let state = createInitialScrollControllerState(1400);
  assert.equal(state.isFollowing, true);
  assert.equal(state.hasUnseenContent, false);

  // Step 2: Stream content arrives while at bottom -> follow scrolls to new bottom
  scrollContainer.scrollHeight = 2500;
  const streamStep1 = handleContentArrival(state);
  assert.equal(streamStep1.shouldScrollToBottom, true);
  const target1 = calculateMaxScrollTop(scrollContainer);
  assert.equal(target1, 1900);
  state = handleProgrammaticScroll(streamStep1.state, target1, false);
  scrollContainer.scrollTop = 1900;
  state = handleScrollEvent(state, scrollContainer);
  assert.equal(state.isFollowing, true);
  assert.equal(state.hasUnseenContent, false);

  // Step 3: User scrolls far upward into conversation history (e.g. mouse wheel / touch drag)
  state = handleUserUpwardGesture(state);
  scrollContainer.scrollTop = 600; // far up, distance = 2500 - 600 - 600 = 1300px
  state = handleScrollEvent(state, scrollContainer);
  assert.equal(state.isFollowing, false, 'Follow is disabled after user scrolls up');

  // Step 4: Emit multiple subsequent content revisions while detached
  const revisions = [3000, 3600, 4200];
  for (const newHeight of revisions) {
    scrollContainer.scrollHeight = newHeight;
    const arrival = handleContentArrival(state);
    state = arrival.state;

    // Step 5: Verify scroll position remains completely stable and follow remains disabled
    assert.equal(arrival.shouldScrollToBottom, false, 'Must not scroll to bottom while detached');
    assert.equal(scrollContainer.scrollTop, 600, 'User scroll position remains unchanged at 600');
    assert.equal(state.isFollowing, false, 'Follow remains disabled');

    // Step 6: Verify unseen-content indication appears
    assert.equal(state.hasUnseenContent, true, 'Unseen content indicator is active');
  }

  // Step 7: Explicitly return to bottom (e.g. click "Nowe wiadomości")
  const targetBottom = calculateMaxScrollTop(scrollContainer);
  assert.equal(targetBottom, 3600); // 4200 - 600
  const returnResult = handleUserReturnToBottom(state, targetBottom, true);
  state = returnResult.state;
  assert.equal(state.isFollowing, true);
  assert.equal(state.hasUnseenContent, false);
  scrollContainer.scrollTop = targetBottom;
  state = handleScrollEvent(state, scrollContainer);
  assert.equal(state.isFollowing, true);
  assert.equal(state.isProgrammaticScroll, false);

  // Step 8: Verify following resumes on subsequent streaming content
  scrollContainer.scrollHeight = 4800;
  const resumeArrival = handleContentArrival(state);
  assert.equal(resumeArrival.shouldScrollToBottom, true, 'Following has resumed automatically');
  const targetResume = calculateMaxScrollTop(scrollContainer);
  state = handleProgrammaticScroll(resumeArrival.state, targetResume, false);
  scrollContainer.scrollTop = targetResume;
  state = handleScrollEvent(state, scrollContainer);
  assert.equal(state.isFollowing, true);
  assert.equal(state.hasUnseenContent, false);
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

test('Performance / Finding 3: Repeated scroll events while detached do not alter visible state flags', () => {
  let state = createInitialScrollControllerState(2000);
  // User scrolls up to detach
  state = handleScrollEvent(state, { scrollTop: 1500, scrollHeight: 3000, clientHeight: 600 }, 80);
  assert.equal(state.isFollowing, false);
  assert.equal(state.hasUnseenContent, false);

  const visibleBefore = { isFollowing: state.isFollowing, hasUnseenContent: state.hasUnseenContent };

  // 100 subsequent scroll events while detached
  for (let top = 1490; top >= 500; top -= 10) {
    state = handleScrollEvent(state, { scrollTop: top, scrollHeight: 3000, clientHeight: 600 }, 80);
    assert.equal(state.isFollowing, visibleBefore.isFollowing, 'isFollowing remains false across scrolling');
    assert.equal(state.hasUnseenContent, visibleBefore.hasUnseenContent, 'hasUnseenContent remains unchanged');
  }
});

test('Performance / Finding 3: Repeated content arrivals while unseen=true do not toggle or flip visible state flags', () => {
  let state = createInitialScrollControllerState(1000);
  state = handleScrollEvent(state, { scrollTop: 500, scrollHeight: 2000, clientHeight: 600 }, 80);
  assert.equal(state.isFollowing, false);

  // First arrival transitions unseen to true
  const firstArrival = handleContentArrival(state);
  assert.equal(firstArrival.state.hasUnseenContent, true);
  state = firstArrival.state;

  // 50 subsequent streamed chunks arriving while detached
  for (let i = 0; i < 50; i++) {
    const nextArrival = handleContentArrival(state);
    assert.equal(nextArrival.state.hasUnseenContent, true, 'hasUnseenContent remains true without toggling');
    assert.equal(nextArrival.state.isFollowing, false, 'isFollowing remains false without toggling');
    state = nextArrival.state;
  }
});

