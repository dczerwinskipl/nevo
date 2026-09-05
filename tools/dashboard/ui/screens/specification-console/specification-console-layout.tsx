import { Outlet, Link, useNavigate, useLocation, useMatches } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { Menu } from 'lucide-react';

import { LoadingScreen } from '@/shared/ui/loading-screen';
import { Button } from '@/shared/ui/button';
import { StatusCard } from '@/shared/ui/status-card';
import { SpecificationSidebar } from '@/features/specifications/navigation/specification-sidebar';
import { SpecificationLiveControls } from '@/features/specifications/navigation/specification-live-controls';
import { useSpecificationIndex } from '@/features/specifications/queries';
import { CreateSpecificationDialog } from './create-specification/create-specification-dialog';
import type { SpecificationSource } from '@/features/specifications/types';
import { queueAgentSessionInitialDispatch } from '@/features/agent-sessions/initial-dispatch';

export function SpecificationConsoleLayout() {
  const { data, error, loading, refreshing, live, connectionStatus, refresh } = useSpecificationIndex();
  const [search, setSearch] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [createSpecOpen, setCreateSpecOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const matches = useMatches();

  const mode: SpecificationSource = useMemo(() => {
    const specMatch = matches.find((m) => m.routeId.includes('specs/$source/$slug'));
    if (specMatch) {
      const source = (specMatch.params as { source?: string }).source;
      return source === 'archive' ? 'archive' : 'active';
    }
    if (location.pathname === '/archive' || location.pathname.startsWith('/specs/archive')) {
      return 'archive';
    }
    return 'active';
  }, [location.pathname, matches]);

  const selectedSlug = useMemo(() => {
    const specMatch = matches.find((m) => m.routeId.includes('specs/$source/$slug'));
    return specMatch ? ((specMatch.params as { slug?: string }).slug ?? null) : null;
  }, [matches]);

  const filteredSpecifications = useMemo(() => {
    if (!data) return [];
    const source = mode === 'active' ? data.active : data.archive;
    const query = search.trim().toLocaleLowerCase('pl');
    return source.filter(
      (spec) => !query || spec.title.toLocaleLowerCase('pl').includes(query) || spec.slug.includes(query),
    );
  }, [data, mode, search]);

  return (
    <div className="min-h-screen lg:pl-[370px]">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-background/88 px-4 backdrop-blur-xl sm:px-7 lg:hidden">
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            size="icon"
            className="lg:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label="Otwórz menu specyfikacji"
          >
            <Menu className="size-4" />
          </Button>
          <Link
            to="/"
            className="flex cursor-pointer items-center gap-3 rounded-lg text-left focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
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
        </div>
        <SpecificationLiveControls
          live={live}
          status={connectionStatus}
          refreshing={refreshing}
          onRefresh={() => void refresh()}
        />
      </header>

      <SpecificationLiveControls
        live={live}
        status={connectionStatus}
        refreshing={refreshing}
        onRefresh={() => void refresh()}
        className="fixed top-3 right-4 z-40 hidden rounded-xl border border-border bg-surface/92 p-1 shadow-[0_12px_32px_rgba(0,0,0,0.28)] backdrop-blur-xl lg:flex"
      />

      <main>
        {loading && !data ? (
          <LoadingScreen />
        ) : error && !data ? (
          <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-6">
            <StatusCard
              variant="error"
              title="Nie udało się wczytać specyfikacji"
              description={error}
              onRetry={() => void refresh()}
              retryLabel="Spróbuj ponownie"
              className="w-full text-left"
            />
          </div>
        ) : (
          <Outlet />
        )}
      </main>

      {data && (
        <SpecificationSidebar
          mode={mode}
          active={data.active}
          archive={data.archive}
          specifications={filteredSpecifications}
          selectedSlug={selectedSlug}
          onOpenCreateSpec={() => setCreateSpecOpen(true)}
          search={search}
          onSearchChange={setSearch}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
      )}

      {createSpecOpen && (
        <CreateSpecificationDialog
          onClose={() => setCreateSpecOpen(false)}
          onCreated={(spec, session, promptToSend, userMessage) => {
            setCreateSpecOpen(false);
            if (session) {
              if (promptToSend) {
                queueAgentSessionInitialDispatch({
                  provider: session.provider,
                  providerSessionId: session.providerSessionId,
                  prompt: promptToSend,
                  userMessage,
                });
              }
              navigate({
                to: '/specs/$source/$slug/sessions/$provider/$providerSessionId',
                params: {
                  source: 'active',
                  slug: spec.slug,
                  provider: session.provider,
                  providerSessionId: session.providerSessionId,
                },
              });
            } else {
              navigate({
                to: '/specs/$source/$slug',
                params: { source: 'active', slug: spec.slug },
              });
            }
          }}
        />
      )}
    </div>
  );
}
