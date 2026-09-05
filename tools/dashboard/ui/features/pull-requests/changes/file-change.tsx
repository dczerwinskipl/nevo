import { DiffModeEnum, DiffView } from '@git-diff-view/react';
import '@git-diff-view/react/styles/diff-view-pure.css';
import { highlighter } from '@git-diff-view/lowlight';
import { ChevronDown, FileDiff, LoaderCircle, Minus, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { PullRequestFile, PullRequestFileManifestEntry } from '../types';
import { cn } from '@/lib/utils';
import { Badge } from '@/shared/ui/badge';
import { usePullRequestFileDiffs } from '../queries';
import type { FileDiffRequest } from '../queries';

export type DiffViewMode = 'split' | 'unified';

export const FILE_STATUS_LABELS: Record<PullRequestFile['status'], string> = {
  added: 'Dodany',
  removed: 'Usunięty',
  modified: 'Zmodyfikowany',
  renamed: 'Przeniesiony',
  copied: 'Skopiowany',
  changed: 'Zmieniony',
  unchanged: 'Bez zmian',
};

export function isContentUnchangedRename(file: PullRequestFileManifestEntry, diff: PullRequestFile | null | undefined) {
  return file.status === 'renamed' && !!diff && !diff.patchAvailable && file.changes === 0;
}

function renderablePatch(diff: PullRequestFile, oldFileName: string | null, newFileName: string | null) {
  const oldPath = oldFileName ? `a/${oldFileName}` : '/dev/null';
  const newPath = newFileName ? `b/${newFileName}` : '/dev/null';
  return `--- ${oldPath}\n+++ ${newPath}\n${diff.patch}`;
}

// The diff itself is hydrated progressively in the background, or on demand when
// the user explicitly expands a collapsed file.
export function FileChange({
  file,
  mode,
  initiallyOpen = true,
  diffHandle,
  req,
}: {
  file: PullRequestFileManifestEntry;
  mode: DiffViewMode;
  initiallyOpen?: boolean;
  diffHandle: ReturnType<typeof usePullRequestFileDiffs>;
  req: FileDiffRequest;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const diffItem = diffHandle.useItem(req);
  const diff = diffItem.data;
  const oldFileName = file.status === 'added' ? null : diff?.previousPath || file.path;
  const newFileName = file.status === 'removed' ? null : file.path;
  const contentUnchangedRename = isContentUnchangedRename(file, diff);

  const diffViewData = useMemo(() => {
    if (!diff || !diff.patchAvailable) return null;
    return {
      oldFile: { fileName: oldFileName },
      newFile: { fileName: newFileName },
      hunks: [renderablePatch(diff, oldFileName, newFileName)],
    };
  }, [diff, oldFileName, newFileName]);

  const handleToggle = () => {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen && !diff && !diffItem.isFetching) {
      void diffHandle.load(req);
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface transition-colors">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 bg-surface-raised px-4 py-3 text-left transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
        onClick={handleToggle}
        aria-expanded={open}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <ChevronDown
            className={cn('size-4 shrink-0 text-fg-muted transition-transform duration-200', !open && '-rotate-90')}
          />
          <span className="truncate font-mono text-xs font-semibold text-fg-primary" title={file.path}>
            {file.path}
          </span>
          {file.status !== 'modified' && (
            <Badge className="text-[10px] tracking-wider uppercase">
              {FILE_STATUS_LABELS[file.status] || file.status}
            </Badge>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3 font-mono text-xs">
          <div className="flex items-center gap-1.5 font-medium">
            {file.additions > 0 && (
              <span className="flex items-center text-diff-addition">
                <Plus className="size-3" />
                {file.additions}
              </span>
            )}
            {file.deletions > 0 && (
              <span className="flex items-center text-diff-deletion">
                <Minus className="size-3" />
                {file.deletions}
              </span>
            )}
          </div>
          {diffItem.isFetching && <LoaderCircle className="size-3.5 animate-spin text-accent" />}
        </div>
      </button>

      {open && (
        <div className="border-t border-border bg-background">
          {diffItem.isFetching && !diff ? (
            <div className="flex items-center justify-center gap-2 p-8 text-xs text-fg-muted">
              <LoaderCircle className="size-4 animate-spin text-accent" /> Ładowanie diffu…
            </div>
          ) : diffItem.isError && !diff ? (
            <div className="p-4 text-xs text-status-error">
              Nie udało się wczytać zawartości diffu: {diffItem.error?.message || 'Błąd sieci'}
            </div>
          ) : contentUnchangedRename ? (
            <div className="p-4 text-center text-xs text-fg-muted">Plik przeniesiony bez zmian w zawartości.</div>
          ) : diff && !diff.patchAvailable ? (
            <div className="p-4 text-center text-xs text-fg-muted">
              Diff niedostępny dla tego pliku (plik binarny, wykluczony lub zbyt duży).
            </div>
          ) : diffViewData ? (
            <div className="overflow-x-auto font-mono text-xs">
              <DiffView
                data={diffViewData}
                diffViewMode={mode === 'split' ? DiffModeEnum.Split : DiffModeEnum.Unified}
                diffViewFontSize={12}
                diffViewHighlight
                registerHighlighter={highlighter}
              />
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 p-8 text-xs text-fg-muted">
              <FileDiff className="size-4 text-fg-muted" /> Brak zmian w pliku.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
