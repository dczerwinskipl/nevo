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

/**
 * Computes a stable primitive string key representing transcript content changes.
 * Unrelated component rerenders (focus, Sheet opening, status change) produce identical keys,
 * preventing spurious scroll movement or false "Nowe wiadomości" badges.
 */
export function computeTranscriptContentKey(
  messages: NormalizedMessage[] = [],
  pendingInteractionId?: string | null,
  submissionError?: string | null,
): string {
  if (messages.length === 0 && !pendingInteractionId && !submissionError) {
    return 'empty';
  }
  const lastMsg = messages[messages.length - 1];
  let lastMsgSig = '';
  if (lastMsg) {
    const toolCallSig = lastMsg.toolCalls
      ? lastMsg.toolCalls.map((tc) => `${tc.id}:${tc.status}:${tc.durationMs ?? 0}`).join(',')
      : '';
    lastMsgSig = `${lastMsg.id}:${lastMsg.text.length}:${lastMsg.reasoning?.length ?? 0}:${toolCallSig}:${lastMsg.turnError?.code ?? ''}`;
  }
  return `${messages.length}|${lastMsgSig}|${pendingInteractionId ?? ''}|${submissionError ?? ''}`;
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
  }, [effectiveKey, scrollToBottom]);

  return {
    containerRef,
    isFollowing,
    hasUnseenContent,
    scrollToBottom,
    handleScroll,
  };
}
