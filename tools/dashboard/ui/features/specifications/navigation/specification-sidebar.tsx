import { Archive, FileText, LayoutDashboard, Plus, Search, X } from 'lucide-react';

import type { SpecificationSummary, SpecificationSource } from '../types';
import { cn, formatDate, formatStatus, pluralizeTasks } from '@/lib/utils';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { StageProgress } from '../stage-progress';
import { Link } from '@tanstack/react-router';

export type { SpecificationSource };

export interface SpecificationSidebarProps {
  mode: SpecificationSource;
  active: SpecificationSummary[];
  archive: SpecificationSummary[];
  specifications: SpecificationSummary[];
  selectedSlug: string | null;
  onSelect?: (specification: SpecificationSummary) => void;
  onOpenCreateSpec?: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  open: boolean;
  onClose: () => void;
}

function SpecNavigationItem({
  specification,
  selected,
  onClick,
}: {
  specification: SpecificationSummary;
  selected: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      to="/specs/$source/$slug"
      params={{ source: specification.source, slug: specification.slug }}
      onClick={onClick}
      aria-current={selected ? 'page' : undefined}
      className={cn(
        'group block w-full rounded-xl border p-3.5 text-left transition-all outline-none focus-visible:ring-2 focus-visible:ring-accent',
        selected
          ? 'border-accent/35 bg-accent/7'
          : 'border-transparent bg-transparent hover:border-border hover:bg-surface-raised',
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border text-accent',
            selected ? 'border-accent/35 bg-accent/12 text-accent' : 'border-border bg-surface',
          )}
        >
          <FileText className="size-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm leading-5 font-semibold text-fg-primary">{specification.title}</p>
          <div className="mt-1.5 flex items-center gap-2 text-[11px] text-fg-muted">
            <span>
              {specification.metrics.total} {pluralizeTasks(specification.metrics.total)}
            </span>
            {specification.source === 'active' && (
              <>
                <span aria-hidden="true">·</span>
                <span>{formatStatus(specification.status)}</span>
              </>
            )}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <StageProgress specification={specification} className="flex-1" />
            <span className="text-[10px] font-bold text-fg-muted tabular-nums">{specification.metrics.progress}%</span>
          </div>
          {specification.source === 'archive' && (
            <p className="mt-2 text-[10px] text-fg-muted">{formatDate(specification.updatedAt)}</p>
          )}
        </div>
      </div>
    </Link>
  );
}

export function SpecificationSidebar({
  mode,
  active,
  archive,
  specifications,
  selectedSlug,
  onSelect,
  onOpenCreateSpec,
  search,
  onSearchChange,
  open,
  onClose,
}: SpecificationSidebarProps) {
  const visible = specifications;

  return (
    <>
      <button
        aria-label="Zamknij menu"
        type="button"
        className={cn(
          'fixed inset-0 z-40 bg-backdrop backdrop-blur-sm transition-opacity lg:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
      />
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-[370px] flex-col border-r border-border bg-surface-raised transition-transform duration-200 lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="px-4 sm:px-6">
          <div className="flex h-16 items-center justify-between border-b border-border">
            <Link
              to="/"
              onClick={onClose}
              className="flex items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
              title="Przejdź do listy specyfikacji"
            >
              <div className="flex size-8 items-center justify-center rounded-lg bg-accent text-sm font-black text-fg-on-accent">
                N
              </div>
              <div>
                <p className="text-xs font-semibold text-fg-primary">NEvo Flow</p>
                <p className="text-[9px] tracking-[0.14em] text-fg-muted uppercase">Specification console</p>
              </div>
            </Link>
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={onClose}
              aria-label="Zamknij menu boczne"
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>

        <div className="px-4 sm:px-6">
          <div className="border-b border-border py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-fg-primary">Specyfikacje</p>
                <p className="text-[11px] text-fg-muted">Baza zmian i zadań</p>
              </div>
              {onOpenCreateSpec && (
                <Button
                  variant="default"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    onOpenCreateSpec();
                    onClose();
                  }}
                >
                  <Plus className="size-3.5" /> Nowa
                </Button>
              )}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-1 rounded-xl border border-border bg-surface p-1">
              <Link
                to="/"
                aria-current={mode === 'active' ? 'page' : undefined}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  mode === 'active'
                    ? 'bg-accent/10 font-semibold text-fg-primary'
                    : 'text-fg-muted hover:bg-surface-raised hover:text-fg-primary',
                )}
              >
                <LayoutDashboard className="size-3.5 text-accent" />
                <span>W toku</span>
                <Badge className="border-transparent bg-fg-primary/10 px-1.5 py-0 text-[10px]">{active.length}</Badge>
              </Link>
              <Link
                to="/archive"
                aria-current={mode === 'archive' ? 'page' : undefined}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  mode === 'archive'
                    ? 'bg-accent/10 font-semibold text-fg-primary'
                    : 'text-fg-muted hover:bg-surface-raised hover:text-fg-primary',
                )}
              >
                <Archive className="size-3.5 text-accent" />
                <span>Archiwum</span>
                <Badge className="border-transparent bg-fg-primary/10 px-1.5 py-0 text-[10px]">{archive.length}</Badge>
              </Link>
            </div>

            <label className="relative mt-3 block">
              <span className="sr-only">Szukaj specyfikacji</span>
              <Search className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-accent" />
              <input
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder={mode === 'active' ? 'Szukaj aktualnych…' : 'Szukaj w archiwum…'}
                className="h-10 w-full rounded-lg border border-border bg-surface pr-3 pl-9 text-xs text-fg-primary outline-none placeholder:text-fg-muted focus:border-accent/45"
              />
            </label>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
          <div className="mb-2 flex items-center justify-between px-2">
            <span className="text-[10px] font-bold tracking-[0.16em] text-fg-muted uppercase">
              {mode === 'active' ? 'W toku' : 'Zakończone'}
            </span>
            <span className="text-[10px] text-fg-muted">{visible.length}</span>
          </div>
          <div className="divide-y divide-border">
            {visible.map((spec) => (
              <div key={`${spec.source}:${spec.slug}`} className="py-1.5 first:pt-0 last:pb-0">
                <SpecNavigationItem
                  specification={spec}
                  selected={selectedSlug === spec.slug}
                  onClick={() => {
                    onSelect?.(spec);
                    onClose();
                  }}
                />
              </div>
            ))}
            {visible.length === 0 && (
              <div className="mx-2 rounded-xl border border-dashed border-border px-4 py-10 text-center">
                <Archive className="mx-auto size-5 text-accent" />
                <p className="mt-3 text-xs font-semibold text-fg-primary">Brak wyników</p>
                <p className="mt-1 text-[11px] leading-5 text-fg-muted">Zmień wyszukiwaną frazę.</p>
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
