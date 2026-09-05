import { useNavigate, useRouter } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { StatusCard } from '@/components/ui/status-card';
import { LoadingScreen } from '@/shared/ui/loading-screen';
import { useSpecificationIndex } from '@/features/specifications/queries';
import type { AgentSession } from './types';
import { useAgentSessions } from './queries';
import { AgentSessionPage } from './agent-session-page';

export interface AgentSessionRouteProps {
  source: string;
  slug: string;
  provider: string;
  providerSessionId: string;
}

/**
 * Agent Session route (`/specs/:source/:slug/sessions/:provider/:providerSessionId`):
 * resolves the owning specification (via the Specifications feature's own index
 * query — AgentSession belongs to / is attached to a Specification) and the
 * session itself, then hands off to `AgentSessionPage`.
 */
export function AgentSessionRoute({ source: rawSource, slug, provider, providerSessionId }: AgentSessionRouteProps) {
  const source: 'active' | 'archive' = rawSource === 'archive' ? 'archive' : 'active';

  const { data, loading: dataLoading, error: dataError } = useSpecificationIndex();
  const navigate = useNavigate();

  const selectedSpec = useMemo(() => {
    if (!data) return null;
    const collection = source === 'active' ? data.active : data.archive;
    return collection.find((c) => c.slug === slug) ?? null;
  }, [data, source, slug]);

  const fallbackSpec = useMemo(() => {
    if (!data || selectedSpec) return null;
    const oppositeSource = source === 'active' ? 'archive' : 'active';
    const oppositeCollection = source === 'active' ? data.archive : data.active;
    const match = oppositeCollection.find((c) => c.slug === slug);
    return match ? { specification: match, oppositeSource } : null;
  }, [data, selectedSpec, source, slug]);

  useEffect(() => {
    if (fallbackSpec) {
      navigate({
        to: '/specs/$source/$slug/sessions/$provider/$providerSessionId',
        params: {
          source: fallbackSpec.oppositeSource,
          slug,
          provider,
          providerSessionId,
        },
        replace: true,
      });
    }
  }, [fallbackSpec, navigate, provider, providerSessionId, slug]);

  const effectiveSpec = selectedSpec || fallbackSpec?.specification || null;
  const effectiveSource = effectiveSpec?.source || source;

  const specId = effectiveSpec?.specId ?? null;
  const sessionsQuery = useAgentSessions({
    specId: specId || undefined,
    enabled: Boolean(specId),
  });

  const session = useMemo(() => {
    return (
      sessionsQuery.sessions.find((s) => s.provider === provider && s.providerSessionId === providerSessionId) ?? null
    );
  }, [sessionsQuery.sessions, provider, providerSessionId]);

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
        to: '/specs/$source/$slug/sessions/$provider/$providerSessionId',
        params: {
          source: effectiveSource,
          slug,
          provider: targetSession.provider,
          providerSessionId: targetSession.providerSessionId,
        },
        replace: true,
      });
    },
    [navigate, slug, effectiveSource],
  );

  if (dataLoading && !data) return <LoadingScreen />;
  if (dataError && !data) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-status-error">{dataError}</div>;
  }

  // Spec Not Found in either collection
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

  // Fatal initial Sessions Query Error (error && !data)
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

  // Session Not Found in this spec
  if (sessionsQuery.data && !session) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-6">
        <StatusCard
          variant="info"
          title="Sesja nie znaleziona"
          description={`Nie znaleziono sesji '${providerSessionId}' (${provider}) w specyfikacji '${effectiveSpec?.title || slug}'.`}
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
      key={`${session.provider}:${session.providerSessionId}`}
      spec={effectiveSpec}
      session={session}
      onBack={handleBack}
      backLabel="Wróć do specyfikacji"
      onSwitchSession={handleSwitchSession}
    />
  );
}
