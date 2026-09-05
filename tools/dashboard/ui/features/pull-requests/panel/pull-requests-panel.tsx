import { ArrowLeft, GitPullRequest, LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { SpecificationSummary } from '@/features/specifications/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { StatusCard, RetryButton } from '@/components/ui/status-card';
import { usePullRequests } from '../queries';
import type { DiffViewMode } from '../changes/file-change';
import { PullRequestCard } from '../detail/pull-request-detail';
import { PullRequestSummaryCard, UnavailableCard } from '../detail/pull-request-cards';
import { pullRequestKey } from '../changes/status';

function DiffModeControl({ mode, onChange }: { mode: DiffViewMode; onChange: (mode: DiffViewMode) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-background p-0.5" aria-label="Układ diffu">
      {(['split', 'unified'] as const).map((option) => (
        <button
          key={option}
          type="button"
          className={cn(
            'rounded-md px-2.5 py-1 text-[10px] font-semibold transition-colors',
            mode === option ? 'bg-surface-hover text-fg-primary' : 'text-fg-muted hover:text-fg-primary',
          )}
          aria-pressed={mode === option}
          onClick={() => onChange(option)}
        >
          {option === 'split' ? 'Podzielony' : 'Ujednolicony'}
        </button>
      ))}
    </div>
  );
}

export function PullRequestsPanel({ specification }: { specification: SpecificationSummary }) {
  const query = usePullRequests(specification, true);
  const [mode, setMode] = useState<DiffViewMode>(() =>
    typeof window !== 'undefined' && window.matchMedia('(min-width: 1100px)').matches ? 'split' : 'unified',
  );
  const [modeOverridden, setModeOverridden] = useState(false);
  const [selectedPullRequestKey, setSelectedPullRequestKey] = useState<string | null>(null);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1100px)');
    const update = () => {
      if (!modeOverridden) setMode(media.matches ? 'split' : 'unified');
    };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [modeOverridden]);

  useEffect(() => {
    setSelectedPullRequestKey(null);
  }, [specification.id, specification.source]);

  if (query.loading) {
    return (
      <Card className="p-8" role="status">
        <div className="flex items-center gap-3 text-sm text-fg-muted">
          <LoaderCircle className="size-4 animate-spin text-accent" /> Pobieranie zmian z providerów…
        </div>
      </Card>
    );
  }

  if (query.error) {
    return (
      <StatusCard
        variant="error"
        title="Nie udało się wczytać zmian"
        description={query.error}
        onRetry={() => void query.refresh()}
        retryLoading={query.refreshing}
      />
    );
  }

  if (!query.data?.pullRequests.length) {
    return (
      <Card className="flex min-h-56 flex-col items-center justify-center p-8 text-center">
        <GitPullRequest className="size-7 text-accent" />
        <h2 className="mt-4 text-sm font-semibold text-fg-primary">Brak przypiętych pull requestów</h2>
        <p className="mt-2 max-w-lg text-xs leading-5 text-fg-muted">
          Przypnij istniejący PR poleceniem{' '}
          <code className="rounded bg-background px-1.5 py-0.5">node tools/specs.mjs pull-request-add</code>, aby
          zobaczyć jego zmiany.
        </p>
      </Card>
    );
  }

  const pullRequests = query.data.pullRequests;
  const hasPullRequestList = pullRequests.length > 1;
  const selectedPullRequest = hasPullRequestList
    ? pullRequests.find((result) => pullRequestKey(result) === selectedPullRequestKey) || null
    : pullRequests[0];

  if (hasPullRequestList && !selectedPullRequest) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold tracking-[0.18em] text-accent uppercase">Pull requests</p>
            <h2 className="mt-1 text-lg font-semibold text-fg-primary">{pullRequests.length} pull requesty</h2>
            <p className="mt-1 text-xs text-fg-muted">Wybierz pull request, aby zobaczyć jego pliki i zmiany.</p>
          </div>
          <RetryButton
            size="icon"
            onClick={() => void query.refresh()}
            loading={query.refreshing}
            label="Odśwież pull requesty"
          />
        </div>

        <div className="space-y-3">
          {pullRequests.map((result) =>
            result.availability === 'available' ? (
              <PullRequestSummaryCard
                key={pullRequestKey(result)}
                pullRequest={result}
                onOpen={() => setSelectedPullRequestKey(pullRequestKey(result))}
              />
            ) : (
              <UnavailableCard key={pullRequestKey(result)} result={result} />
            ),
          )}
        </div>
      </div>
    );
  }

  const detailPullRequest = selectedPullRequest || pullRequests[0];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {hasPullRequestList ? (
          <Button variant="ghost" size="sm" className="-ml-2" onClick={() => setSelectedPullRequestKey(null)}>
            <ArrowLeft className="mr-2 size-3.5" /> Wróć do pull requestów
          </Button>
        ) : (
          <div>
            <p className="text-[10px] font-bold tracking-[0.18em] text-accent uppercase">Pull request</p>
            <h2 className="mt-1 text-lg font-semibold text-fg-primary">Zestaw zmian</h2>
          </div>
        )}
        <div className="flex items-center gap-2">
          {detailPullRequest.availability === 'available' && (
            <DiffModeControl
              mode={mode}
              onChange={(nextMode) => {
                setModeOverridden(true);
                setMode(nextMode);
              }}
            />
          )}
          <RetryButton
            size="icon"
            onClick={() => void query.refresh()}
            loading={query.refreshing}
            label="Odśwież pull requesty"
          />
        </div>
      </div>

      {detailPullRequest.availability === 'available' ? (
        <PullRequestCard specification={specification} pullRequest={detailPullRequest} mode={mode} />
      ) : (
        <UnavailableCard result={detailPullRequest} />
      )}
    </div>
  );
}
