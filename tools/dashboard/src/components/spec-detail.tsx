import {
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  CircleDotDashed,
  FileCode2,
  Layers3,
  ListChecks,
  Play,
} from 'lucide-react';

import type { DashboardChange } from '@/lib/types';
import { formatDate, formatStatus, pluralizeTasks } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { StageProgress } from '@/components/stage-progress';
import { StatusBoard } from '@/components/status-board';

function MetricCard({ icon, label, value, helper }: { icon: React.ReactNode; label: string; value: string; helper: string }) {
  return (
    <Card className="relative overflow-hidden p-4">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">{label}</p>
          <p className="mt-2 text-xl font-semibold tracking-tight text-[var(--foreground)]">{value}</p>
          <p className="mt-1 text-[11px] text-[var(--muted)]">{helper}</p>
        </div>
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] text-[var(--accent)]">
          {icon}
        </div>
      </div>
    </Card>
  );
}

export function SpecDetail({ change }: { change: DashboardChange }) {
  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 pb-16 pt-7 sm:px-7 lg:px-9">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted)]">
        <span>NEvo</span>
        <span>/</span>
        <span>{change.source === 'active' ? 'Aktualne' : 'Archiwum'}</span>
        <span>/</span>
        <span className="max-w-[240px] truncate text-[var(--foreground)]">{change.slug}</span>
      </div>

      <header className="mt-7 grid gap-7 xl:grid-cols-[1fr_340px] xl:items-end">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="border-[color-mix(in_srgb,var(--accent)_30%,transparent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] text-[var(--accent)]">
              <span className="mr-1.5 size-1.5 rounded-full bg-current" />
              {formatStatus(change.status)}
            </Badge>
            {change.priority !== null && <Badge>Priorytet {change.priority}</Badge>}
            <Badge>{change.source === 'active' ? 'Aktualna' : 'Archiwalna'}</Badge>
          </div>
          <h1 className="mt-5 max-w-4xl text-3xl font-semibold leading-tight tracking-[-0.035em] text-[var(--foreground)] sm:text-5xl">
            {change.title}
          </h1>
          <p className="mt-5 max-w-3xl text-sm leading-7 text-[var(--muted-strong)] sm:text-[15px]">
            {change.summary}
          </p>
          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-[var(--muted)]">
            <span className="inline-flex items-center gap-1.5"><CalendarClock className="size-3.5" /> {formatDate(change.updatedAt)}</span>
            {change.path && <span className="inline-flex items-center gap-1.5"><FileCode2 className="size-3.5" /> {change.path}</span>}
          </div>
        </div>

        <Card className="p-5">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">Postęp ukończenia</p>
              <p className="mt-2 text-4xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">{change.metrics.progress}%</p>
            </div>
            <div className="text-right text-[11px] text-[var(--muted)]">
              <p>{change.metrics.completed}/{change.metrics.actionable}</p>
              <p>w „Gotowe”</p>
            </div>
          </div>
          <StageProgress change={change} className="mt-5" legend />
        </Card>
      </header>

      <section aria-label="Podsumowanie specyfikacji" className="mt-9 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={<ListChecks className="size-4" />}
          label="Zakres"
          value={`${change.metrics.total} ${pluralizeTasks(change.metrics.total)}`}
          helper={`${change.metrics.abandoned} porzuconych`}
        />
        <MetricCard
          icon={<Play className="size-4" />}
          label="W toku"
          value={String(change.metrics.inImplementation)}
          helper={`${change.metrics.ready} gotowych do startu`}
        />
        <MetricCard
          icon={<CircleDotDashed className="size-4" />}
          label="Review"
          value={String(change.metrics.inReview)}
          helper="zadań oczekuje na weryfikację"
        />
        <MetricCard
          icon={<CheckCircle2 className="size-4" />}
          label="Gotowe"
          value={String(change.metrics.completed)}
          helper="zadań zweryfikowanych"
        />
      </section>

      {change.nextTask && (
        <Card className="mt-3 overflow-hidden">
          <div className="grid gap-4 p-5 sm:grid-cols-[auto_1fr_auto] sm:items-center">
            <div className="flex size-10 items-center justify-center rounded-xl bg-[var(--accent)] text-[#121705]">
              <ArrowUpRight className="size-4" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                {change.nextTask.status === 'in-implementation' ? 'Aktualnie realizowane' : 'Następne gotowe zadanie'}
              </p>
              <p className="mt-1 text-sm font-semibold text-[var(--foreground)]">{change.nextTask.title}</p>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
              <Layers3 className="size-3.5" />
              {formatStatus(change.nextTask.status)}
            </div>
          </div>
        </Card>
      )}

      <div className="mt-11">
        <StatusBoard change={change} />
      </div>
    </div>
  );
}
