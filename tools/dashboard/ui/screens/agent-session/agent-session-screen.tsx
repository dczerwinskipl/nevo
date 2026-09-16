import { useNavigate, useRouter } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/shared/ui/button';
import { StatusCard } from '@/shared/ui/status-card';
import { LoadingScreen } from '@/shared/ui/loading-screen';
import { useSpecificationIndex } from '@/features/specifications/queries';
import { isSpecificationSource, type SpecificationSummary } from '@/features/specifications/types';
import type { AgentSession, TaskNavigationTarget } from '@/features/agent-sessions/types';
import { useAgentSessions } from '@/features/agent-sessions/queries';
import { AgentSessionPage } from '@/features/agent-sessions/agent-session-page';
import { AgentSessionList } from '@/features/agent-sessions/agent-session-list';
import { TaskDialog } from '@/features/specifications/tasks/task-dialog';
import { useSpecificationActions } from '@/features/specifications/detail/spec-detail-queries';

export interface AgentSessionScreenProps {
  source: string;
  slug: string;
  /** Canonical Nevo sessionId — the sole application identity (see owner-decisions.md D9). */
  sessionId: string;
}

export function AgentSessionScreen({ source: rawSource, slug, sessionId }: AgentSessionScreenProps) {
  const source: 'active' | 'archive' | null = isSpecificationSource(rawSource) ? rawSource : null;

  const { data, loading: dataLoading, error: dataError } = useSpecificationIndex();
  const navigate = useNavigate();
  const [inspectedTaskId, setInspectedTaskId] = useState<string | null>(null);

  useEffect(() => {
    if (source === null) {
      navigate({
        to: '/specs/$source/$slug/sessions/$sessionId',
        params: { source: 'active', slug, sessionId },
        replace: true,
      });
    }
  }, [source, navigate, slug, sessionId]);

  const selectedSpec = useMemo(() => {
    if (!data || source === null) return null;
    const collection = source === 'active' ? data.active : data.archive;
    return collection.find((c) => c.slug === slug) ?? null;
  }, [data, source, slug]);

  const fallbackSpec = useMemo(() => {
    if (!data || selectedSpec || source === null) return null;
    const oppositeSource = source === 'active' ? 'archive' : 'active';
    const oppositeCollection = source === 'active' ? data.archive : data.active;
    const match = oppositeCollection.find((c) => c.slug === slug);
    return match ? { specification: match, oppositeSource } : null;
  }, [data, selectedSpec, source, slug]);

  useEffect(() => {
    if (fallbackSpec) {
      navigate({
        to: '/specs/$source/$slug/sessions/$sessionId',
        params: {
          source: fallbackSpec.oppositeSource,
          slug,
          sessionId,
        },
        replace: true,
      });
    }
  }, [fallbackSpec, navigate, slug, sessionId]);

  const effectiveSpec = selectedSpec || fallbackSpec?.specification || null;
  const effectiveSource: 'active' | 'archive' = effectiveSpec?.source || source || 'active';

  const specId = effectiveSpec?.specId ?? null;
  const sessionsQuery = useAgentSessions({
    specId: specId || undefined,
    enabled: Boolean(specId),
  });

  // Owned at the screens layer (not inside AgentSessionPage itself): the authoritative
  // per-task workflow projection and specification-level workflow mode (D15) both cross
  // feature boundaries (specifications), which the agent-sessions feature must not
  // import directly (see tests/architecture-boundaries.test.mjs). This composition
  // belongs here.
  const actionsQuery = useSpecificationActions(
    { slug: effectiveSpec?.slug || '', source: 'active' } as SpecificationSummary,
    Boolean(effectiveSpec?.slug),
  );

  // The canonical sessionId is the sole application identity for lookup — no provider
  // fallback chain and no matching against a legacy provider-native id.
  const session = useMemo(() => {
    return sessionsQuery.sessions.find((s) => s.sessionId === sessionId) ?? null;
  }, [sessionsQuery.sessions, sessionId]);

  const router = useRouter();

  const handleBack = useCallback(() => {
    if (
      router.history.canGoBack?.() ||
      (router.history.length > 1 && typeof (router.history as any).canGoBack !== 'function')
    ) {
      router.history.back();
    } else {
      navigate({
        to: '/specs/$source/$slug',
        params: { source: effectiveSource, slug },
        replace: true,
      });
    }
  }, [navigate, router, slug, effectiveSource]);

  const handleSwitchSession = useCallback(
    (targetSession: AgentSession) => {
      navigate({
        to: '/specs/$source/$slug/sessions/$sessionId',
        params: {
          source: effectiveSource,
          slug,
          sessionId: targetSession.sessionId,
        },
        replace: true,
      });
    },
    [navigate, slug, effectiveSource],
  );

  if (source === null) return <LoadingScreen />;
  if (dataLoading && !data) return <LoadingScreen />;
  if (dataError && !data) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-status-error">{dataError}</div>;
  }

  if (data && !effectiveSpec) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-6">
        <StatusCard
          variant="info"
          title="Specyfikacja nie znaleziona"
          description={`Nie znaleziono specyfikacji '${slug}' w sekcji ${source === 'active' ? 'aktywnych' : 'archiwum'}.`}
          onRetry={() => navigate({ to: source === 'active' ? '/' : '/archive' })}
          retryLabel={source === 'active' ? 'Wróć do listy specyfikacji' : 'Wróć do archiwum'}
          className="w-full text-left"
        />
      </div>
    );
  }

  if (sessionsQuery.loading && !sessionsQuery.data) return <LoadingScreen />;

  if (sessionsQuery.error && !sessionsQuery.data) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-6">
        <StatusCard
          variant="error"
          title="Nie udało się wczytać sesji specyfikacji"
          description={sessionsQuery.error}
          onRetry={() => void sessionsQuery.refresh()}
          retryLabel="Spróbuj ponownie"
          className="w-full text-left"
        >
          <div className="mt-3">
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2 text-xs text-fg-muted hover:text-fg-primary"
              onClick={handleBack}
            >
              Wróć do specyfikacji
            </Button>
          </div>
        </StatusCard>
      </div>
    );
  }

  if (sessionsQuery.data && !session) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-6">
        <StatusCard
          variant="info"
          title="Sesja nie znaleziona"
          description={`Nie znaleziono sesji '${sessionId}' w specyfikacji '${effectiveSpec?.title || slug}'.`}
          onRetry={handleBack}
          retryLabel="Wróć do specyfikacji"
          className="w-full text-left"
        />
      </div>
    );
  }

  if (!effectiveSpec || !session) {
    return <LoadingScreen />;
  }

  return (
    <AgentSessionPage
      key={session.sessionId}
      spec={effectiveSpec}
      session={session}
      onBack={handleBack}
      backLabel="Wróć do specyfikacji"
      onSwitchSession={handleSwitchSession}
      isDeterministic={actionsQuery.data?.workflowMode === 'deterministic'}
      taskActions={actionsQuery.data?.tasks}
      onRefreshTaskActions={actionsQuery.refresh}
      onInspectTask={(target) => {
        const taskId = typeof target === 'string' ? target : target.taskId;
        setInspectedTaskId(taskId);
      }}
      taskOverlay={
        inspectedTaskId && effectiveSpec ? (
          <TaskDialog
            specification={effectiveSpec}
            taskId={inspectedTaskId}
            onClose={() => setInspectedTaskId(null)}
            sessionsContent={
              <AgentSessionList
                sessions={sessionsQuery.sessions.filter(
                  (s) => (s.taskIds && s.taskIds.includes(inspectedTaskId)) || s.taskId === inspectedTaskId,
                )}
                tasks={effectiveSpec.tasks}
                loading={sessionsQuery.loading}
                error={sessionsQuery.error}
                onRetry={() => void sessionsQuery.refresh()}
                onOpen={(s) => {
                  handleSwitchSession(s);
                  setInspectedTaskId(null);
                }}
                onOpenTask={(target) => {
                  const nextTaskId = typeof target === 'string' ? target : target.taskId;
                  setInspectedTaskId(nextTaskId);
                }}
                emptyLabel="To zadanie nie ma jeszcze powiązanych sesji."
              />
            }
          />
        ) : null
      }
    />
  );
}
