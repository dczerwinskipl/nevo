import { useCallback, useEffect, useRef, useState } from 'react';
import type { NormalizedMessage } from './types';

export function calculateDistanceFromBottom(el: { scrollHeight: number; scrollTop: number; clientHeight: number }): number {
  return Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight);
}

export function isScrolledNearBottom(
  el: { scrollHeight: number; scrollTop: number; clientHeight: number },
  threshold = 80
): boolean {
  return calculateDistanceFromBottom(el) <= threshold;
}

export interface ScrollState {
  isFollowing: boolean;
  hasUnseenContent: boolean;
  isProgrammaticScroll: boolean;
}

export function createInitialScrollState(): ScrollState {
  return {
    isFollowing: true,
    hasUnseenContent: false,
    isProgrammaticScroll: false,
  };
}

export function handleScrollEvent(
  state: ScrollState,
  isNearBottom: boolean,
  isScrollingUp = false,
  distanceFromBottom = 0,
): ScrollState {
  if (state.isProgrammaticScroll) {
    if (distanceFromBottom <= 10) {
      return {
        ...state,
        isFollowing: true,
        hasUnseenContent: false,
        isProgrammaticScroll: false,
      };
    }
    // Intermediate scroll events during programmatic smooth scroll must not disable follow
    return state;
  }

  // Any user scroll upward away from bottom immediately pauses follow
  if (isScrollingUp && distanceFromBottom > 0) {
    return {
      ...state,
      isFollowing: false,
    };
  }

  if (isNearBottom && !isScrollingUp) {
    return {
      ...state,
      isFollowing: true,
      hasUnseenContent: false,
      isProgrammaticScroll: false,
    };
  }

  if (!isNearBottom) {
    return {
      ...state,
      isFollowing: false,
    };
  }

  return state;
}

export function handleContentArrival(
  state: ScrollState,
): { state: ScrollState; shouldScrollToBottom: boolean } {
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
  state: ScrollState,
  smooth = true,
): { state: ScrollState; behavior: ScrollBehavior } {
  return {
    state: {
      isFollowing: true,
      hasUnseenContent: false,
      isProgrammaticScroll: smooth,
    },
    behavior: smooth ? 'smooth' : 'auto',
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
  const [isFollowing, setIsFollowing] = useState(true);
  const [hasUnseenContent, setHasUnseenContent] = useState(false);
  const isFollowingRef = useRef(true);
  const isProgrammaticScrollRef = useRef(false);
  const initialMountRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const touchStartYRef = useRef(0);

  const isNearBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return true;
    const distanceFromBottom = calculateDistanceFromBottom(el);
    return distanceFromBottom <= threshold;
  }, [threshold]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = containerRef.current;
    isFollowingRef.current = true;
    setIsFollowing(true);
    setHasUnseenContent(false);
    if (behavior === 'smooth') {
      isProgrammaticScrollRef.current = true;
    } else {
      isProgrammaticScrollRef.current = false;
    }
    if (el) {
      lastScrollTopRef.current = el.scrollHeight;
      el.scrollTo({ top: el.scrollHeight, behavior });
    }
  }, []);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const currentScrollTop = el.scrollTop;
    const distanceFromBottom = calculateDistanceFromBottom(el);
    const isNear = distanceFromBottom <= threshold;
    const isScrollingUp = currentScrollTop < lastScrollTopRef.current;
    lastScrollTopRef.current = currentScrollTop;

    if (isProgrammaticScrollRef.current) {
      if (distanceFromBottom <= 10) {
        isProgrammaticScrollRef.current = false;
        isFollowingRef.current = true;
        setIsFollowing(true);
        setHasUnseenContent(false);
      }
      return;
    }

    if (isScrollingUp && distanceFromBottom > 0) {
      // Any upward user scroll immediately pauses follow even within threshold
      isFollowingRef.current = false;
      setIsFollowing(false);
    } else if (isNear && !isScrollingUp) {
      // User scrolled down to bottom
      isFollowingRef.current = true;
      setIsFollowing(true);
      setHasUnseenContent(false);
    } else if (!isNear) {
      isFollowingRef.current = false;
      setIsFollowing(false);
    }
  }, [threshold]);

  // Attach scroll and user-gesture listeners to container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      isProgrammaticScrollRef.current = false;
      if (e.deltaY < 0) {
        // Explicit wheel scroll UP pauses follow immediately
        isFollowingRef.current = false;
        setIsFollowing(false);
      }
    };

    const handleTouchStart = (e: TouchEvent) => {
      isProgrammaticScrollRef.current = false;
      touchStartYRef.current = e.touches[0]?.clientY ?? 0;
    };

    const handleTouchMove = (e: TouchEvent) => {
      const currentY = e.touches[0]?.clientY ?? 0;
      if (currentY > touchStartYRef.current + 5) {
        // Finger dragging DOWN means viewport scrolling UP into history -> pause follow immediately
        isFollowingRef.current = false;
        setIsFollowing(false);
      }
    };

    const handlePointerDown = () => {
      isProgrammaticScrollRef.current = false;
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    el.addEventListener('wheel', handleWheel, { passive: true });
    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: true });
    el.addEventListener('pointerdown', handlePointerDown, { passive: true });

    return () => {
      el.removeEventListener('scroll', handleScroll);
      el.removeEventListener('wheel', handleWheel);
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [handleScroll]);

  // React to semantic contentKey changes
  useEffect(() => {
    if (initialMountRef.current) {
      initialMountRef.current = false;
      scrollToBottom('auto');
      return;
    }

    if (isFollowingRef.current) {
      const el = containerRef.current;
      if (el) {
        lastScrollTopRef.current = el.scrollHeight;
        // Continuous streaming follow uses immediate 'auto' positioning to prevent animation races
        el.scrollTo({ top: el.scrollHeight, behavior: 'auto' });
      }
    } else {
      setHasUnseenContent(true);
    }
  }, [effectiveKey, scrollToBottom]);

  return {
    containerRef,
    isFollowing,
    hasUnseenContent,
    scrollToBottom,
    handleScroll,
  };
}
