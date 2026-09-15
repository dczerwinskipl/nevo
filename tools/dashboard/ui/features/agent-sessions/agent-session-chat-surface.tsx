import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';

import { AgentSessionComposer } from './composer/agent-session-composer';
import { AgentSessionWorkflowBar, type BoundTaskInfo } from './agent-session-workflow-bar';
import { AgentSessionTranscript, type AgentSessionTranscriptHandle } from './work/agent-session-transcript';
import type { AgentSessionLoadError } from './runtime/agent-session-transport';
import type { AgentExecutionMode, CanonicalTurn } from './types';
import { Button } from '@/shared/ui/button';
import { cn } from '@/shared/lib/utils';

export interface AgentSessionChatSurfaceHandle {
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  focusComposer: () => void;
}

export interface AgentSessionChatSurfaceProps {
  // Transcript data & state
  turns: CanonicalTurn[];
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
  hasActiveTurn?: boolean;
  canCancel?: boolean;
  isProviderAvailable?: boolean;
  unavailableReason?: string;
  disabled?: boolean;
  placeholder?: string;

  // Workflow experience & Task 03 actions
  experienceMode?: 'classic' | 'deterministic';
  boundTasks?: BoundTaskInfo[];
  activeTaskId?: string | null;
  onSelectActiveTask?: (taskId: string) => void;
  availableActions?: string[];
  activeTaskAttempt?: number | null;
  onApproveTask?: (taskId: string) => void | Promise<void>;
  onStartReviewTask?: (taskId: string) => void | Promise<void>;
  onRequestChangesSubmit?: (taskId: string, feedback: string) => void | Promise<void>;
  /**
   * A one-shot navigation intent (e.g. from a task card's "Request changes" button) to
   * open the composer directly in `request-changes` mode without a second click. Applied
   * exactly once per mount via `onInitialActionModeConsumed`.
   */
  initialActionMode?: 'request-changes' | null;
  onInitialActionModeConsumed?: () => void;

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
 * Purely props/callback-driven: accepts explicit, serializable state (CanonicalTurn[],
 * readiness, active runtime status) and emits intent events (onSend, onCancel, onRespondInteraction, etc.)
 * with zero internal queries, SSE streams, router reads, or context dependencies.
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
      hasActiveTurn,
      canCancel = false,
      isProviderAvailable = true,
      unavailableReason,
      disabled = false,
      placeholder,
      experienceMode = 'deterministic',
      boundTasks,
      activeTaskId,
      onSelectActiveTask,
      availableActions,
      activeTaskAttempt,
      onApproveTask,
      onStartReviewTask,
      onRequestChangesSubmit,
      initialActionMode = null,
      onInitialActionModeConsumed,
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
    const [actionMode, setActionMode] = useState<'request-changes' | null>(null);
    const composerTextareaRef = useRef<HTMLTextAreaElement>(null);
    const transcriptHandleRef = useRef<AgentSessionTranscriptHandle>(null);

    // Only clear the action mode when the active task actually changes away from
    // whichever task it was opened for — not on the initial render, which would
    // otherwise race with (and immediately erase) an `initialActionMode` intent applied
    // by the effect below on that same first commit.
    const previousActiveTaskIdRef = useRef(activeTaskId);
    useEffect(() => {
      if (previousActiveTaskIdRef.current !== activeTaskId) {
        previousActiveTaskIdRef.current = activeTaskId;
        setActionMode(null);
      }
    }, [activeTaskId]);

    const appliedInitialActionModeRef = useRef(false);
    useEffect(() => {
      if (!appliedInitialActionModeRef.current && initialActionMode && activeTaskId) {
        appliedInitialActionModeRef.current = true;
        previousActiveTaskIdRef.current = activeTaskId;
        setActionMode(initialActionMode);
        onInitialActionModeConsumed?.();
      }
    }, [initialActionMode, activeTaskId, onInitialActionModeConsumed]);

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
        <AgentSessionTranscript
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
            'shrink-0 border-t border-border bg-background px-3 pt-2 sm:px-6',
            keyboardOpen ? 'pb-2' : 'pb-[max(0.5rem,env(safe-area-inset-bottom))]',
          )}
        >
          <div className="mx-auto max-w-4xl">
            {experienceMode === 'deterministic' && boundTasks && boundTasks.length > 0 && (
              <AgentSessionWorkflowBar
                tasks={boundTasks}
                activeTaskId={activeTaskId ?? null}
                onSelectTask={onSelectActiveTask}
              />
            )}

            {experienceMode === 'deterministic' && activeTaskId && availableActions && availableActions.length > 0 && (
              <>
                {(availableActions.includes('approve') || availableActions.includes('request-changes')) && (
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface-raised px-3.5 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-fg-primary">
                        Task {activeTaskId} · Human verification
                        {activeTaskAttempt ? ` · Attempt ${activeTaskAttempt}` : ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {availableActions.includes('approve') && (
                        <Button
                          size="sm"
                          onClick={() => onApproveTask?.(activeTaskId)}
                          className="h-7 cursor-pointer gap-1.5 px-3 text-xs font-semibold"
                          aria-label={`Approve task ${activeTaskId}`}
                        >
                          <CheckCircle2 className="size-3" />
                          <span>Approve</span>
                        </Button>
                      )}
                      {availableActions.includes('request-changes') && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setActionMode('request-changes')}
                          className="h-7 cursor-pointer border border-status-warning/40 px-3 text-xs font-semibold text-status-warning hover:bg-status-warning/10"
                          aria-label={`Request changes for task ${activeTaskId}`}
                        >
                          <span>Request changes</span>
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                {availableActions.includes('start-review') && !availableActions.includes('approve') && (
                  <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-border bg-surface-raised px-3.5 py-2">
                    <span className="text-xs font-medium text-fg-secondary">
                      Zadanie {activeTaskId} jest gotowe do weryfikacji.
                    </span>
                    <Button
                      size="sm"
                      onClick={() => onStartReviewTask?.(activeTaskId)}
                      className="h-7 cursor-pointer px-3 text-xs font-semibold"
                      aria-label={`Start review for task ${activeTaskId}`}
                    >
                      <span>Start review</span>
                    </Button>
                  </div>
                )}
              </>
            )}

            <AgentSessionComposer
              textareaRef={composerTextareaRef}
              currentMode={currentMode}
              onModeChange={onModeChange || (() => {})}
              onSend={handleSend}
              onCancel={onCancel}
              isRunning={isRunning}
              hasActiveTurn={hasActiveTurn}
              canCancel={canCancel}
              isProviderAvailable={isProviderAvailable}
              unavailableReason={unavailableReason}
              disabled={disabled}
              placeholder={placeholder}
              loadError={loadError}
              actionMode={actionMode}
              activeTaskId={activeTaskId}
              attemptNumber={activeTaskAttempt}
              onRequestChangesCancel={() => setActionMode(null)}
              onRequestChangesSubmit={async (feedback) => {
                if (activeTaskId) {
                  await onRequestChangesSubmit?.(activeTaskId, feedback);
                  setActionMode(null);
                }
              }}
            />
          </div>
        </footer>
      </div>
    );
  },
);
