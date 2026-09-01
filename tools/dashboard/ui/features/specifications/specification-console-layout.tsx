import {
  Outlet,
  Link,
  useNavigate,
  useLocation,
  useMatches,
} from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { Menu } from 'lucide-react';

import { LoadingScreen } from '@/shared/ui/loading-screen';
import { Button } from '@/components/ui/button';
import { StatusCard } from '@/components/ui/status-card';
import { SpecificationSidebar } from './navigation/specification-sidebar';
import { SpecificationLiveControls } from './navigation/specification-live-controls';
import { useSpecificationIndex } from './queries';
import { CreateSpecificationDialog } from './create/create-specification-dialog';
import type { SpecificationSource } from './types';
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
    const specMatch = matches.find((m) =>
      m.routeId.includes('specs/$source/$slug')
    );
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
    const specMatch = matches.find((m) =>
      m.routeId.includes('specs/$source/$slug')
    );
    return specMatch ? ((specMatch.params as { slug?: string }).slug ?? null) : null;
  }, [matches]);

  const filteredSpecifications = useMemo(() => {
    if (!data) return [];
    const source = mode === 'active' ? data.active : data.archive;
    const query = search.trim().toLocaleLowerCase('pl');
    return source.filter(
      (spec) =>
        !query ||
        spec.title.toLocaleLowerCase('pl').includes(query) ||
        spec.slug.includes(query)
    );
  }, [data, mode, search]);

  return (
    <div className="min-h-screen lg:pl-[370px]">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--background)_88%,transparent)] px-4 backdrop-blur-xl sm:px-7 lg:hidden">
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
            className="flex items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded-lg cursor-pointer"
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
        </div>
        <SpecificationLiveControls live={live} status={connectionStatus} refreshing={refreshing} onRefresh={() => void refresh()} />
      </header>

      <SpecificationLiveControls
        live={live}
        status={connectionStatus}
        refreshing={refreshing}
        onRefresh={() => void refresh()}
        className="fixed right-4 top-3 z-40 hidden rounded-xl border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_92%,transparent)] p-1 shadow-[0_12px_32px_rgba(0,0,0,0.28)] backdrop-blur-xl lg:flex"
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
