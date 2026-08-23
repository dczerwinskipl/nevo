import { useCallback, useEffect, useRef, useState } from 'react';

export function calculateDistanceFromBottom(el: { scrollHeight: number; scrollTop: number; clientHeight: number }): number {
  return Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight);
}

export function isScrolledNearBottom(
  el: { scrollHeight: number; scrollTop: number; clientHeight: number },
  threshold = 80
): boolean {
  return calculateDistanceFromBottom(el) <= threshold;
}

export interface UseScrollFollowOptions {
  /**
   * Distance from bottom in pixels within which the user is considered "at bottom".
   * Defaults to 80.
   */
  threshold?: number;
  /**
   * Dependencies that trigger follow scroll when user is at the bottom,
   * or flag unseen content when user is scrolled up.
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
  const { threshold = 80, contentSignal } = options;
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFollowing, setIsFollowing] = useState(true);
  const [hasUnseenContent, setHasUnseenContent] = useState(false);
  const isFollowingRef = useRef(true);
  const initialMountRef = useRef(true);

  const isNearBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return true;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    return distanceFromBottom <= threshold;
  }, [threshold]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = containerRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior });
    }
    isFollowingRef.current = true;
    setIsFollowing(true);
    setHasUnseenContent(false);
  }, []);

  const handleScroll = useCallback(() => {
    const nearBottom = isNearBottom();
    if (nearBottom) {
      isFollowingRef.current = true;
      setIsFollowing(true);
      setHasUnseenContent(false);
    } else {
      isFollowingRef.current = false;
      setIsFollowing(false);
    }
  }, [isNearBottom]);

  // Attach scroll listener to container if available
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', handleScroll);
    };
  }, [handleScroll]);

  // React to new content signals
  useEffect(() => {
    if (initialMountRef.current) {
      initialMountRef.current = false;
      scrollToBottom('auto');
      return;
    }

    if (isFollowingRef.current) {
      const el = containerRef.current;
      if (el) {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      }
    } else {
      setHasUnseenContent(true);
    }
  }, [contentSignal, scrollToBottom]);

  return {
    containerRef,
    isFollowing,
    hasUnseenContent,
    scrollToBottom,
    handleScroll,
  };
}
