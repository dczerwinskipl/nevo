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

export interface VisibleScrollState {
  isFollowing: boolean;
  hasUnseenContent: boolean;
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
  isSmooth = false,
): ScrollControllerState {
  return {
    ...state,
    isFollowing: true,
    hasUnseenContent: false,
    isProgrammaticScroll: isSmooth,
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
  const isScrollingUp = currentScrollTop < state.lastScrollTop - 2;

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

  // Any user upward scroll immediately pauses follow, regardless of threshold
  if (isScrollingUp) {
    return {
      ...state,
      isFollowing: false,
      lastScrollTop: currentScrollTop,
    };
  }

  // If currently following and user did not scroll up: maintain follow
  if (state.isFollowing) {
    return {
      ...state,
      isFollowing: true,
      lastScrollTop: currentScrollTop,
    };
  }

  // If detached: reaching the bottom threshold re-attaches follow
  if (isNearBottom) {
    return {
      ...state,
      isFollowing: true,
      hasUnseenContent: false,
      isProgrammaticScroll: false,
      lastScrollTop: currentScrollTop,
    };
  }

  return {
    ...state,
    isFollowing: false,
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

  // Expose minimal React state (isFollowing, hasUnseenContent) to avoid rendering on high-frequency scrolls
  const [visibleState, setVisibleState] = useState<VisibleScrollState>({
    isFollowing: true,
    hasUnseenContent: false,
  });

  // Keep full controller internals in ref
  const internalStateRef = useRef<ScrollControllerState>({
    isFollowing: true,
    hasUnseenContent: false,
    isProgrammaticScroll: false,
    lastScrollTop: 0,
  });

  const rafIdRef = useRef<number | null>(null);
  const touchStartYRef = useRef(0);

  // Publish state to React ONLY when a visible boolean transitions
  const publishStateIfNeeded = useCallback((nextState: ScrollControllerState) => {
    const prev = internalStateRef.current;
    internalStateRef.current = nextState;
    if (prev.isFollowing !== nextState.isFollowing || prev.hasUnseenContent !== nextState.hasUnseenContent) {
      setVisibleState({
        isFollowing: nextState.isFollowing,
        hasUnseenContent: nextState.hasUnseenContent,
      });
    }
  }, []);

  // Coalesced RAF bottom follow to avoid layout thrashing across ResizeObserver, MutationObserver, and content revisions
  const scheduleSnapToBottom = useCallback(() => {
    if (rafIdRef.current !== null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      const el = containerRef.current;
      if (!el || !internalStateRef.current.isFollowing) return;
      const target = calculateMaxScrollTop(el);
      if (el.scrollTop !== target) {
        el.scrollTop = target;
        internalStateRef.current.lastScrollTop = target;
      }
    });
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = containerRef.current;
    if (!el) return;
    const targetScrollTop = calculateMaxScrollTop(el);
    const updated = handleUserReturnToBottom(internalStateRef.current, targetScrollTop, behavior === 'smooth');
    publishStateIfNeeded(updated.state);
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, [publishStateIfNeeded]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const nextState = handleScrollEvent(internalStateRef.current, el, threshold);
    publishStateIfNeeded(nextState);
  }, [publishStateIfNeeded, threshold]);

  // Attach scroll and user-gesture listeners to container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) {
        // Explicit wheel scroll UP pauses follow immediately
        const nextState = handleUserUpwardGesture(internalStateRef.current);
        publishStateIfNeeded(nextState);
      }
    };

    const handleTouchStart = (e: TouchEvent) => {
      touchStartYRef.current = e.touches[0]?.clientY ?? 0;
    };

    const handleTouchMove = (e: TouchEvent) => {
      const currentY = e.touches[0]?.clientY ?? 0;
      if (currentY > touchStartYRef.current + 5) {
        // Finger dragging DOWN means viewport scrolling UP into history -> pause follow immediately
        const nextState = handleUserUpwardGesture(internalStateRef.current);
        publishStateIfNeeded(nextState);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'PageUp' || e.key === 'Home' || e.key === 'ArrowUp') {
        const nextState = handleUserUpwardGesture(internalStateRef.current);
        publishStateIfNeeded(nextState);
      }
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    el.addEventListener('wheel', handleWheel, { passive: true });
    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: true });
    el.addEventListener('keydown', handleKeyDown);

    return () => {
      el.removeEventListener('scroll', handleScroll);
      el.removeEventListener('wheel', handleWheel);
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleScroll, publishStateIfNeeded]);

  // Keep viewport glued to bottom when DOM height expands (streaming, dynamic tools, markdown images)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    scheduleSnapToBottom();

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        scheduleSnapToBottom();
      });
      resizeObserver.observe(el);
      if (el.firstElementChild) {
        resizeObserver.observe(el.firstElementChild);
      }
    }

    let mutationObserver: MutationObserver | null = null;
    if (typeof MutationObserver !== 'undefined') {
      mutationObserver = new MutationObserver(() => {
        scheduleSnapToBottom();
      });
      mutationObserver.observe(el, { childList: true, subtree: true, characterData: true });
    }

    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [scheduleSnapToBottom]);

  // React to semantic contentKey changes and message arrivals
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    if (internalStateRef.current.isFollowing) {
      const targetScrollTop = calculateMaxScrollTop(el);
      const progState = handleProgrammaticScroll(internalStateRef.current, targetScrollTop, false);
      publishStateIfNeeded(progState);
      el.scrollTop = targetScrollTop;
      scheduleSnapToBottom();
    } else {
      const { state: nextState } = handleContentArrival(internalStateRef.current);
      publishStateIfNeeded(nextState);
    }
  }, [effectiveKey, publishStateIfNeeded, scheduleSnapToBottom]);

  return {
    containerRef,
    isFollowing: visibleState.isFollowing,
    hasUnseenContent: visibleState.hasUnseenContent,
    scrollToBottom,
    handleScroll,
  };
}
