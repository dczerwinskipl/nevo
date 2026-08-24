import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  ChevronRight,
  ClipboardCheck,
  FileCode2,
  Folder,
  LoaderCircle,
  RefreshCw,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { useEffect, useRef, useState } from 'react';

import type {
  DashboardChange,
  SpecificationManifestDirectorySection,
} from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { StatusCard } from '@/components/ui/status-card';
import { MarkdownContent } from '@/components/markdown-content';
import { useSpecificationDocument } from '@/hooks/use-dashboard-data';

function ContentLoading() {
  return (
    <Card className="p-8" role="status">
      <div className="flex items-center gap-3 text-sm text-[var(--muted)]">
        <LoaderCircle className="size-4 animate-spin text-[var(--accent)]" />
        Wczytywanie treści dokumentu…
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
      <FileCode2 className="size-6 text-[var(--muted)]" />
      <h2 className="mt-4 text-sm font-semibold text-[var(--foreground)]">{title}</h2>
      <p className="mt-2 max-w-md text-xs leading-5 text-[var(--muted)]">{detail}</p>
    </Card>
  );
}

const ICON_MAP: Record<string, ComponentType<{ className?: string }>> = {
  Boxes,
  ClipboardCheck,
};

function formatItemCount(count: number, label: string, singularLabel?: string): string {
  if (count === 1 && singularLabel) return `1 ${singularLabel.toLowerCase()}`;
  if (label.toLowerCase() === 'obszary') {
    if (count < 5) return `${count} obszary`;
    return `${count} obszarów`;
  }
  if (label.toLowerCase() === 'recenzje') {
    if (count < 5) return `${count} recenzje`;
    return `${count} recenzji`;
  }
  return `${count} (${label.toLowerCase()})`;
}

export function DirectorySectionPanel({
  change,
  section,
  enabled,
}: {
  change: DashboardChange;
  section: SpecificationManifestDirectorySection;
  enabled: boolean;
}) {
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const triggerIdRef = useRef<string | null>(null);

  const selectedDoc = selectedDocId
    ? section.documents.find(doc => doc.docId === selectedDocId) ?? null
    : null;

  const documentQuery = useSpecificationDocument(
    change,
    selectedDoc?.docId ?? null,
    enabled && Boolean(selectedDoc),
  );

  useEffect(() => {
    if (selectedDocId && !section.documents.some(doc => doc.docId === selectedDocId)) {
      setSelectedDocId(null);
    }
  }, [section.documents, selectedDocId]);

  if (!section.documents.length) {
    return (
      <EmptyDocument
        title={`Brak dokumentów w sekcji ${section.label}`}
        detail={`Ta specyfikacja nie ma dodatkowych dokumentów w katalogu tej sekcji.`}
      />
    );
  }

  const IconComponent = (section.icon && ICON_MAP[section.icon]) || Folder;

  if (selectedDoc) {
    return (
      <div className="w-full min-w-0 max-w-full">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2"
            onClick={() => {
              const triggerId = triggerIdRef.current;
              setSelectedDocId(null);
              requestAnimationFrame(() => {
                if (triggerId) document.getElementById(triggerId)?.focus();
              });
            }}
          >
            <ArrowLeft className="mr-2 size-3.5" /> Wróć do: {section.label.toLowerCase()}
          </Button>
          <span className="max-w-full truncate text-[10px] text-[var(--muted)] sm:max-w-[60%]">
            {selectedDoc.path}
          </span>
        </div>

        {documentQuery.loading ? (
          <ContentLoading />
        ) : documentQuery.error ? (
          <ContentError message={documentQuery.error} onRetry={() => void documentQuery.refresh()} />
        ) : (
          <Card className="w-full min-w-0 max-w-full overflow-hidden">
            <div className="border-b border-[var(--border)] bg-[var(--surface-raised)] px-5 py-4 sm:px-8">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--accent)]">
                {section.singularLabel || section.label}
              </p>
              <h2 className="mt-2 text-lg font-semibold text-[var(--foreground)] sm:text-xl">
                {selectedDoc.title}
              </h2>
            </div>
            <article className="w-full min-w-0 max-w-full px-5 py-7 sm:px-8 sm:py-9">
              <MarkdownContent markdown={documentQuery.data?.markdown ?? ''} />
            </article>
          </Card>
        )}
      </div>
    );
  }

  const countLabel = formatItemCount(section.documents.length, section.label, section.singularLabel);

  return (
    <div>
      <div className="mb-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--accent)]">
          {section.label}
        </p>
        <h2 className="mt-1 text-lg font-semibold text-[var(--foreground)]">{countLabel}</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Wybierz pozycję, aby otworzyć jej dokument.
        </p>
      </div>

      <div className="space-y-3">
        {section.documents.map(doc => {
          const triggerId = `section-${section.id}-trigger-${doc.id}`;
          return (
            <Card
              key={doc.id}
              className="overflow-hidden transition-colors hover:border-[color-mix(in_srgb,var(--accent)_35%,var(--border))]"
            >
              <button
                id={triggerId}
                type="button"
                className="flex w-full items-center gap-3 p-4 text-left sm:p-5"
                onClick={() => {
                  triggerIdRef.current = triggerId;
                  setSelectedDocId(doc.docId);
                }}
              >
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] text-[var(--muted)]">
                  <IconComponent className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold leading-5 text-[var(--foreground)] sm:text-base">
                    {doc.title}
                  </h3>
                  {doc.path && (
                    <p className="mt-2 truncate font-mono text-[10px] text-[var(--muted)]">
                      {doc.path}
                    </p>
                  )}
                </div>
                <ChevronRight className="size-4 shrink-0 text-[var(--muted)]" />
              </button>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
