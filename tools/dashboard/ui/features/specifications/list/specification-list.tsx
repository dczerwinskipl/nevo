import { Archive, ArrowRight, FileStack, Inbox } from 'lucide-react';

import type { SpecificationSummary, SpecificationSource } from '../types';
import { formatDate, formatStatus, pluralizeTasks } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { StageProgress } from '../stage-progress';

import { Link } from '@tanstack/react-router';

export function SpecificationList({
  mode,
  changes,
  onSelect,
}: {
  mode: SpecificationSource;
  changes: SpecificationSummary[];
  onSelect?: (change: SpecificationSummary) => void;
}) {
  const archive = mode === 'archive';
  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-12 sm:px-8 lg:pt-20">
      <div className="flex size-12 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface)] text-[var(--accent)]">
        {archive ? <Archive className="size-5" /> : <FileStack className="size-5" />}
      </div>
      <p className="mt-7 text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--accent)]">
        {archive ? 'Historia zmian' : 'Aktualny przepływ'}
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] text-[var(--foreground)] sm:text-5xl">
        {archive ? 'Archiwum specyfikacji' : 'Wybierz specyfikację'}
      </h1>
      <p className="mt-5 max-w-2xl text-sm leading-7 text-[var(--muted-strong)]">
        {archive
          ? 'Archiwum zawsze pozostaje listą. Otwórz dowolną pozycję, aby zobaczyć jej końcowy przebieg i zadania.'
          : 'Masz więcej niż jedną aktualną specyfikację. Wybierz tę, której przepływ chcesz przeanalizować.'}
      </p>

      <div className="mt-10 space-y-2">
        {changes.map(change => {
          return (
            <Link
              key={change.slug}
              to="/specs/$source/$slug"
              params={{ source: change.source, slug: change.slug }}
              onClick={() => onSelect?.(change)}
              className="group block w-full text-left"
            >
              <Card className="p-5 transition-colors group-hover:border-[var(--border-strong)] group-hover:bg-[var(--surface-raised)]">
                <div className="flex items-start gap-4">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] text-[var(--accent)]">
                    {archive ? <Archive className="size-4" /> : <FileStack className="size-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-semibold text-[var(--foreground)]">{change.title}</h2>
                      {!archive && <Badge>{formatStatus(change.status)}</Badge>}
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--muted)]">{change.summary}</p>
                    <div className="mt-4 flex flex-wrap items-center gap-3 text-[10px] text-[var(--muted)]">
                      <span>{change.metrics.total} {pluralizeTasks(change.metrics.total)}</span>
                      <span>Aktualizacja: {formatDate(change.updatedAt)}</span>
                      <StageProgress change={change} className="w-28" />
                      <span className="font-semibold tabular-nums">{change.metrics.progress}%</span>
                    </div>
                  </div>
                  <ArrowRight className="mt-3 size-4 shrink-0 text-[var(--accent)] transition-transform group-hover:translate-x-1 group-hover:text-[var(--accent-strong)]" />
                </div>
              </Card>
            </Link>
          );
        })}

        {changes.length === 0 && (
          <div className="rounded-2xl border border-dashed border-[var(--border)] py-20 text-center">
            <Inbox className="mx-auto size-7 text-[var(--accent)]" />
            <p className="mt-4 text-sm font-semibold text-[var(--foreground)]">Tutaj jest pusto</p>
            <p className="mt-1 text-xs text-[var(--muted)]">Dashboard pokaże pozycje, gdy pojawią się w plikach repozytorium.</p>
          </div>
        )}
      </div>
    </div>
  );
}
