import {
  BookOpenText,
  Boxes,
  ChevronRight,
  ClipboardCheck,
  FileCode2,
  FileText,
  Folder,
  GitPullRequest,
  LayoutDashboard,
  LoaderCircle,
  Scale,
  Workflow,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { useEffect, useMemo, useState } from 'react';

import type { DashboardChange, SpecificationManifest } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { StatusCard } from '@/components/ui/status-card';
import { MarkdownContent } from '@/components/markdown-content';
import { useSpecificationDocument } from './spec-detail-queries';
import { buildDocGroups, type DocItem } from './documentation-projection';

const ICON_MAP: Record<string, ComponentType<{ className?: string }>> = {
  LayoutDashboard,
  BookOpenText,
  Boxes,
  GitPullRequest,
  Workflow,
  Scale,
  ClipboardCheck,
  FileCode2,
  FileText,
  Folder,
};

function resolveTabIcon(iconName?: string, type?: string): ComponentType<{ className?: string }> {
  if (iconName && ICON_MAP[iconName]) return ICON_MAP[iconName];
  return type === 'directory' ? Boxes : BookOpenText;
}

function ContentLoading() {
  return (
    <Card className="p-8" role="status">
      <div className="flex items-center gap-3 text-sm text-[var(--muted)]">
        <LoaderCircle className="size-4 animate-spin text-[var(--accent)]" />
        Wczytywanie treści z plików specyfikacji…
      </div>
      <div className="mt-7 space-y-3 animate-pulse">
        <div className="h-7 w-2/5 rounded bg-white/8" />
        <div className="h-3 w-full rounded bg-white/5" />
        <div className="h-3 w-5/6 rounded bg-white/5" />
        <div className="h-24 rounded-xl bg-white/4" />
      </div>
    </Card>
  );
}

function ContentError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <StatusCard
      variant="error"
      title="Nie udało się wczytać treści dokumentu"
      description={message}
      onRetry={onRetry}
    />
  );
}

function EmptyDocument({ title, detail }: { title: string; detail: string }) {
  return (
    <Card className="flex min-h-48 flex-col items-center justify-center p-8 text-center">
      <FileCode2 className="size-6 text-[var(--accent)]" />
      <h2 className="mt-4 text-sm font-semibold text-[var(--foreground)]">{title}</h2>
      <p className="mt-2 max-w-md text-xs leading-5 text-[var(--muted)]">{detail}</p>
    </Card>
  );
}

export function DocumentationPanel({
  change,
  manifest,
  enabled,
}: {
  change: DashboardChange;
  manifest: SpecificationManifest | null | undefined;
  enabled: boolean;
}) {
  const groups = useMemo(() => buildDocGroups(manifest), [manifest]);

  const allDocs = useMemo<DocItem[]>(() => {
    return groups.flatMap((group) => group.items);
  }, [groups]);

  const [selectedDocId, setSelectedDocId] = useState<string | null>(() => allDocs[0]?.docId ?? null);

  useEffect(() => {
    if (allDocs.length > 0 && (!selectedDocId || !allDocs.some((d) => d.docId === selectedDocId))) {
      setSelectedDocId(allDocs[0].docId);
    }
  }, [allDocs, selectedDocId]);

  const selectedDoc = allDocs.find((d) => d.docId === selectedDocId) || allDocs[0] || null;

  const documentQuery = useSpecificationDocument(
    change,
    selectedDoc?.docId ?? null,
    enabled && Boolean(selectedDoc),
  );

  if (!allDocs.length) {
    return (
      <EmptyDocument
        title="Brak dokumentacji"
        detail="Ta specyfikacja nie zawiera jeszcze dodatkowych dokumentów."
      />
    );
  }

  return (
    <div className="grid w-full min-w-0 max-w-full items-start gap-6 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
      <nav aria-label="Spis dokumentów specyfikacji" className="min-w-0 space-y-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
        {groups.map((group) => {
          const GroupIcon = resolveTabIcon(group.icon, group.items.length > 1 ? 'directory' : 'document');
          return (
            <div key={group.id} className="space-y-1">
              <div className="flex items-center gap-2 px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">
                <GroupIcon className="size-3.5 text-[var(--accent)]" />
                <span>{group.label}</span>
                {group.items.length > 1 && (
                  <span className="ml-auto text-[10px] text-[var(--muted)] tabular-nums">
                    {group.items.length}
                  </span>
                )}
              </div>
              <div className="space-y-0.5 pl-2">
                {group.items.map((doc) => {
                  const isSelected = selectedDoc?.docId === doc.docId;
                  return (
                    <button
                      key={doc.docId}
                      type="button"
                      onClick={() => setSelectedDocId(doc.docId)}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors',
                        isSelected
                          ? 'bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] font-semibold text-[var(--foreground)] border border-[color-mix(in_srgb,var(--accent)_30%,transparent)]'
                          : 'text-[var(--muted-strong)] hover:bg-white/5 hover:text-[var(--foreground)]'
                      )}
                    >
                      <span className="truncate">{doc.title}</span>
                      {isSelected && <ChevronRight className="size-3 text-[var(--accent)] shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="w-full min-w-0 max-w-full">
        {documentQuery.loading ? (
          <ContentLoading />
        ) : documentQuery.error ? (
          <ContentError message={documentQuery.error} onRetry={() => void documentQuery.refresh()} />
        ) : selectedDoc && documentQuery.data?.available ? (
          <Card className="w-full max-w-full overflow-hidden">
            <div className="border-b border-[var(--border)] bg-[var(--surface-raised)] px-5 py-4 sm:px-8 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--accent)]">
                  {selectedDoc.sectionLabel}
                </p>
                <h2 className="mt-1 text-lg font-semibold text-[var(--foreground)] sm:text-xl">
                  {selectedDoc.title}
                </h2>
              </div>
              {selectedDoc.path && (
                <span className="max-w-full break-all font-mono text-[10px] text-[var(--muted)]">
                  {selectedDoc.path}
                </span>
              )}
            </div>
            <article className="w-full min-w-0 max-w-full px-5 py-7 sm:px-8 sm:py-9">
              <MarkdownContent markdown={documentQuery.data.markdown ?? ''} />
            </article>
          </Card>
        ) : (
          <EmptyDocument
            title="Brak treści dokumentu"
            detail="Wybrany dokument nie jest obecnie dostępny w plikach specyfikacji."
          />
        )}
      </div>
    </div>
  );
}
