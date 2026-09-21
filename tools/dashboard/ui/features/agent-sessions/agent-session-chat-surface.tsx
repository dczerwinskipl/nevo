import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';

import { AgentSessionComposer } from './composer/agent-session-composer';
import { AgentSessionWorkflowBar, type BoundTaskInfo } from './agent-session-workflow-bar';
import { AgentSessionTranscript, type AgentSessionTranscriptHandle } from './work/agent-session-transcript';
import type { AgentSessionLoadError } from './runtime/agent-session-transport';
import type { AgentExecutionMode, CanonicalTurn } from './types';
import { Button } from '@/shared/ui/button';
import { cn } from '@/shared/lib/utils';
import { HumanStepSurface, type HumanStepInteractionDescriptor } from '@/shared/workflow/human-step-surface';
import { useAgentSessionHumanStepMutation } from './human-step-mutations';

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

  // Workflow experience & Task 20 generic actions
  /**
   * Authoritative specification-level workflow mode (D15) — never a session/UI
   * preference. A legacy session (`false`) renders a plain task-context selector with
   * no fabricated deterministic status/attempt/step; a deterministic session (`true`)
   * renders the full workflow bar and verification banner from server-projected state.
   */
  isDeterministic?: boolean;
  boundTasks?: BoundTaskInfo[];
  activeTaskId?: string | null;
  onSelectActiveTask?: (taskId: string) => void;
  availableActions?: string[];
  activeTaskAttempt?: number | null;
  onStartAgentStep?: (taskId: string) => void | Promise<void>;
  stepDescriptor?: { id: string | null; executor: string; purpose?: string | null; expectedWork?: any } | null;
  humanInteraction?: HumanStepInteractionDescriptor | null;
  specSlug?: string | null;
  onRefreshTaskActions?: () => Promise<unknown> | unknown;

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
      isDeterministic = false,
      boundTasks,
      activeTaskId,
      onSelectActiveTask,
      availableActions,
      activeTaskAttempt,
      onStartAgentStep,
      stepDescriptor,
      humanInteraction,
      specSlug,
      onRefreshTaskActions,
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
    const transcriptHandleRef = useRef<AgentSessionTranscriptHandle>(null);

    const humanStepMutation = useAgentSessionHumanStepMutation({
      slug: specSlug,
      taskId: activeTaskId,
      onSuccess: async () => {
        await onRefreshTaskActions?.();
        await onReload?.();
      },
    });

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
            {boundTasks && boundTasks.length > 0 && (
              <AgentSessionWorkflowBar
                tasks={boundTasks}
                activeTaskId={activeTaskId ?? null}
                onSelectTask={onSelectActiveTask}
                isDeterministic={isDeterministic}
              />
            )}

            {isDeterministic && activeTaskId && (
              <>
                {humanInteraction && (
                  <div className="mb-2 rounded-xl border border-border bg-surface-raised px-3.5 py-2.5">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-fg-primary">
                        Task {activeTaskId} · Human interaction
                        {activeTaskAttempt ? ` · Attempt ${activeTaskAttempt}` : ''}
                      </span>
                    </div>
                    <HumanStepSurface
                      interaction={humanInteraction}
                      loading={humanStepMutation.loading}
                      error={humanStepMutation.error}
                      onSubmit={async (result, feedback, artifacts) => {
                        await humanStepMutation.submit(result, feedback, artifacts);
                      }}
                    />
                  </div>
                )}

                {!humanInteraction && availableActions?.includes('start-step') && (
                  <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-border bg-surface-raised px-3.5 py-2">
                    <span className="text-xs font-medium text-fg-secondary">
                      {stepDescriptor?.purpose || stepDescriptor?.id || `Zadanie ${activeTaskId} jest gotowe do kolejnego kroku.`}
                    </span>
                    <Button
                      size="sm"
                      onClick={() => {
                        if (stepDescriptor?.executor === 'human') {
                          void humanStepMutation.start();
                        } else {
                          void onStartAgentStep?.(activeTaskId);
                        }
                      }}
                      className="h-7 cursor-pointer px-3 text-xs font-semibold"
                      aria-label={`Start step for task ${activeTaskId}`}
                    >
                      <span>Start</span>
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
            />
          </div>
        </footer>
      </div>
    );
  },
);
