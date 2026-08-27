import { AlertTriangle, ChevronDown, Eye, EyeOff, ExternalLink, Files, GitBranch, GitCommitHorizontal, Layers, List, LoaderCircle, UserRound } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import type { AvailablePullRequest, DashboardChange, PullRequestFileManifestEntry } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { computeVisibility, groupFiles } from './changes-grouping';
import type { GroupByMode } from './changes-grouping';
import { useFullDiff, usePullRequestFileDiffs, usePullRequestFiles, useProgressiveDiffPreload } from './changes-queries';
import type { FileDiffRequest } from './changes-queries';
import { FileChange, isContentUnchangedRename } from './file-change';
import type { DiffViewMode } from './file-change';
import { stateLabel, stateTone } from './pull-request-status';

const GROUP_MODE_OPTIONS: Array<{ id: GroupByMode; label: string; icon: typeof Layers }> = [
  { id: 'area', label: 'Obszar', icon: Layers },
  { id: 'flat', label: 'Płasko', icon: List },
];

// Isolated subscriber for incomplete diff alert to avoid re-rendering entire card
function IncompleteDiffIndicator({
  diffHandle,
  requests,
  filesByPath,
}: {
  diffHandle: ReturnType<typeof usePullRequestFileDiffs>;
  requests: FileDiffRequest[];
  filesByPath: Map<string, PullRequestFileManifestEntry>;
}) {
  const items = diffHandle.useItems(requests);
  const incomplete = requests.some((req, index) => {
    const file = filesByPath.get(req.path);
    const diff = items[index]?.data;
    return file && diff !== undefined && diff !== null && !diff.patchAvailable && !isContentUnchangedRename(file, diff);
  });

  if (!incomplete) return null;

  return (
    <div className="mb-4 flex items-start gap-2 rounded-lg border border-[color-mix(in_srgb,var(--warning)_15%,transparent)] bg-[color-mix(in_srgb,var(--warning)_6%,transparent)] px-3 py-2.5 text-[10px] leading-5 text-[color-mix(in_srgb,var(--warning)_80%,transparent)]">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      Część diffu może być niedostępna lub skrócona przez providera. Lista plików i statystyki pozostają widoczne.
    </div>
  );
}

export function PullRequestCard({ change, pullRequest, mode }: { change: DashboardChange; pullRequest: AvailablePullRequest; mode: DiffViewMode }) {
  const [open, setOpen] = useState(true);
  const [groupMode, setGroupMode] = useState<GroupByMode>('area');
  const [hideGenerated, setHideGenerated] = useState(true);
  const [openGroupNames, setOpenGroupNames] = useState<Set<string>>(() => new Set());
  const filesQuery = usePullRequestFiles(change, pullRequest, open);
  const files = filesQuery.data?.files ?? [];
  const filesByPath = useMemo(() => new Map(files.map((file) => [file.path, file])), [files]);

  const allPaths = useMemo(() => files.map((file) => file.path), [files]);
  const visibility = useMemo(
    () => computeVisibility(allPaths, filesQuery.data?.generatedFiles, hideGenerated),
    [allPaths, filesQuery.data?.generatedFiles, hideGenerated],
  );
  const generatedCount = useMemo(
    () => computeVisibility(allPaths, filesQuery.data?.generatedFiles, true).hiddenCount,
    [allPaths, filesQuery.data?.generatedFiles],
  );
  const groups = useMemo(
    () => groupFiles(visibility.visiblePaths, groupMode, filesQuery.data?.changeView),
    [visibility.visiblePaths, groupMode, filesQuery.data?.changeView],
  );

  const toggleGroup = useCallback((name: string) => {
    setOpenGroupNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const groupStats = useMemo(() => {
    const stats = new Map<string, { additions: number; deletions: number; count: number }>();
    for (const group of groups) {
      let additions = 0;
      let deletions = 0;
      for (const path of group.paths) {
        const file = filesByPath.get(path);
        if (file) {
          additions += file.additions;
          deletions += file.deletions;
        }
      }
      stats.set(group.name, { additions, deletions, count: group.paths.length });
    }
    return stats;
  }, [groups, filesByPath]);

  const diffHandle = usePullRequestFileDiffs(change, pullRequest);

  // Derive the FileDiffRequest for a manifest entry.
  const toRequest = useCallback(
    (file: { path: string }): FileDiffRequest => ({
      provider: pullRequest.reference.provider,
      baseUrl: pullRequest.reference.baseUrl,
      repository: pullRequest.reference.repository,
      number: pullRequest.number,
      headSha: pullRequest.headSha,
      path: file.path,
    }),
    [pullRequest],
  );

  // Priority-ordered visible requests (active group first, then other groups).
  const visibleDiffRequests = useMemo(() => {
    return groups.flatMap((group) =>
      group.paths
        .map((path) => filesByPath.get(path))
        .filter((file): file is PullRequestFileManifestEntry => Boolean(file))
        .map(toRequest),
    );
  }, [groups, filesByPath, toRequest]);

  // Progressive background hydration: preloads only the visible files of currently opened groups (or all in flat mode).
  const activePreloadRequests = useMemo(() => {
    if (groupMode === 'flat') return visibleDiffRequests;
    return groups
      .filter((g) => openGroupNames.has(g.name))
      .flatMap((g) =>
        g.paths
          .map((path) => filesByPath.get(path))
          .filter((file): file is PullRequestFileManifestEntry => Boolean(file))
          .map(toRequest),
      );
  }, [groupMode, visibleDiffRequests, groups, openGroupNames, filesByPath, toRequest]);

  useProgressiveDiffPreload(open, activePreloadRequests, diffHandle);

  const fullDiffQuery = useFullDiff(change, pullRequest);
  const collapseFilesInitially = files.length > 50;

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-[var(--border)] bg-[var(--surface)] px-4 py-4 sm:px-6">
        <div className="flex items-start gap-3">
          <button
            type="button"
            className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
            aria-expanded={open}
            aria-label={`${open ? 'Zwiń' : 'Rozwiń'} pull request #${pullRequest.number}`}
            onClick={() => setOpen((value) => !value)}
          >
            <ChevronDown className={cn('size-4 transition-transform', !open && '-rotate-90')} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={stateTone(pullRequest)}>{stateLabel(pullRequest)}</Badge>
              <span className="text-[11px] text-[var(--muted)]">
                {pullRequest.providerLabel} #{pullRequest.number}
              </span>
            </div>
            <h2 className="mt-2 text-base font-semibold leading-6 text-[var(--foreground)] sm:text-lg">
              {pullRequest.title}
            </h2>
          </div>
          <Button variant="secondary" size="sm" asChild>
            <a href={pullRequest.url} target="_blank" rel="noreferrer noopener">
              <span className="hidden sm:inline">Otwórz</span>
              <ExternalLink className="size-3.5 sm:ml-2" />
            </a>
          </Button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[10px] text-[var(--muted)] sm:pl-11">
          {pullRequest.author && (
            <span className="inline-flex items-center gap-1.5">
              <UserRound className="size-3.5" />
              {pullRequest.author.login}
            </span>
          )}
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <GitBranch className="size-3.5 shrink-0" />
            <span className="max-w-44 truncate font-mono">{pullRequest.head.name || pullRequest.head.label || 'head'}</span>
            <span>→</span>
            <span className="max-w-44 truncate font-mono">{pullRequest.base.name || pullRequest.base.label || 'base'}</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <GitCommitHorizontal className="size-3.5" />
            {pullRequest.stats.commits} commitów
          </span>
        </div>
      </div>

      {open && (
        <div className="px-3 py-4 sm:px-5 sm:py-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3 text-[11px]">
              <span className="inline-flex items-center gap-1.5 text-[var(--muted)]">
                <Files className="size-3.5" />
                {pullRequest.stats.changedFiles} plików
              </span>
              <span className="font-semibold text-[var(--success)]">+{pullRequest.stats.additions}</span>
              <span className="font-semibold text-[var(--danger)]">−{pullRequest.stats.deletions}</span>
              {collapseFilesInitially && <span className="text-[var(--muted)]">Duży PR — pliki domyślnie zwinięte</span>}
            </div>
          </div>

          {files.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--background)] p-0.5" aria-label="Grupowanie plików">
                {GROUP_MODE_OPTIONS.map((option) => {
                  const Icon = option.icon;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[10px] font-semibold transition-colors',
                        groupMode === option.id
                          ? 'bg-[var(--surface-hover)] text-[var(--foreground)]'
                          : 'text-[var(--muted)] hover:text-[var(--foreground)]',
                      )}
                      aria-pressed={groupMode === option.id}
                      onClick={() => setGroupMode(option.id)}
                    >
                      <Icon className="size-3" />
                      {option.label}
                    </button>
                  );
                })}
              </div>
              {generatedCount > 0 && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-[10px] font-semibold text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
                  aria-pressed={hideGenerated}
                  onClick={() => setHideGenerated((value) => !value)}
                >
                  {hideGenerated ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                  {hideGenerated
                    ? `${visibility.visibleCount} widocznych · ${visibility.hiddenCount} wygenerowanych ukrytych`
                    : `${generatedCount} wygenerowanych widocznych — kliknij, aby ukryć`}
                </button>
              )}
            </div>
          )}

          <IncompleteDiffIndicator diffHandle={diffHandle} requests={visibleDiffRequests} filesByPath={filesByPath} />

          {filesQuery.loading ? (
            <div className="flex items-center gap-2 rounded-xl border border-dashed border-[var(--border)] px-5 py-10 text-center text-xs text-[var(--muted)]">
              <LoaderCircle className="size-3.5 animate-spin text-[var(--accent)]" /> Wczytywanie listy plików…
            </div>
          ) : filesQuery.error ? (
            <div className="rounded-xl border border-[color-mix(in_srgb,var(--danger)_20%,transparent)] px-5 py-10 text-center text-xs text-[var(--danger-strong)]">
              {filesQuery.error}
            </div>
          ) : groups.length ? (
            <div className="space-y-4">
              {groups.map((group) => {
                const st = groupStats.get(group.name) || { additions: 0, deletions: 0, count: group.paths.length };
                const isGroupOpen = groupMode === 'flat' || openGroupNames.has(group.name);

                if (groupMode === 'flat') {
                  return (
                    <div key={group.name} className="space-y-3">
                      {group.paths.map((path) => {
                        const file = filesByPath.get(path);
                        if (!file) return null;
                        const req = toRequest(file);
                        return (
                          <FileChange
                            key={path}
                            file={file}
                            mode={mode}
                            initiallyOpen={!collapseFilesInitially}
                            diffHandle={diffHandle}
                            req={req}
                          />
                        );
                      })}
                    </div>
                  );
                }

                return (
                  <div key={group.name} className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--background)]">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 bg-[var(--surface-raised)] px-4 py-3 text-left transition-colors hover:bg-[var(--surface-hover)]"
                      aria-expanded={isGroupOpen}
                      onClick={() => toggleGroup(group.name)}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <ChevronDown
                          className={cn('size-3.5 shrink-0 text-[var(--accent)] transition-transform', !isGroupOpen && '-rotate-90')}
                        />
                        <span className="font-semibold text-xs text-[var(--foreground)] truncate">{group.name}</span>
                        <span className="text-[10px] text-[var(--muted)] font-mono">
                          {group.paths.length} {group.paths.length === 1 ? 'plik' : 'plików'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2.5 text-[10px] shrink-0 font-semibold">
                        <span className="text-[var(--success)]">+{st.additions}</span>
                        <span className="text-[var(--danger)]">−{st.deletions}</span>
                      </div>
                    </button>

                    {/* Do not render FileChange / DiffView for collapsed groups */}
                    {isGroupOpen && (
                      <div className="space-y-3 p-3 sm:p-4 border-t border-[var(--border)]">
                        {group.paths.map((path) => {
                          const file = filesByPath.get(path);
                          if (!file) return null;
                          const req = toRequest(file);
                          return (
                            <FileChange
                              key={path}
                              file={file}
                              mode={mode}
                              initiallyOpen={false}
                              diffHandle={diffHandle}
                              req={req}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-[var(--border)] px-5 py-10 text-center text-xs text-[var(--muted)]">
              {files.length ? 'Wszystkie pliki są ukryte — wyłącz filtr, aby je zobaczyć.' : 'Provider nie zwrócił listy zmienionych plików.'}
            </div>
          )}

          <details
            className="mt-4 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--background)]"
            onToggle={(event) => {
              if (event.currentTarget.open && !fullDiffQuery.loaded && !fullDiffQuery.loading) void fullDiffQuery.load();
            }}
          >
            <summary className="cursor-pointer bg-[var(--surface-raised)] px-4 py-3 text-[11px] font-semibold text-[var(--foreground)]">
              Pełny surowy diff z providera
            </summary>
            {fullDiffQuery.loading ? (
              <div className="flex items-center gap-2 border-t border-[var(--border)] px-4 py-6 text-xs text-[var(--muted)]">
                <LoaderCircle className="size-3.5 animate-spin text-[var(--accent)]" /> Wczytywanie pełnego diffu…
              </div>
            ) : fullDiffQuery.error ? (
              <div className="border-t border-[var(--border)] px-4 py-6 text-xs text-[var(--danger-strong)]">{fullDiffQuery.error}</div>
            ) : fullDiffQuery.data ? (
              <pre className="max-h-[70vh] overflow-auto border-t border-[var(--border)] p-4 font-mono text-[11px] leading-5 text-[var(--muted-strong)]">
                {fullDiffQuery.data.diffAvailable ? fullDiffQuery.data.diff : 'Provider nie zwrócił pełnego diffu.'}
              </pre>
            ) : null}
          </details>
        </div>
      )}
    </Card>
  );
}
