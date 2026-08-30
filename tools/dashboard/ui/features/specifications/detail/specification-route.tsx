import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';

import { LoadingScreen } from '@/components/loading-screen';
import { StatusCard } from '@/components/ui/status-card';
import { CreateAgentSessionDialog } from '@/features/agent-sessions/create-agent-session-dialog';
import { pendingDispatchStore } from '@/features/agent-sessions/runtime/pending-dispatch-store';
import { specRoute } from '@/router-tree';
import type { DashboardChange } from '../types';
import { useSpecificationIndex } from '../queries';
import { SpecificationDetail } from './specification-detail';

/**
 * Specification detail route (`/specs/:source/:slug`): resolves the change from
 * the Specifications index, redirects on a source mismatch (active/archive
 * fallback), and hosts spec-scoped Agent Session creation. The central router
 * only binds this component to `specRoute` — it owns no Specification logic itself.
 */
export function SpecificationRoute() {
  const params = specRoute.useParams();
  const source = params.source as 'active' | 'archive';
  const slug = params.slug;

  const { data, loading, error, refresh } = useSpecificationIndex();
  const navigate = useNavigate();
  const [createChange, setCreateChange] = useState<DashboardChange | null>(null);

  const selected = useMemo(() => {
    if (!data) return null;
    const collection = source === 'active' ? data.active : data.archive;
    return collection.find((c) => c.slug === slug) ?? null;
  }, [data, source, slug]);

  const fallbackSpec = useMemo(() => {
    if (!data || selected) return null;
    const oppositeSource = source === 'active' ? 'archive' : 'active';
    const oppositeCollection = source === 'active' ? data.archive : data.active;
    const match = oppositeCollection.find((c) => c.slug === slug);
    return match ? { change: match, oppositeSource } : null;
  }, [data, selected, source, slug]);

  useEffect(() => {
    if (fallbackSpec) {
      navigate({
        to: '/specs/$source/$slug',
        params: { source: fallbackSpec.oppositeSource, slug },
        replace: true,
      });
    }
  }, [fallbackSpec, navigate, slug]);

  const effectiveSpec = selected || fallbackSpec?.change || null;

  if (loading && !data) return <LoadingScreen />;
  if (error && !data) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-6">
        <StatusCard
          variant="error"
          title="Nie udało się wczytać specyfikacji"
          description={error}
          onRetry={() => void refresh()}
          retryLabel="Spróbuj ponownie"
          className="w-full text-left"
        />
      </div>
    );
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

  if (!effectiveSpec) {
    return <LoadingScreen />;
  }

  return (
    <>
      <SpecificationDetail
        change={effectiveSpec}
        onOpenSession={(session) => {
          navigate({
            to: '/specs/$source/$slug/sessions/$provider/$providerSessionId',
            params: {
              source: effectiveSpec.source,
              slug: effectiveSpec.slug,
              provider: session.provider,
              providerSessionId: session.providerSessionId,
            },
          });
        }}
        onCreateSession={() => setCreateChange(effectiveSpec)}
        onNavigateMode={(m) => navigate({ to: m === 'archive' ? '/archive' : '/' })}
      />
      {createChange && (
        <CreateAgentSessionDialog
          change={createChange}
          onClose={() => setCreateChange(null)}
          onCreated={(session, initialMessage) => {
            const targetChange = createChange;
            setCreateChange(null);
            if (initialMessage) {
              pendingDispatchStore.setPending(session.provider, session.providerSessionId, initialMessage);
            }
            navigate({
              to: '/specs/$source/$slug/sessions/$provider/$providerSessionId',
              params: {
                source: targetChange.source,
                slug: targetChange.slug,
                provider: session.provider,
                providerSessionId: session.providerSessionId,
              },
            });
          }}
        />
      )}
    </>
  );
}
