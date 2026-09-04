import { useCallback, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { ReasoningView } from './reasoning-view';
import { MarkdownContent } from '@/shared/markdown/markdown-content';
import { TurnWorkSummary } from '../turn-work/turn-work-summary';
import { hasVisibleProse, shouldRenderTranscriptMessage } from '../turn-work/turn-work-visibility';
import { shouldCollapseMessage } from './message-collapse';
import type { TurnWork } from './projection';
import type { NormalizedMessage } from '../types';
import { cn } from '@/lib/utils';

export interface TranscriptMessageProps {
  message: NormalizedMessage;
  work?: TurnWork;
  isStreaming?: boolean;
}

/**
 * Module-level per react-component-guidelines.md §20.1 — previously a nested function
 * inside `AgentSessionPage`, now extracted so it isn't recreated on every render. No avatars
 * (FR-2): role is distinguished by alignment (`justify-end`/`items-end` for the user)
 * plus background color, not color alone (NFR-2). Consumes Task 01's `TurnWork`
 * projection via the `work` prop unchanged — this component only redesigns the prose
 * bubble around it.
 */
export function TranscriptMessage({ message, work, isStreaming = false }: TranscriptMessageProps) {
  const user = message.role === 'user';
  const hasProse = hasVisibleProse(message);
  const isLong = user && shouldCollapseMessage(message.text);
  const [expanded, setExpanded] = useState(false);
  const toggleExpanded = useCallback(() => setExpanded((previous) => !previous), []);

  // Nothing to show yet (no prose, no Work) — e.g. the brief moment a turn has started
  // but no content has streamed in — render nothing rather than an empty bubble/circle;
  // the transcript's own "isRunning" indicator already covers this loading state.
  if (!shouldRenderTranscriptMessage(message, Boolean(work))) return null;

  return (
    <div className={cn('flex w-full min-w-0', user ? 'justify-end' : 'justify-start')}>
      <div className={cn('flex w-full min-w-0 flex-col space-y-1.5', user ? 'items-end' : 'items-start')}>
        {/* Work is a flat transcript row, never nested inside the prose card below —
            a turn with no prose renders Work directly with no card around it at all. */}
        {work && (
          <div className="w-full max-w-full min-w-0">
            <TurnWorkSummary work={work} />
          </div>
        )}
        {hasProse && (
          <div
            className={cn(
              'rounded-2xl px-4 py-3 text-sm leading-6',
              user
                ? 'w-fit max-w-[min(88%,820px)] border border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--foreground)]'
                : 'w-full border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]',
            )}
          >
            {message.activityTimeline?.map((item) => {
              if (item.type === 'commentary' && item.text) {
                return (
                  <div key={item.id} className="mb-2 text-sm text-[var(--foreground-muted)] last:mb-0">
                    <MarkdownContent markdown={item.text} className="text-[var(--foreground)]" />
                  </div>
                );
              }
              return null;
            })}
            {message.reasoning && (
              <ReasoningView reasoning={message.reasoning} isStreaming={isStreaming && !message.text} />
            )}
            {message.text &&
              (user ? (
                <div className="space-y-1.5">
                  <div
                    className={cn(
                      'font-normal break-words whitespace-pre-wrap text-[var(--foreground)]',
                      // Must match message-collapse.ts's COLLAPSED_LINE_LIMIT — Tailwind's
                      // scanner needs a literal class, not an interpolated variable.
                      isLong && !expanded && 'line-clamp-6',
                    )}
                  >
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
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
