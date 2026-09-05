import { AlertTriangle, ArrowLeft, ChevronDown, ChevronRight, LoaderCircle, RefreshCw } from 'lucide-react';
import { forwardRef, useCallback, useImperativeHandle, useState } from 'react';

import { Button } from '@/components/ui/button';
import { TurnWorkPanelV2 } from './turn-work-panel-v2';
import { useScrollFollow } from '../transcript/use-scroll-follow';
import { shouldCollapseMessage } from '../transcript/message-collapse';
import { AgentSessionLoadError } from '../runtime/agent-session-transport';
import type { CanonicalTurnV2 } from '../types';
import { cn } from '@/lib/utils';

export interface AgentSessionTranscriptV2Handle {
  scrollToBottom: (behavior?: ScrollBehavior) => void;
}

function UserMessageBubble({ text }: { text: string }) {
  const isLong = shouldCollapseMessage(text);
  const [expanded, setExpanded] = useState(false);
  const toggleExpanded = useCallback(() => setExpanded((prev) => !prev), []);

  return (
    <div className="flex w-full min-w-0 justify-end">
      <div className="w-fit max-w-[min(88%,820px)] rounded-2xl border border-border-strong bg-surface-raised px-4 py-3 text-sm leading-6 text-fg-primary">
        <div className="space-y-1.5">
          <div
            className={cn(
              'font-normal break-words whitespace-pre-wrap text-fg-primary',
              isLong && !expanded && 'line-clamp-6',
            )}
          >
            {text}
          </div>
          {isLong && (
            <button
              type="button"
              onClick={toggleExpanded}
              aria-expanded={expanded}
              className="flex items-center gap-1 text-xs font-medium text-accent hover:underline"
            >
              {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              {expanded ? 'Zwiń' : 'Pokaż więcej'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export interface AgentSessionTranscriptV2Props {
  turns: CanonicalTurnV2[];
  /** Optimistic text for the brief POST-to-first-snapshot gap only — every materialized turn renders its own canonical `userMessage` instead. */
  optimisticUserMessage?: string | null;
  isLoading: boolean;
  hasSessionDetails: boolean;
  loadError?: AgentSessionLoadError | null;
  contentRevision: number;
  displayError?: string | null;
  canRetryInitial?: boolean;
  onReload?: () => void | Promise<void>;
  onBack?: () => void;
  onRespondInteraction: (interactionId: string, response: unknown) => void | Promise<void>;
  onRetryInitial?: () => void | Promise<void>;
  onDismissError: () => void;
  onPointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
}

/**
 * V2 semantic Work chat transcript (task 11). Renders directly from the canonical
 * Turn[] projection — one user bubble (when the prompt was observed live) plus one
 * `TurnWorkPanelV2` per turn. No provider payloads, no command parsing: everything
 * rendered here is already-classified server evidence.
 */
export const AgentSessionTranscriptV2 = forwardRef<AgentSessionTranscriptV2Handle, AgentSessionTranscriptV2Props>(
  function AgentSessionTranscriptV2(
    {
      turns,
      optimisticUserMessage,
      isLoading,
      hasSessionDetails,
      loadError,
      contentRevision,
      displayError,
      canRetryInitial = false,
      onReload,
      onBack,
      onRespondInteraction,
      onRetryInitial,
      onDismissError,
      onPointerDown,
    },
    ref,
  ) {
    const scrollContentKey = `${contentRevision}|${turns.length}|${isLoading}|${displayError ?? ''}`;

    const { containerRef, isFollowing, hasUnseenContent, scrollToBottom } = useScrollFollow({
      contentKey: scrollContentKey,
    });

    useImperativeHandle(ref, () => ({ scrollToBottom: (behavior?: ScrollBehavior) => scrollToBottom(behavior) }), [
      scrollToBottom,
    ]);

    return (
      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-5 sm:px-6"
      >
        <div className="mx-auto max-w-4xl space-y-5">
          {loadError && !hasSessionDetails && (
            <div className="py-16 text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-status-error/25 bg-status-error/10 text-status-error">
                <AlertTriangle className="size-6" />
              </div>
              <h2 className="mt-4 text-base font-semibold text-fg-primary">{loadError.title}</h2>
              <p className="mx-auto mt-2 max-w-md text-xs text-fg-muted">
                {loadError.message || 'Wystąpił nieoczekiwany błąd podczas wczytywania sesji.'}
              </p>
              <div className="mt-6 flex items-center justify-center gap-3">
                {onReload && (
                  <Button variant="default" size="sm" onClick={() => void onReload()}>
                    <RefreshCw className="mr-1.5 size-3.5" />
                    Spróbuj ponownie
                  </Button>
                )}
                {onBack && (
                  <Button variant="ghost" size="sm" onClick={onBack}>
                    <ArrowLeft className="mr-1.5 size-3.5" />
                    Wróć do specyfikacji
                  </Button>
                )}
              </div>
            </div>
          )}

          {isLoading && !hasSessionDetails && !loadError && (
            <div className="py-20 text-center">
              <LoaderCircle className="mx-auto size-7 animate-spin text-accent" />
              <p className="mt-3 text-xs text-fg-muted">Wczytywanie sesji czatu...</p>
            </div>
          )}

          {!isLoading && !loadError && turns.length === 0 && (
            <div className="py-20 text-center text-xs text-fg-muted">
              <p className="font-semibold text-fg-primary">Brak wiadomości w sesji</p>
              <p className="mt-1">Wpisz pierwszą wiadomość, aby rozpocząć konwersację z agentem.</p>
            </div>
          )}

          {/* Chronological UserMessage -> Work -> FinalAnswer per turn, one turn after
              another — the canonical conversation structure. `turn.userMessage` is the
              sole source for the chat bubble; it is present on every turn (live,
              reloaded, or migrated from legacy persistence), so this renders identically
              regardless of how the page was loaded. */}
          {turns.map((turn) => (
            <div key={turn.id} className="w-full min-w-0 space-y-1.5">
              {turn.userMessage && <UserMessageBubble text={turn.userMessage.text} />}
              <TurnWorkPanelV2 turn={turn} onRespondInteraction={onRespondInteraction} />
            </div>
          ))}

          {optimisticUserMessage && (
            <div className="w-full min-w-0 space-y-1.5">
              <UserMessageBubble text={optimisticUserMessage} />
              <div className="flex items-center gap-2 pl-1 text-xs text-fg-muted" role="status">
                <LoaderCircle className="size-3.5 shrink-0 animate-spin text-accent" />
                <span>Starting…</span>
              </div>
            </div>
          )}

          {displayError && (
            <div
              className={cn(
                'flex items-start gap-3 rounded-xl p-3.5 text-xs',
                displayError.toLowerCase().includes('cancelled')
                  ? 'border border-border bg-surface text-fg-muted'
                  : 'border border-status-error/25 bg-status-error/10 text-status-error',
              )}
            >
              <AlertTriangle
                className={cn(
                  'mt-0.5 size-4 shrink-0',
                  displayError.toLowerCase().includes('cancelled') ? 'text-fg-muted' : 'text-status-error',
                )}
              />
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    'font-semibold',
                    displayError.toLowerCase().includes('cancelled') ? 'text-fg-primary' : 'text-status-error',
                  )}
                >
                  {displayError.toLowerCase().includes('cancelled') ? 'Generowanie przerwane' : 'Komunikat agenta'}
                </p>
                <p className="mt-1 font-mono text-[11px] whitespace-pre-wrap opacity-90">{displayError}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {canRetryInitial && onRetryInitial && (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => void onRetryInitial()}
                    className="h-7 gap-1.5 px-2.5 text-xs font-medium"
                  >
                    <RefreshCw className="size-3" />
                    Ponów próbę
                  </Button>
                )}
                <button
                  type="button"
                  onClick={onDismissError}
                  className="rounded px-1.5 py-0.5 text-[10px] opacity-70 hover:bg-fg-primary/10 hover:opacity-100"
                >
                  Zamknij
                </button>
              </div>
            </div>
          )}

          {hasUnseenContent && !isFollowing && (
            <div className="sticky bottom-3 z-20 flex justify-center">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => scrollToBottom('smooth')}
                className="gap-1.5 rounded-full border border-border bg-surface-raised/95 px-3.5 py-1.5 text-xs font-medium text-fg-primary shadow-lg backdrop-blur-sm transition-all hover:bg-surface-hover"
              >
                <ChevronDown className="size-3.5" />
                Nowe wiadomości
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  },
);
