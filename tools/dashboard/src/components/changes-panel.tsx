import { DiffModeEnum, DiffView } from '@git-diff-view/react';
import '@git-diff-view/react/styles/diff-view-pure.css';
import { highlighter } from '@git-diff-view/lowlight';
import {
  AlertTriangle,
  ChevronDown,
  ExternalLink,
  FileDiff,
  Files,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  LoaderCircle,
  Minus,
  Plus,
  RefreshCw,
  UserRound,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import type {
  AvailablePullRequest,
  DashboardChange,
  PullRequestFile,
  UnavailablePullRequest,
} from '@/lib/types';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { usePullRequests } from '@/hooks/use-dashboard-data';

type DiffViewMode = 'split' | 'unified';

const FILE_STATUS_LABELS: Record<PullRequestFile['status'], string> = {
  added: 'Dodany',
  removed: 'Usunięty',
  modified: 'Zmodyfikowany',
  renamed: 'Przeniesiony',
  copied: 'Skopiowany',
  changed: 'Zmieniony',
  unchanged: 'Bez zmian',
};

function stateLabel(pullRequest: AvailablePullRequest) {
  if (pullRequest.draft) return 'Draft';
  if (pullRequest.state === 'merged') return 'Merged';
  if (pullRequest.state === 'closed') return 'Closed';
  return 'Open';
}

function stateTone(pullRequest: AvailablePullRequest) {
  if (pullRequest.draft) return 'border-slate-400/20 bg-slate-400/8 text-slate-300';
  if (pullRequest.state === 'merged') return 'border-violet-400/25 bg-violet-400/10 text-violet-300';
  if (pullRequest.state === 'closed') return 'border-red-400/20 bg-red-400/8 text-red-300';
  return 'border-[color-mix(in_srgb,var(--accent)_25%,transparent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] text-[var(--accent)]';
}

function DiffModeControl({ mode, onChange }: { mode: DiffViewMode; onChange: (mode: DiffViewMode) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--background)] p-0.5" aria-label="Układ diffu">
      {(['split', 'unified'] as const).map(option => (
        <button
          key={option}
          type="button"
          className={cn(
            'rounded-md px-2.5 py-1 text-[10px] font-semibold transition-colors',
            mode === option ? 'bg-[var(--surface-hover)] text-[var(--foreground)]' : 'text-[var(--muted)] hover:text-[var(--foreground)]',
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

function FileChange({ file, mode }: { file: PullRequestFile; mode: DiffViewMode }) {
  const [open, setOpen] = useState(true);
  const oldFileName = file.status === 'added' ? null : (file.previousPath || file.path);
  const newFileName = file.status === 'removed' ? null : file.path;

  return (
    <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[#0b0d12]">
      <button
        type="button"
        className="flex w-full items-center gap-3 bg-[var(--surface-raised)] px-3 py-3 text-left transition-colors hover:bg-[var(--surface-hover)] sm:px-4"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <ChevronDown className={cn('size-3.5 shrink-0 text-[var(--muted)] transition-transform', !open && '-rotate-90')} />
        <FileDiff className="size-3.5 shrink-0 text-[var(--muted)]" />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--foreground)]" title={file.path}>
          {file.previousPath && file.previousPath !== file.path ? `${file.previousPath} → ${file.path}` : file.path}
        </span>
        <Badge className="hidden text-[9px] sm:inline-flex">{FILE_STATUS_LABELS[file.status]}</Badge>
        <span className="inline-flex items-center text-[10px] font-semibold text-emerald-300"><Plus className="size-3" />{file.additions}</span>
        <span className="inline-flex items-center text-[10px] font-semibold text-red-300"><Minus className="size-3" />{file.deletions}</span>
      </button>

      {open && (
        file.patchAvailable ? (
          <div className="nevo-diff-view max-w-full overflow-x-auto border-t border-[var(--border)]">
            <DiffView
              data={{
                oldFile: { fileName: oldFileName },
                newFile: { fileName: newFileName },
                hunks: [file.patch],
              }}
              registerHighlighter={highlighter}
              diffViewMode={mode === 'split' ? DiffModeEnum.SplitGitHub : DiffModeEnum.Unified}
              diffViewTheme="dark"
              diffViewHighlight
              diffViewWrap={false}
              diffViewFontSize={12}
            />
          </div>
        ) : (
          <div className="border-t border-[var(--border)] px-4 py-7 text-center">
            <p className="text-xs font-semibold text-[var(--foreground)]">Diff tego pliku jest niedostępny</p>
            <p className="mt-1 text-[10px] leading-5 text-[var(--muted)]">
              Plik może być binarny, zbyt duży albo provider nie zwrócił osobnego patcha. Statystyki pliku pozostają dostępne.
            </p>
          </div>
        )
      )}
    </section>
  );
}

function PullRequestCard({ pullRequest, mode }: { pullRequest: AvailablePullRequest; mode: DiffViewMode }) {
  const [open, setOpen] = useState(true);
  const incompleteDiff = !pullRequest.fullDiffAvailable
    || !pullRequest.filesComplete
    || pullRequest.files.some(file => !file.patchAvailable);

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-[var(--border)] bg-[var(--surface)] px-4 py-4 sm:px-6">
        <div className="flex items-start gap-3">
          <button
            type="button"
            className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
            aria-expanded={open}
            aria-label={`${open ? 'Zwiń' : 'Rozwiń'} pull request #${pullRequest.number}`}
            onClick={() => setOpen(value => !value)}
          >
            <ChevronDown className={cn('size-4 transition-transform', !open && '-rotate-90')} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={stateTone(pullRequest)}>{stateLabel(pullRequest)}</Badge>
              <span className="text-[11px] text-[var(--muted)]">{pullRequest.providerLabel} #{pullRequest.number}</span>
            </div>
            <h2 className="mt-2 text-base font-semibold leading-6 text-[var(--foreground)] sm:text-lg">{pullRequest.title}</h2>
          </div>
          <Button variant="secondary" size="sm" asChild>
            <a href={pullRequest.url} target="_blank" rel="noreferrer noopener">
              <span className="hidden sm:inline">Otwórz</span><ExternalLink className="size-3.5 sm:ml-2" />
            </a>
          </Button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[10px] text-[var(--muted)] sm:pl-11">
          {pullRequest.author && (
            <span className="inline-flex items-center gap-1.5"><UserRound className="size-3.5" />{pullRequest.author.login}</span>
          )}
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <GitBranch className="size-3.5 shrink-0" />
            <span className="max-w-44 truncate font-mono">{pullRequest.head.name || pullRequest.head.label || 'head'}</span>
            <span>→</span>
            <span className="max-w-44 truncate font-mono">{pullRequest.base.name || pullRequest.base.label || 'base'}</span>
          </span>
          <span className="inline-flex items-center gap-1.5"><GitCommitHorizontal className="size-3.5" />{pullRequest.stats.commits} commitów</span>
        </div>
      </div>

      {open && (
        <div className="px-3 py-4 sm:px-5 sm:py-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3 text-[11px]">
              <span className="inline-flex items-center gap-1.5 text-[var(--muted)]"><Files className="size-3.5" />{pullRequest.stats.changedFiles} plików</span>
              <span className="font-semibold text-emerald-300">+{pullRequest.stats.additions}</span>
              <span className="font-semibold text-red-300">−{pullRequest.stats.deletions}</span>
            </div>
          </div>

          {incompleteDiff && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300/15 bg-amber-300/6 px-3 py-2.5 text-[10px] leading-5 text-amber-100/80">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              Część diffu może być niedostępna lub skrócona przez providera. Lista plików i statystyki pozostają widoczne.
            </div>
          )}

          {pullRequest.files.length ? (
            <div className="space-y-3">
              {pullRequest.files.map(file => <FileChange key={`${file.previousPath || ''}:${file.path}`} file={file} mode={mode} />)}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-[var(--border)] px-5 py-10 text-center text-xs text-[var(--muted)]">
              Provider nie zwrócił listy zmienionych plików.
            </div>
          )}

          {incompleteDiff && pullRequest.fullDiffAvailable && (
            <details className="mt-4 overflow-hidden rounded-xl border border-[var(--border)] bg-[#080a0e]">
              <summary className="cursor-pointer bg-[var(--surface-raised)] px-4 py-3 text-[11px] font-semibold text-[var(--foreground)]">
                Pełny surowy diff z providera
              </summary>
              <pre className="max-h-[70vh] overflow-auto border-t border-[var(--border)] p-4 font-mono text-[11px] leading-5 text-[var(--muted-strong)]">
                {pullRequest.fullDiff}
              </pre>
            </details>
          )}
        </div>
      )}
    </Card>
  );
}

function UnavailableCard({ result }: { result: UnavailablePullRequest }) {
  return (
    <Card className="border-amber-300/15 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-amber-300/15 bg-amber-300/6 text-amber-200">
          <AlertTriangle className="size-4" />
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{result.reference.provider}</Badge>
            <span className="text-[11px] text-[var(--muted)]">{result.reference.repository} #{result.reference.number}</span>
          </div>
          <h2 className="mt-3 text-sm font-semibold text-[var(--foreground)]">
            {result.availability === 'unsupported' ? 'Provider nie jest jeszcze obsługiwany' : 'Nie udało się pobrać pull requesta'}
          </h2>
          <p className="mt-1 text-xs text-[var(--muted)]">{result.message}</p>
        </div>
      </div>
    </Card>
  );
}

export function ChangesPanel({ change }: { change: DashboardChange }) {
  const query = usePullRequests(change, true);
  const [mode, setMode] = useState<DiffViewMode>(() => (
    typeof window !== 'undefined' && window.matchMedia('(min-width: 1100px)').matches ? 'split' : 'unified'
  ));
  const [modeOverridden, setModeOverridden] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1100px)');
    const update = () => { if (!modeOverridden) setMode(media.matches ? 'split' : 'unified'); };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [modeOverridden]);

  if (query.loading) {
    return (
      <Card className="p-8" role="status">
        <div className="flex items-center gap-3 text-sm text-[var(--muted)]">
          <LoaderCircle className="size-4 animate-spin text-[var(--accent)]" /> Pobieranie zmian z providerów…
        </div>
      </Card>
    );
  }

  if (query.error) {
    return (
      <Card className="border-red-400/20 p-8">
        <AlertTriangle className="size-5 text-red-300" />
        <h2 className="mt-4 text-sm font-semibold text-[var(--foreground)]">Nie udało się wczytać zmian</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">{query.error}</p>
        <Button variant="secondary" size="sm" className="mt-4" onClick={() => void query.refresh()}>
          <RefreshCw className="mr-2 size-3.5" /> Spróbuj ponownie
        </Button>
      </Card>
    );
  }

  if (!query.data?.pullRequests.length) {
    return (
      <Card className="flex min-h-56 flex-col items-center justify-center p-8 text-center">
        <GitPullRequest className="size-7 text-[var(--muted)]" />
        <h2 className="mt-4 text-sm font-semibold text-[var(--foreground)]">Brak przypiętych pull requestów</h2>
        <p className="mt-2 max-w-lg text-xs leading-5 text-[var(--muted)]">
          Przypnij istniejący PR poleceniem <code className="rounded bg-[var(--background)] px-1.5 py-0.5">node tools/specs.mjs pull-request-add</code>, aby zobaczyć jego zmiany.
        </p>
      </Card>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--accent)]">Pull requests</p>
          <h2 className="mt-1 text-lg font-semibold text-[var(--foreground)]">
            {query.data.pullRequests.length} {query.data.pullRequests.length === 1 ? 'zestaw zmian' : 'zestawy zmian'}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <DiffModeControl mode={mode} onChange={nextMode => { setModeOverridden(true); setMode(nextMode); }} />
          <Button variant="ghost" size="icon" onClick={() => void query.refresh()} disabled={query.refreshing} aria-label="Odśwież pull requesty">
            <RefreshCw className={cn('size-4', query.refreshing && 'animate-spin')} />
          </Button>
        </div>
      </div>

      <div className="space-y-5">
        {query.data.pullRequests.map((result, index) => (
          result.availability === 'available'
            ? <PullRequestCard key={`${result.reference.provider}:${result.reference.repository}:${result.reference.number}`} pullRequest={result} mode={mode} />
            : <UnavailableCard key={`${result.reference.provider}:${result.reference.repository}:${result.reference.number}:${index}`} result={result} />
        ))}
      </div>
    </div>
  );
}
