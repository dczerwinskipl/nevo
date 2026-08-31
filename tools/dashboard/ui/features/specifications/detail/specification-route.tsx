import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';

import { LoadingScreen } from '@/shared/ui/loading-screen';
import { StatusCard } from '@/components/ui/status-card';
import { CreateAgentSessionDialog } from '@/features/agent-sessions/create-agent-session-dialog';
import { queueAgentSessionInitialDispatch } from '@/features/agent-sessions/initial-dispatch';
import type { SpecificationSummary, SpecificationSource } from '../types';
import { useSpecificationIndex } from '../queries';
import { SpecificationDetail } from './specification-detail';

export interface SpecificationRouteProps {
  source: string;
  slug: string;
}

/**
 * Specification detail route (`/specs/:source/:slug`): resolves the specification from
 * the Specifications index, redirects on a source mismatch (active/archive
 * fallback), and hosts spec-scoped Agent Session creation.
 */
export function SpecificationRoute({ source: rawSource, slug }: SpecificationRouteProps) {
  const source: SpecificationSource = rawSource === 'archive' ? 'archive' : 'active';

  const { data, loading, error, refresh } = useSpecificationIndex();
  const navigate = useNavigate();
  const [sessionSpecification, setSessionSpecification] = useState<SpecificationSummary | null>(null);

  const selected = useMemo(() => {
    if (!data) return null;
    const collection = source === 'active' ? data.active : data.archive;
    return collection.find((c) => c.slug === slug) ?? null;
  }, [data, source, slug]);

  const fallbackSpec = useMemo(() => {
    if (!data || selected) return null;
    const oppositeSource: SpecificationSource = source === 'active' ? 'archive' : 'active';
    const oppositeCollection = source === 'active' ? data.archive : data.active;
    const match = oppositeCollection.find((c) => c.slug === slug);
    return match ? { specification: match, oppositeSource } : null;
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

  const effectiveSpec = selected || fallbackSpec?.specification || null;

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
        specification={effectiveSpec}
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
        onCreateSession={() => setSessionSpecification(effectiveSpec)}
        onNavigateMode={(m) => navigate({ to: m === 'archive' ? '/archive' : '/' })}
      />
      {sessionSpecification && (
        <CreateAgentSessionDialog
          specification={sessionSpecification}
          onClose={() => setSessionSpecification(null)}
          onCreated={(session, initialMessage) => {
            const targetSpecification = sessionSpecification;
            setSessionSpecification(null);
            if (initialMessage) {
              queueAgentSessionInitialDispatch({
                provider: session.provider,
                providerSessionId: session.providerSessionId,
                prompt: initialMessage,
              });
            }
            navigate({
              to: '/specs/$source/$slug/sessions/$provider/$providerSessionId',
              params: {
                source: targetSpecification.source,
                slug: targetSpecification.slug,
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
