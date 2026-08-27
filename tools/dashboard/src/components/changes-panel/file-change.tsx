import { DiffModeEnum, DiffView } from '@git-diff-view/react';
import '@git-diff-view/react/styles/diff-view-pure.css';
import { highlighter } from '@git-diff-view/lowlight';
import { ChevronDown, FileDiff, LoaderCircle, Minus, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { PullRequestFile, PullRequestFileManifestEntry } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { usePullRequestFileDiffs } from './changes-queries';
import type { FileDiffRequest } from './changes-queries';

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
  const oldFileName = file.status === 'added' ? null : (diff?.previousPath || file.path);
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

  return (
    <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <button
        type="button"
        className="flex w-full items-center gap-3 bg-[var(--surface-raised)] px-3 py-3 text-left transition-colors hover:bg-[var(--surface-hover)] sm:px-4"
        aria-expanded={open}
        onClick={() => {
          setOpen(prev => {
            const next = !prev;
            // Explicit user expansion: if diff not yet cached/loaded, jump the queue now.
            if (next && diff === undefined) {
              diffHandle.load(req).catch(() => {});
            }
            return next;
          });
        }}
      >
        <ChevronDown className={cn('size-3.5 shrink-0 text-[var(--accent)] transition-transform', !open && '-rotate-90')} />
        <FileDiff className="size-3.5 shrink-0 text-[var(--accent)]" />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--foreground)]" title={file.path}>
          {diff?.previousPath && diff.previousPath !== file.path ? `${diff.previousPath} → ${file.path}` : file.path}
        </span>
        <Badge className="hidden text-[9px] sm:inline-flex">{FILE_STATUS_LABELS[file.status]}</Badge>
        <span className="inline-flex items-center text-[10px] font-semibold text-[var(--success)]"><Plus className="size-3" />{file.additions}</span>
        <span className="inline-flex items-center text-[10px] font-semibold text-[var(--danger)]"><Minus className="size-3" />{file.deletions}</span>
      </button>

      {open && (
        diffItem.isError ? (
          <div className="border-t border-[var(--border)] px-4 py-7 text-center text-xs text-[var(--danger-strong)]">
            {diffItem.error?.message || 'Nie udało się wczytać diffu dla tego pliku.'}
          </div>
        ) : diff === undefined ? (
          <div className="flex items-center gap-2 border-t border-[var(--border)] px-4 py-7 text-center text-xs text-[var(--muted)]">
            <LoaderCircle className="size-3.5 animate-spin text-[var(--accent)]" /> Wczytywanie diffu…
          </div>
        ) : diff && diff.patchAvailable && diffViewData ? (
          <div className="nevo-diff-view max-w-full overflow-x-auto border-t border-[var(--border)]">
            <DiffView
              data={diffViewData}
              registerHighlighter={highlighter}
              diffViewMode={mode === 'split' ? DiffModeEnum.SplitGitHub : DiffModeEnum.Unified}
              diffViewTheme="dark"
              diffViewHighlight
              diffViewWrap={false}
              diffViewFontSize={12}
            />
          </div>
        ) : diff && contentUnchangedRename ? (
          <div className="border-t border-[var(--border)] px-4 py-7 text-center">
            <p className="text-xs font-semibold text-[var(--foreground)]">Plik przeniesiony bez zmian treści</p>
            <p className="mt-1 break-all font-mono text-[10px] leading-5 text-[var(--muted)]">
              {diff.previousPath} → {file.path}
            </p>
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
