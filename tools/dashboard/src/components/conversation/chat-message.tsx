import { useCallback, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { AiReasoningView } from '@/components/ai-reasoning-view';
import { MarkdownContent } from '@/components/markdown-content';
import { WorkSummary } from '@/components/work/work-summary';
import { hasVisibleProse, shouldRenderChatMessage } from '@/components/work/work-visibility';
import { shouldCollapseMessage } from '@/components/conversation/message-collapse';
import type { TurnWork } from '@/lib/chat-projection';
import type { NormalizedMessage } from '@/lib/types';
import { cn } from '@/lib/utils';

export interface ChatMessageProps {
  message: NormalizedMessage;
  work?: TurnWork;
  isStreaming?: boolean;
}

/**
 * Module-level per react-component-guidelines.md §20.1 — previously a nested function
 * inside `AiChatPage`, now extracted so it isn't recreated on every render. No avatars
 * (FR-2): role is distinguished by alignment (`justify-end`/`items-end` for the user)
 * plus background color, not color alone (NFR-2). Consumes Task 01's `TurnWork`
 * projection via the `work` prop unchanged — this component only redesigns the prose
 * bubble around it.
 */
export function ChatMessage({ message, work, isStreaming = false }: ChatMessageProps) {
  const user = message.role === 'user';
  const hasProse = hasVisibleProse(message);
  const isLong = user && shouldCollapseMessage(message.text);
  const [expanded, setExpanded] = useState(false);
  const toggleExpanded = useCallback(() => setExpanded(previous => !previous), []);

  // Nothing to show yet (no prose, no Work) — e.g. the brief moment a turn has started
  // but no content has streamed in — render nothing rather than an empty bubble/circle;
  // the transcript's own "isRunning" indicator already covers this loading state.
  if (!shouldRenderChatMessage(message, Boolean(work))) return null;

  return (
    <div className={cn('flex', user && 'justify-end')}>
      <div className={cn('min-w-0 space-y-1.5', user ? 'flex max-w-[min(88%,820px)] flex-col items-end' : 'flex-1')}>
        {/* Work is a flat transcript row, never nested inside the prose card below —
            a turn with no prose renders Work directly with no card around it at all. */}
        {work && <WorkSummary work={work} />}
        {hasProse && (
          <div className={cn(
            'max-w-[min(88%,820px)] rounded-2xl px-4 py-3 text-sm leading-6',
            user
              ? 'border border-[#2e3746] bg-[#161c24] text-[var(--foreground)]'
              : 'border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]'
          )}>
            {message.reasoning && (
              <AiReasoningView reasoning={message.reasoning} isStreaming={isStreaming && !message.text} />
            )}
            {message.text && (
              user ? (
                <div className="space-y-1.5">
                  <div className={cn(
                    'whitespace-pre-wrap break-words font-normal text-[var(--foreground)]',
                    // Must match message-collapse.ts's COLLAPSED_LINE_LIMIT — Tailwind's
                    // scanner needs a literal class, not an interpolated variable.
                    isLong && !expanded && 'line-clamp-6'
                  )}>
                    {message.text}
                  </div>
                  {isLong && (
                    <button
                      type="button"
                      onClick={toggleExpanded}
                      aria-expanded={expanded}
                      className="flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline"
                    >
                      {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                      {expanded ? 'Zwiń' : 'Pokaż więcej'}
                    </button>
                  )}
                </div>
              ) : (
                <MarkdownContent markdown={message.text} className="text-[var(--foreground)]" />
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}
