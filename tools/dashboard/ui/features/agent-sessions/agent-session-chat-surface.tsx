import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';

import { AgentSessionComposer } from './composer/agent-session-composer';
import {
  AgentSessionTranscriptV2,
  type AgentSessionTranscriptV2Handle,
} from './work-v2/agent-session-transcript-v2';
import type { AgentSessionLoadError } from './runtime/agent-session-transport';
import type { AgentExecutionMode, CanonicalTurnV2 } from './types';
import { cn } from '@/lib/utils';

export interface AgentSessionChatSurfaceHandle {
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  focusComposer: () => void;
}

export interface AgentSessionChatSurfaceProps {
  // Transcript data & state
  turns: CanonicalTurnV2[];
  optimisticUserMessage?: string | null;
  isLoading?: boolean;
  hasSessionDetails?: boolean;
  loadError?: AgentSessionLoadError | null;
  contentRevision?: number;
  displayError?: string | null;
  canRetryInitial?: boolean;

  // Composer data & state
  currentMode?: AgentExecutionMode;
  isRunning?: boolean;
  canCancel?: boolean;
  isProviderAvailable?: boolean;
  disabled?: boolean;
  placeholder?: string;

  // Layout & viewport
  keyboardOpen?: boolean;
  className?: string;

  // Callbacks
  onSend: (text: string) => void | Promise<void>;
  onCancel?: () => void;
  onModeChange?: (mode: AgentExecutionMode) => void;
  onRespondInteraction: (interactionId: string, response: unknown) => void | Promise<void>;
  onReload?: () => void | Promise<void>;
  onBack?: () => void;
  onRetryInitial?: () => void | Promise<void>;
  onDismissError?: () => void;
}

/**
 * Presentational composition point for the chat surface (transcript + composer).
 * Purely props/callback-driven: accepts explicit, serializable state (CanonicalTurnV2[],
 * execution mode, flags, handlers) with zero internal queries, SSE streams, router reads,
 * or context dependencies.
 */
export const AgentSessionChatSurface = forwardRef<AgentSessionChatSurfaceHandle, AgentSessionChatSurfaceProps>(
  function AgentSessionChatSurface(
    {
      turns,
      optimisticUserMessage,
      isLoading = false,
      hasSessionDetails = true,
      loadError = null,
      contentRevision = 0,
      displayError = null,
      canRetryInitial = false,
      currentMode = 'edit',
      isRunning = false,
      canCancel = false,
      isProviderAvailable = true,
      disabled = false,
      placeholder,
      keyboardOpen = false,
      className,
      onSend,
      onCancel,
      onModeChange,
      onRespondInteraction,
      onReload,
      onBack,
      onRetryInitial,
      onDismissError,
    },
    ref,
  ) {
    const composerTextareaRef = useRef<HTMLTextAreaElement>(null);
    const transcriptHandleRef = useRef<AgentSessionTranscriptV2Handle>(null);

    useImperativeHandle(
      ref,
      () => ({
        scrollToBottom: (behavior?: ScrollBehavior) => {
          transcriptHandleRef.current?.scrollToBottom(behavior);
        },
        focusComposer: () => {
          composerTextareaRef.current?.focus();
        },
      }),
      [],
    );

    const handleTranscriptPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null;
      const isInteractive = target?.closest(
        'button, a, input, textarea, select, [role="button"], summary, details, [data-interactive="true"]',
      );
      if (!isInteractive && composerTextareaRef.current && document.activeElement === composerTextareaRef.current) {
        composerTextareaRef.current.blur();
      }
    }, []);

    const handleSend = useCallback(
      async (text: string) => {
        transcriptHandleRef.current?.scrollToBottom('auto');
        await onSend(text);
      },
      [onSend],
    );

    return (
      <div className={cn('relative flex min-h-0 flex-1 flex-col overflow-hidden', className)}>
        <AgentSessionTranscriptV2
          ref={transcriptHandleRef}
          turns={turns}
          optimisticUserMessage={optimisticUserMessage}
          isLoading={isLoading}
          hasSessionDetails={hasSessionDetails}
          loadError={loadError}
          contentRevision={contentRevision}
          displayError={displayError}
          canRetryInitial={canRetryInitial}
          onReload={onReload}
          onBack={onBack}
          onRespondInteraction={onRespondInteraction}
          onRetryInitial={onRetryInitial}
          onDismissError={onDismissError || (() => {})}
          onPointerDown={handleTranscriptPointerDown}
        />

        <footer
          className={cn(
            'shrink-0 border-t border-[var(--border)] bg-[var(--background)] px-3 pt-2 sm:px-6',
            keyboardOpen ? 'pb-2' : 'pb-[max(0.5rem,env(safe-area-inset-bottom))]',
          )}
        >
          <div className="mx-auto max-w-4xl">
            <AgentSessionComposer
              textareaRef={composerTextareaRef}
              currentMode={currentMode}
              onModeChange={onModeChange || (() => {})}
              onSend={handleSend}
              onCancel={onCancel}
              isRunning={isRunning}
              canCancel={canCancel}
              isProviderAvailable={isProviderAvailable}
              disabled={disabled}
              placeholder={placeholder}
              loadError={loadError}
            />
          </div>
        </footer>
      </div>
    );
  },
);
