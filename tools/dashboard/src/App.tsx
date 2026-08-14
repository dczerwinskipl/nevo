import { AlertTriangle, Menu, Radio, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { AppSidebar, type DashboardMode } from '@/components/app-sidebar';
import { ListOverview } from '@/components/list-overview';
import { SpecDetail } from '@/components/spec-detail';
import { Button } from '@/components/ui/button';
import { useDashboardData } from '@/hooks/use-dashboard-data';
import type { DashboardChange } from '@/lib/types';
import { cn } from '@/lib/utils';

function LoadingScreen() {
  return (
    <div className="mx-auto max-w-6xl animate-pulse px-5 py-16 sm:px-9">
      <div className="h-3 w-28 rounded bg-white/8" />
      <div className="mt-8 h-12 max-w-2xl rounded-xl bg-white/8" />
      <div className="mt-4 h-4 max-w-xl rounded bg-white/5" />
      <div className="mt-12 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map(item => <div key={item} className="h-32 rounded-2xl border border-[var(--border)] bg-[var(--surface)]" />)}
      </div>
      <div className="mt-12 h-64 rounded-2xl border border-[var(--border)] bg-[var(--surface)]" />
    </div>
  );
}

export default function App() {
  const { data, error, loading, refreshing, live, refresh } = useDashboardData();
  const [mode, setMode] = useState<DashboardMode>('active');
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const source = mode === 'active' ? data?.active ?? [] : data?.archive ?? [];
  const selected = useMemo(
    () => source.find(change => change.slug === selectedSlug) ?? null,
    [source, selectedSlug],
  );

  useEffect(() => {
    if (!data) return;
    if (mode === 'active' && data.active.length === 1) {
      setSelectedSlug(data.active[0].slug);
      return;
    }
    if (selectedSlug && !source.some(change => change.slug === selectedSlug)) setSelectedSlug(null);
  }, [data, mode, selectedSlug, source]);

  const changeMode = (nextMode: DashboardMode) => {
    setMode(nextMode);
    setSelectedSlug(null);
    setSearch('');
  };

  const selectChange = (change: DashboardChange) => {
    setSelectedSlug(change.slug);
    setSidebarOpen(false);
  };

  return (
    <div className="min-h-screen lg:pl-[370px]">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--background)_88%,transparent)] px-4 backdrop-blur-xl sm:px-7 lg:px-9">
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(true)} aria-label="Otwórz menu specyfikacji">
            <Menu className="size-4" />
          </Button>
          <div className="flex size-8 items-center justify-center rounded-lg bg-[var(--accent)] text-sm font-black text-[#101505]">N</div>
          <div>
            <p className="text-xs font-semibold text-[var(--foreground)]">NEvo Flow</p>
            <p className="text-[9px] uppercase tracking-[0.14em] text-[var(--muted)]">Specification console</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[10px] text-[var(--muted)] sm:flex">
            <Radio className={cn('size-3', live ? 'text-[var(--accent)]' : 'text-amber-300')} />
            {live ? 'Pliki połączone' : 'Ponowne łączenie'}
          </div>
          <Button variant="ghost" size="icon" onClick={() => void refresh()} disabled={refreshing} aria-label="Odśwież dashboard">
            <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} />
          </Button>
        </div>
      </header>

      <main>
        {loading && !data ? (
          <LoadingScreen />
        ) : error && !data ? (
          <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-6 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl border border-red-400/20 bg-red-400/8 text-red-300">
              <AlertTriangle className="size-5" />
            </div>
            <h1 className="mt-5 text-xl font-semibold text-[var(--foreground)]">Nie udało się wczytać specyfikacji</h1>
            <p className="mt-2 text-sm text-[var(--muted)]">{error}</p>
            <Button className="mt-6" onClick={() => void refresh()}>Spróbuj ponownie</Button>
          </div>
        ) : selected ? (
          <SpecDetail change={selected} />
        ) : (
          <ListOverview mode={mode} changes={source} onSelect={selectChange} />
        )}
      </main>

      {data && (
        <AppSidebar
          mode={mode}
          onModeChange={changeMode}
          active={data.active}
          archive={data.archive}
          selectedSlug={selectedSlug}
          onSelect={selectChange}
          search={search}
          onSearchChange={setSearch}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
      )}
    </div>
  );
}
