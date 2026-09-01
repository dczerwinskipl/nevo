import { AlertTriangle, ArrowLeft, ChevronDown, LoaderCircle, RefreshCw } from 'lucide-react';
import { forwardRef, useImperativeHandle } from 'react';

import { Button } from '@/components/ui/button';
import { TurnWorkPanelV2 } from './turn-work-panel-v2';
import { useScrollFollow } from '../transcript/use-scroll-follow';
import { AgentSessionLoadError } from '../runtime/agent-session-transport';
import type { CanonicalTurnV2 } from '../types';
import { cn } from '@/lib/utils';

export interface AgentSessionTranscriptV2Handle {
  scrollToBottom: (behavior?: ScrollBehavior) => void;
}

export interface AgentSessionTranscriptV2Props {
  turns: CanonicalTurnV2[];
  turnPrompts: Record<string, { text: string; createdAt: string }>;
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
      turnPrompts,
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

    useImperativeHandle(ref, () => ({ scrollToBottom: (behavior?: ScrollBehavior) => scrollToBottom(behavior) }), [scrollToBottom]);

    return (
      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-5 sm:px-6"
      >
        <div className="mx-auto max-w-4xl space-y-5">
          {loadError && !hasSessionDetails && (
            <div className="py-16 text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-[var(--danger-border)] bg-[var(--danger-muted)] text-[var(--danger)]">
                <AlertTriangle className="size-6" />
              </div>
              <h2 className="mt-4 text-base font-semibold text-[var(--foreground)]">{loadError.title}</h2>
              <p className="mx-auto mt-2 max-w-md text-xs text-[var(--muted)]">
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
              <LoaderCircle className="mx-auto size-7 animate-spin text-[var(--accent)]" />
              <p className="mt-3 text-xs text-[var(--muted)]">Wczytywanie sesji czatu...</p>
            </div>
          )}

          {!isLoading && !loadError && turns.length === 0 && (
            <div className="py-20 text-center text-xs text-[var(--muted)]">
              <p className="font-semibold text-[var(--foreground)]">Brak wiadomości w sesji</p>
              <p className="mt-1">Wpisz pierwszą wiadomość, aby rozpocząć konwersację z agentem.</p>
            </div>
          )}

          {turns.map((turn) => {
            const prompt = turnPrompts[turn.id];
            return (
              <div key={turn.id} className="w-full min-w-0 space-y-1.5">
                {prompt && (
                  <div className="flex w-full min-w-0 justify-end">
                    <div className="w-fit max-w-[min(88%,820px)] rounded-2xl border border-[var(--border-strong)] bg-[var(--surface-raised)] px-4 py-3 text-sm leading-6 text-[var(--foreground)]">
                      <div className="whitespace-pre-wrap break-words">{prompt.text}</div>
                    </div>
                  </div>
                )}
                <TurnWorkPanelV2 turn={turn} onRespondInteraction={onRespondInteraction} />
              </div>
            );
          })}

          {displayError && (
            <div
              className={cn(
                'flex items-start gap-3 rounded-xl p-3.5 text-xs',
                displayError.toLowerCase().includes('cancelled')
                  ? 'border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]'
                  : 'border border-[var(--danger-border)] bg-[var(--danger-muted)] text-[var(--danger-strong)]',
              )}
            >
              <AlertTriangle
                className={cn(
                  'mt-0.5 size-4 shrink-0',
                  displayError.toLowerCase().includes('cancelled') ? 'text-[var(--muted)]' : 'text-[var(--danger)]',
                )}
              />
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    'font-semibold',
                    displayError.toLowerCase().includes('cancelled') ? 'text-[var(--foreground)]' : 'text-[var(--danger-strong)]',
                  )}
                >
                  {displayError.toLowerCase().includes('cancelled') ? 'Generowanie przerwane' : 'Komunikat agenta'}
                </p>
                <p className="mt-1 whitespace-pre-wrap font-mono text-[11px] opacity-90">{displayError}</p>
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
                  className="rounded px-1.5 py-0.5 text-[10px] opacity-70 hover:bg-white/10 hover:opacity-100"
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
                className="gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-raised)]/95 px-3.5 py-1.5 text-xs font-medium text-[var(--foreground)] shadow-lg backdrop-blur-sm transition-all hover:bg-[var(--surface-hover)]"
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
