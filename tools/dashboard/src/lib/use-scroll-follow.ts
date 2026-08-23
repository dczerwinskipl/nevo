import { useCallback, useEffect, useRef, useState } from 'react';

export function calculateMaxScrollTop(el: { scrollHeight: number; clientHeight: number }): number {
  return Math.max(0, el.scrollHeight - el.clientHeight);
}

export function calculateDistanceFromBottom(el: { scrollHeight: number; scrollTop: number; clientHeight: number }): number {
  return Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight);
}

export function isScrolledNearBottom(
  el: { scrollHeight: number; scrollTop: number; clientHeight: number },
  threshold = 80
): boolean {
  return calculateDistanceFromBottom(el) <= threshold;
}

export interface ScrollControllerState {
  isFollowing: boolean;
  hasUnseenContent: boolean;
  isProgrammaticScroll: boolean;
  lastScrollTop: number;
}

export function createInitialScrollControllerState(initialScrollTop = 0): ScrollControllerState {
  return {
    isFollowing: true,
    hasUnseenContent: false,
    isProgrammaticScroll: false,
    lastScrollTop: initialScrollTop,
  };
}

export function handleProgrammaticScroll(
  state: ScrollControllerState,
  targetScrollTop: number,
): ScrollControllerState {
  return {
    ...state,
    isFollowing: true,
    hasUnseenContent: false,
    isProgrammaticScroll: true,
    lastScrollTop: targetScrollTop,
  };
}

export function handleContentArrival(
  state: ScrollControllerState,
): { state: ScrollControllerState; shouldScrollToBottom: boolean } {
  if (state.isFollowing) {
    return {
      state,
      shouldScrollToBottom: true,
    };
  }
  return {
    state: {
      ...state,
      hasUnseenContent: true,
    },
    shouldScrollToBottom: false,
  };
}

export function handleUserReturnToBottom(
  state: ScrollControllerState,
  targetScrollTop: number,
  smooth = true,
): { state: ScrollControllerState; behavior: ScrollBehavior } {
  return {
    state: {
      isFollowing: true,
      hasUnseenContent: false,
      isProgrammaticScroll: smooth,
      lastScrollTop: targetScrollTop,
    },
    behavior: smooth ? 'smooth' : 'auto',
  };
}

export function handleUserUpwardGesture(
  state: ScrollControllerState,
): ScrollControllerState {
  return {
    ...state,
    isProgrammaticScroll: false,
    isFollowing: false,
  };
}

export function handleScrollEvent(
  state: ScrollControllerState,
  metrics: { scrollTop: number; scrollHeight: number; clientHeight: number },
  threshold = 80,
): ScrollControllerState {
  const currentScrollTop = metrics.scrollTop;
  const distanceFromBottom = calculateDistanceFromBottom(metrics);
  const isNearBottom = distanceFromBottom <= threshold;
  const isScrollingUp = currentScrollTop < state.lastScrollTop;

  if (state.isProgrammaticScroll) {
    if (isNearBottom) {
      return {
        ...state,
        isFollowing: true,
        hasUnseenContent: false,
        isProgrammaticScroll: false,
        lastScrollTop: currentScrollTop,
      };
    }
    // Intermediate scroll events during programmatic smooth scroll must not disable follow
    return {
      ...state,
      lastScrollTop: currentScrollTop,
    };
  }

  // Any user scroll upward away from bottom immediately pauses follow
  if (isScrollingUp && !isNearBottom) {
    return {
      ...state,
      isFollowing: false,
      lastScrollTop: currentScrollTop,
    };
  }

  // User scrolling down and reaching bottom threshold
  if (isNearBottom && !isScrollingUp) {
    return {
      ...state,
      isFollowing: true,
      hasUnseenContent: false,
      isProgrammaticScroll: false,
      lastScrollTop: currentScrollTop,
    };
  }

  if (!isNearBottom) {
    return {
      ...state,
      isFollowing: false,
      lastScrollTop: currentScrollTop,
    };
  }

  return {
    ...state,
    lastScrollTop: currentScrollTop,
  };
}

export interface UseScrollFollowOptions {
  /**
   * Distance from bottom in pixels within which the user is considered "at bottom".
   * Defaults to 80.
   */
  threshold?: number;
  /**
   * Primitive content revision or key. When this changes, follow-scroll triggers
   * if near bottom, or sets unseen content flag if scrolled up.
   */
  contentKey?: string | number;
  /**
   * @deprecated Use contentKey with a stable primitive string/number instead.
   */
  contentSignal?: unknown;
}

export interface UseScrollFollowResult {
  containerRef: React.RefObject<HTMLDivElement | null>;
  isFollowing: boolean;
  hasUnseenContent: boolean;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  handleScroll: () => void;
}

export function useScrollFollow(options: UseScrollFollowOptions = {}): UseScrollFollowResult {
  const { threshold = 80, contentKey, contentSignal } = options;
  const effectiveKey = contentKey !== undefined ? contentKey : contentSignal;
  const containerRef = useRef<HTMLDivElement>(null);

  const [state, setState] = useState<ScrollControllerState>(createInitialScrollControllerState);
  const stateRef = useRef<ScrollControllerState>(state);
  stateRef.current = state;

  const initialMountRef = useRef(true);
  const touchStartYRef = useRef(0);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = containerRef.current;
    if (!el) return;
    const targetScrollTop = calculateMaxScrollTop(el);
    const updated = handleUserReturnToBottom(stateRef.current, targetScrollTop, behavior === 'smooth');
    stateRef.current = updated.state;
    setState(updated.state);
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const nextState = handleScrollEvent(stateRef.current, el, threshold);
    stateRef.current = nextState;
    setState(nextState);
  }, [threshold]);

  // Attach scroll and user-gesture listeners to container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) {
        // Explicit wheel scroll UP pauses follow immediately
        const nextState = handleUserUpwardGesture(stateRef.current);
        stateRef.current = nextState;
        setState(nextState);
      }
    };

    const handleTouchStart = (e: TouchEvent) => {
      touchStartYRef.current = e.touches[0]?.clientY ?? 0;
    };

    const handleTouchMove = (e: TouchEvent) => {
      const currentY = e.touches[0]?.clientY ?? 0;
      if (currentY > touchStartYRef.current + 10) {
        // Finger dragging DOWN means viewport scrolling UP into history -> pause follow immediately
        const nextState = handleUserUpwardGesture(stateRef.current);
        stateRef.current = nextState;
        setState(nextState);
      }
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    el.addEventListener('wheel', handleWheel, { passive: true });
    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: true });

    return () => {
      el.removeEventListener('scroll', handleScroll);
      el.removeEventListener('wheel', handleWheel);
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
    };
  }, [handleScroll]);

  // React to semantic contentKey changes
  useEffect(() => {
    const el = containerRef.current;
    if (initialMountRef.current) {
      initialMountRef.current = false;
      if (el) {
        const targetScrollTop = calculateMaxScrollTop(el);
        const nextState = handleProgrammaticScroll(stateRef.current, targetScrollTop);
        stateRef.current = nextState;
        setState(nextState);
        el.scrollTo({ top: el.scrollHeight, behavior: 'auto' });
      }
      return;
    }

    const { state: nextState, shouldScrollToBottom } = handleContentArrival(stateRef.current);
    if (shouldScrollToBottom && el) {
      const targetScrollTop = calculateMaxScrollTop(el);
      const progState = handleProgrammaticScroll(nextState, targetScrollTop);
      stateRef.current = progState;
      setState(progState);
      el.scrollTo({ top: el.scrollHeight, behavior: 'auto' });
    } else {
      stateRef.current = nextState;
      setState(nextState);
    }
  }, [effectiveKey]);

  return {
    containerRef,
    isFollowing: state.isFollowing,
    hasUnseenContent: state.hasUnseenContent,
    scrollToBottom,
    handleScroll,
  };
}
