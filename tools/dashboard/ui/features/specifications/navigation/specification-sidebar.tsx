import {
  Archive,
  FileText,
  LayoutDashboard,
  Plus,
  Search,
  X,
} from 'lucide-react';

import type { SpecificationSummary, SpecificationSource } from '../types';
import { cn, formatDate, formatStatus, pluralizeTasks } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StageProgress } from '../stage-progress';
import { Link } from '@tanstack/react-router';

export type { SpecificationSource };

export interface SpecificationSidebarProps {
  mode: SpecificationSource;
  active: SpecificationSummary[];
  archive: SpecificationSummary[];
  changes: SpecificationSummary[];
  selectedSlug: string | null;
  onSelect?: (change: SpecificationSummary) => void;
  onOpenCreateSpec?: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  open: boolean;
  onClose: () => void;
}

function SpecNavigationItem({
  change,
  selected,
  onClick,
}: {
  change: SpecificationSummary;
  selected: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      to="/specs/$source/$slug"
      params={{ source: change.source, slug: change.slug }}
      onClick={onClick}
      aria-current={selected ? 'page' : undefined}
      className={cn(
        'group block w-full rounded-xl border p-3.5 text-left transition-all outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]',
        selected
          ? 'border-[var(--accent-border)] bg-[color-mix(in_srgb,var(--accent)_7%,var(--surface))]'
          : 'border-transparent bg-transparent hover:border-[var(--border)] hover:bg-[var(--surface-raised)]',
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border text-[var(--accent)]',
            selected
              ? 'border-[color-mix(in_srgb,var(--accent)_35%,transparent)] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent)]'
              : 'border-[var(--border)] bg-[var(--surface)]',
          )}
        >
          <FileText className="size-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-semibold leading-5 text-[var(--foreground)]">
            {change.title}
          </p>
          <div className="mt-1.5 flex items-center gap-2 text-[11px] text-[var(--muted)]">
            <span>{change.metrics.total} {pluralizeTasks(change.metrics.total)}</span>
            {change.source === 'active' && (
              <>
                <span aria-hidden="true">·</span>
                <span>{formatStatus(change.status)}</span>
              </>
            )}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <StageProgress change={change} className="flex-1" />
            <span className="text-[10px] font-bold tabular-nums text-[var(--muted)]">
              {change.metrics.progress}%
            </span>
          </div>
          {change.source === 'archive' && (
            <p className="mt-2 text-[10px] text-[var(--muted)]">{formatDate(change.updatedAt)}</p>
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
  changes,
  selectedSlug,
  onSelect,
  onOpenCreateSpec,
  search,
  onSearchChange,
  open,
  onClose,
}: SpecificationSidebarProps) {
  const visible = changes;

  return (
    <>
      <button
        aria-label="Zamknij menu"
        type="button"
        className={cn(
          'fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity lg:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
      />
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-[370px] flex-col border-r border-[var(--border)] bg-[var(--surface-raised)] transition-transform duration-200 lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="px-4 sm:px-6">
          <div className="flex h-16 items-center justify-between border-b border-[var(--border)]">
            <Link
              to="/"
              onClick={onClose}
              className="flex items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              title="Przejdź do listy specyfikacji"
            >
              <div className="flex size-8 items-center justify-center rounded-lg bg-[var(--accent)] text-sm font-black text-[var(--accent-foreground)]">
                N
              </div>
              <div>
                <p className="text-xs font-semibold text-[var(--foreground)]">NEvo Flow</p>
                <p className="text-[9px] uppercase tracking-[0.14em] text-[var(--muted)]">Specification console</p>
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
          <div className="border-b border-[var(--border)] py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-[var(--foreground)]">Specyfikacje</p>
                <p className="text-[11px] text-[var(--muted)]">Baza zmian i zadań</p>
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

            <div className="mt-4 grid grid-cols-2 gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1">
              <Link
                to="/"
                aria-current={mode === 'active' ? 'page' : undefined}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]',
                  mode === 'active'
                    ? 'bg-[color-mix(in_srgb,var(--accent)_10%,var(--surface-hover))] font-semibold text-[var(--foreground)]'
                    : 'text-[var(--muted)] hover:bg-[var(--surface-raised)] hover:text-[var(--foreground)]',
                )}
              >
                <LayoutDashboard className="size-3.5 text-[var(--accent)]" />
                <span>W toku</span>
                <Badge className="border-transparent bg-black/20 px-1.5 py-0 text-[10px]">
                  {active.length}
                </Badge>
              </Link>
              <Link
                to="/archive"
                aria-current={mode === 'archive' ? 'page' : undefined}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]',
                  mode === 'archive'
                    ? 'bg-[color-mix(in_srgb,var(--accent)_10%,var(--surface-hover))] font-semibold text-[var(--foreground)]'
                    : 'text-[var(--muted)] hover:bg-[var(--surface-raised)] hover:text-[var(--foreground)]',
                )}
              >
                <Archive className="size-3.5 text-[var(--accent)]" />
                <span>Archiwum</span>
                <Badge className="border-transparent bg-black/20 px-1.5 py-0 text-[10px]">
                  {archive.length}
                </Badge>
              </Link>
            </div>

            <label className="relative mt-3 block">
              <span className="sr-only">Szukaj specyfikacji</span>
              <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[var(--accent)]" />
              <input
                value={search}
                onChange={event => onSearchChange(event.target.value)}
                placeholder={mode === 'active' ? 'Szukaj aktualnych…' : 'Szukaj w archiwum…'}
                className="h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] pl-9 pr-3 text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--muted)] focus:border-[color-mix(in_srgb,var(--accent)_45%,transparent)]"
              />
            </label>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
          <div className="mb-2 flex items-center justify-between px-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
              {mode === 'active' ? 'W toku' : 'Zakończone'}
            </span>
            <span className="text-[10px] text-[var(--muted)]">{visible.length}</span>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {visible.map(change => (
              <div key={`${change.source}:${change.slug}`} className="py-1.5 first:pt-0 last:pb-0">
                <SpecNavigationItem
                  change={change}
                  selected={selectedSlug === change.slug}
                  onClick={() => {
                    onSelect?.(change);
                    onClose();
                  }}
                />
              </div>
            ))}
            {visible.length === 0 && (
              <div className="mx-2 rounded-xl border border-dashed border-[var(--border)] px-4 py-10 text-center">
                <Archive className="mx-auto size-5 text-[var(--accent)]" />
                <p className="mt-3 text-xs font-semibold text-[var(--foreground)]">Brak wyników</p>
                <p className="mt-1 text-[11px] leading-5 text-[var(--muted)]">Zmień wyszukiwaną frazę.</p>
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

// Backward compat alias if needed
export const AppSidebar = SpecificationSidebar;
export type DashboardMode = SpecificationSource;
