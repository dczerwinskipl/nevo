import { useEffect, useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';

import { isSpecificationSource, type SpecificationSource } from '@/features/specifications/types';
import { StatusCard } from '@/shared/ui/status-card';
import { LoadingScreen } from '@/shared/ui/loading-screen';
import { useSpecificationIndex } from '@/features/specifications/queries';
import { SpecificationDetailContent } from './specification-detail-content';

export interface SpecificationDetailScreenProps {
  source: string;
  slug: string;
}

export function SpecificationDetailScreen({ source: rawSource, slug }: SpecificationDetailScreenProps) {
  const source: SpecificationSource | null = isSpecificationSource(rawSource) ? rawSource : null;
  const navigate = useNavigate();

  useEffect(() => {
    if (source === null) {
      navigate({ to: '/specs/$source/$slug', params: { source: 'active', slug }, replace: true });
    }
  }, [source, navigate, slug]);

  const { data, loading: indexLoading, error: indexError, refresh: refreshIndex } = useSpecificationIndex();

  const selected = useMemo(() => {
    if (!data || source === null) return null;
    const collection = source === 'active' ? data.active : data.archive;
    return collection.find((c) => c.slug === slug) ?? null;
  }, [data, source, slug]);

  const fallbackSpec = useMemo(() => {
    if (!data || selected || source === null) return null;
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

  if (source === null) return <LoadingScreen />;
  if (indexLoading && !data) return <LoadingScreen />;
  if (indexError && !data) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-6">
        <StatusCard
          variant="error"
          title="Nie udało się wczytać specyfikacji"
          description={indexError}
          onRetry={() => void refreshIndex()}
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

  return <SpecificationDetailContent specification={effectiveSpec} />;
}
