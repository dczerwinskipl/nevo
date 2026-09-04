import { FileCode2, LoaderCircle } from 'lucide-react';
import type { SpecificationSummary } from '../types';
import { Card } from '@/components/ui/card';
import { StatusCard } from '@/components/ui/status-card';
import { MarkdownContent } from '@/shared/markdown/markdown-content';
import { useSpecificationDocument } from './spec-detail-queries';

function ContentLoading() {
  return (
    <Card className="p-8" role="status">
      <div className="flex items-center gap-3 text-sm text-[var(--muted)]">
        <LoaderCircle className="size-4 animate-spin text-[var(--accent)]" />
        Wczytywanie treści dokumentu…
      </div>
      <div className="mt-7 animate-pulse space-y-3">
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

export function DocumentSectionPanel({
  specification,
  docId,
  fallbackPath,
  fallbackTitle,
  enabled,
  emptyTitle,
  emptyDetail,
}: {
  specification: SpecificationSummary;
  docId: string;
  fallbackPath?: string | null;
  fallbackTitle?: string;
  enabled: boolean;
  emptyTitle?: string;
  emptyDetail?: string;
}) {
  const documentQuery = useSpecificationDocument(specification, docId, enabled);

  if (documentQuery.loading) return <ContentLoading />;
  if (documentQuery.error) {
    return <ContentError message={documentQuery.error} onRetry={() => void documentQuery.refresh()} />;
  }
  if (!documentQuery.data?.available) {
    return (
      <EmptyDocument
        title={emptyTitle || `Brak dokumentu ${fallbackTitle || ''}`}
        detail={emptyDetail || 'Ten dokument nie jest obecnie dostępny w specyfikacji.'}
      />
    );
  }

  return (
    <Card className="w-full max-w-full min-w-0 overflow-hidden">
      <div className="border-b border-[var(--border)] bg-[var(--surface-raised)] px-5 py-3 text-[10px] text-[var(--muted)] sm:px-8">
        {documentQuery.data.path || fallbackPath || docId}
      </div>
      <article className="w-full max-w-full min-w-0 px-5 py-7 sm:px-8 sm:py-9">
        <MarkdownContent markdown={documentQuery.data.markdown} />
      </article>
    </Card>
  );
}
