import {
  Outlet,
  Link,
  useNavigate,
  useLocation,
  useMatches,
} from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';
import { Menu, Radio } from 'lucide-react';

import { AppSidebar, type DashboardMode } from '@/components/app-sidebar';
import { ListOverview } from '@/components/list-overview';
import { SpecDetail } from '@/components/spec-detail';
import { AiChatPage } from '@/components/ai-chat';
import { AiSessionCreateModal } from '@/components/ai-session-create-modal';
import { SpecCreateModal } from '@/components/spec-create-modal';
import { Button } from '@/components/ui/button';
import { StatusCard, RetryButton } from '@/components/ui/status-card';
import { useAiSessions, useDashboardData } from '@/hooks/use-dashboard-data';
import { pendingDispatchStore } from '@/lib/pending-dispatch-store';
import type { AiSession, DashboardChange, TaskNavigationTarget } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  rootRoute,
  appLayoutRoute,
  indexRoute,
  archiveRoute,
  specRoute,
  chatRoute,
  specChatRoute,
  createAppRouter,
  type ChatSearch,
  resolveSessionDestination,
} from './router-tree';

export function LoadingScreen() {
  return (
    <div className="mx-auto max-w-6xl animate-pulse px-5 py-16 sm:px-9">
      <div className="h-3 w-28 rounded bg-white/8" />
      <div className="mt-8 h-12 max-w-2xl rounded-xl bg-white/8" />
      <div className="mt-4 h-4 max-w-xl rounded bg-white/5" />
      <div className="mt-12 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="h-32 rounded-2xl border border-[var(--border)] bg-[var(--surface)]" />
        ))}
      </div>
      <div className="mt-12 h-64 rounded-2xl border border-[var(--border)] bg-[var(--surface)]" />
    </div>
  );
}

// 1. App Layout Component
function AppLayoutComponent() {
  const { data, error, loading, refreshing, live, refresh } = useDashboardData();
  const [search, setSearch] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [createChange, setCreateChange] = useState<DashboardChange | null>(null);
  const [createSpecOpen, setCreateSpecOpen] = useState(false);
  const globalSessions = useAiSessions({ enabled: Boolean(data) });
  const navigate = useNavigate();
  const location = useLocation();
  const matches = useMatches();

  const mode: DashboardMode = useMemo(() => {
    const specMatch = matches.find((m) => m.routeId === '/app-layout/specs/$source/$slug');
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
    const specMatch = matches.find((m) => m.routeId === '/app-layout/specs/$source/$slug');
    return specMatch ? ((specMatch.params as { slug?: string }).slug ?? null) : null;
  }, [matches]);

  const filteredChanges = useMemo(() => {
    if (!data) return [];
    const source = mode === 'active' ? data.active : data.archive;
    const query = search.trim().toLocaleLowerCase('pl');
    return source.filter(
      (change) =>
        !query ||
        change.title.toLocaleLowerCase('pl').includes(query) ||
        change.slug.includes(query)
    );
  }, [data, mode, search]);

  return (
    <div className="min-h-screen lg:pl-[370px]">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--background)_88%,transparent)] px-4 backdrop-blur-xl sm:px-7 lg:px-9">
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
            <div className="flex size-8 items-center justify-center rounded-lg bg-[var(--accent)] text-sm font-black text-[#101505]">
              N
            </div>
            <div>
              <p className="text-xs font-semibold text-[var(--foreground)]">NEvo Flow</p>
              <p className="text-[9px] uppercase tracking-[0.14em] text-[var(--muted)]">Specification console</p>
            </div>
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <div
            role="status"
            tabIndex={0}
            aria-label={live ? 'Połączenie na żywo aktywne (SSE: Połączono)' : 'Brak połączenia na żywo (SSE: Rozłączono)'}
            title={live ? 'SSE: Połączono (aktualizacje na żywo aktywne)' : 'SSE: Rozłączono (ponawianie połączenia)'}
            className="flex size-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] transition-colors hover:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] cursor-default"
          >
            <span className="relative flex size-3.5 items-center justify-center">
              <Radio className={cn('size-3.5', live ? 'text-[var(--accent)]' : 'text-amber-400')} />
              <span
                className={cn(
                  'absolute -top-0.5 -right-0.5 size-1.5 rounded-full',
                  live ? 'bg-[var(--accent)]' : 'bg-amber-400 animate-ping'
                )}
              />
            </span>
          </div>
          <RetryButton size="icon" onClick={() => void refresh()} loading={refreshing} label="Odśwież dashboard" />
        </div>
      </header>

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
        <AppSidebar
          mode={mode}
          active={data.active}
          archive={data.archive}
          changes={filteredChanges}
          selectedSlug={selectedSlug}
          sessions={globalSessions.sessions}
          sessionsLoading={globalSessions.loading}
          sessionsError={globalSessions.error}
          onSessionsRetry={() => void globalSessions.refresh()}
          onOpenSession={(session) => {
            const allSpecs = [...(data.active ?? []), ...(data.archive ?? [])];
            try {
              const dest = resolveSessionDestination(session, allSpecs);
              navigate({
                to: dest.to,
                params: dest.params,
              });
            } catch (err) {
              console.error('Failed to open session from sidebar:', err);
            }
            setSidebarOpen(false);
          }}
          onOpenCreateSpec={() => setCreateSpecOpen(true)}
          search={search}
          onSearchChange={setSearch}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
      )}

      {createSpecOpen && (
        <SpecCreateModal
          onClose={() => setCreateSpecOpen(false)}
          onCreated={(spec, session, initialPrompt) => {
            setCreateSpecOpen(false);
            if (session) {
              const effectiveSessionId = session.providerSessionId || session.sessionId;
              if (initialPrompt) {
                pendingDispatchStore.setPending(session.provider, effectiveSessionId, initialPrompt);
              }
              navigate({
                to: '/specs/$source/$slug/sessions/$provider/$sessionId',
                params: {
                  source: 'active',
                  slug: spec.slug,
                  provider: session.provider,
                  sessionId: effectiveSessionId,
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

      {createChange && (
        <AiSessionCreateModal
          change={createChange}
          onClose={() => setCreateChange(null)}
          onCreated={(session, initialMessage) => {
            const effectiveSessionId = session.providerSessionId || session.sessionId;
            const targetChange = createChange;
            setCreateChange(null);
            if (initialMessage) {
              pendingDispatchStore.setPending(session.provider, effectiveSessionId, initialMessage);
            }
            navigate({
              to: '/specs/$source/$slug/sessions/$provider/$sessionId',
              params: {
                source: targetChange.source,
                slug: targetChange.slug,
                provider: session.provider,
                sessionId: effectiveSessionId,
              },
            });
          }}
        />
      )}
    </div>
  );
}

// 2. Active Dashboard Component
function ActiveDashboardComponent() {
  const { data } = useDashboardData();
  const changes = data?.active ?? [];

  return <ListOverview mode="active" changes={changes} />;
}

// 3. Archive Dashboard Component
function ArchiveDashboardComponent() {
  const { data } = useDashboardData();
  const changes = data?.archive ?? [];

  return <ListOverview mode="archive" changes={changes} />;
}

// 4. Spec Detail Component
function SpecDetailRouteComponent() {
  const params = specRoute.useParams();
  const source = params.source as 'active' | 'archive';
  const slug = params.slug;

  const { data, loading, error, refresh } = useDashboardData();
  const navigate = useNavigate();
  const [createChange, setCreateChange] = useState<DashboardChange | null>(null);

  const selected = useMemo(() => {
    if (!data) return null;
    const collection = source === 'active' ? data.active : data.archive;
    return collection.find((c) => c.slug === slug) ?? null;
  }, [data, source, slug]);

  if (loading && !data) return <LoadingScreen />;
  if (error && !data) {
    return (
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
    );
  }

  if (data && !selected) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-6">
        <StatusCard
          variant="info"
          title="Specyfikacja nie znaleziona"
          description={`Nie znaleziono specyfikacji '${slug}' w sekcji ${source === 'active' ? 'aktywnych' : 'archiwum'}.`}
          onRetry={() => navigate({ to: source === 'active' ? '/' : '/archive' })}
          retryLabel={source === 'active' ? 'Wróć do listy specyfikacji' : 'Wróć do archiwum'}
          className="w-full text-left"
        />
      </div>
    );
  }

  if (!selected) {
    return <LoadingScreen />;
  }

  return (
    <>
      <SpecDetail
        change={selected}
        onOpenSession={(session) => {
          const effectiveSessionId = session.providerSessionId || session.sessionId;
          navigate({
            to: '/specs/$source/$slug/sessions/$provider/$sessionId',
            params: {
              source: selected.source,
              slug: selected.slug,
              provider: session.provider,
              sessionId: effectiveSessionId,
            },
          });
        }}
        onCreateSession={() => setCreateChange(selected)}
        onNavigateMode={(m) => navigate({ to: m === 'archive' ? '/archive' : '/' })}
      />
      {createChange && (
        <AiSessionCreateModal
          change={createChange}
          onClose={() => setCreateChange(null)}
          onCreated={(session, initialMessage) => {
            const effectiveSessionId = session.providerSessionId || session.sessionId;
            setCreateChange(null);
            if (initialMessage) {
              pendingDispatchStore.setPending(session.provider, effectiveSessionId, initialMessage);
            }
            navigate({
              to: '/specs/$source/$slug/sessions/$provider/$sessionId',
              params: {
                source: selected.source,
                slug: selected.slug,
                provider: session.provider,
                sessionId: effectiveSessionId,
              },
            });
          }}
        />
      )}
    </>
  );
}

// 5. Spec-Scoped Chat Route Component (/specs/:source/:slug/sessions/:provider/:sessionId)
function SpecChatRouteComponent() {
  const params = specChatRoute.useParams();
  const search = specChatRoute.useSearch() as ChatSearch;

  const { data, loading, error, refresh } = useDashboardData();
  const navigate = useNavigate();

  const source = params.source as 'active' | 'archive';
  const slug = params.slug;
  const provider = params.provider;
  const sessionId = params.sessionId;
  const initialTurnId = search.turnId || null;

  const selectedSpec = useMemo(() => {
    if (!data) return null;
    const collection = source === 'active' ? data.active : data.archive;
    return collection.find((c) => c.slug === slug) ?? null;
  }, [data, source, slug]);

  const handleBack = useCallback(() => {
    navigate({
      to: '/specs/$source/$slug',
      params: { source, slug },
    });
  }, [navigate, slug, source]);

  const handleTurnChange = useCallback(
    (turnId: string | null) => {
      navigate({
        to: '/specs/$source/$slug/sessions/$provider/$sessionId',
        params: { source, slug, provider, sessionId },
        search: { turnId: turnId || undefined },
        replace: true,
      });
    },
    [navigate, provider, sessionId, slug, source]
  );

  const handleSwitchSession = useCallback(
    (targetSession: AiSession) => {
      const allSpecs = [...(data?.active ?? []), ...(data?.archive ?? [])];
      try {
        const dest = resolveSessionDestination(targetSession, allSpecs);
        navigate({
          to: dest.to,
          params: dest.params,
        });
      } catch (err) {
        console.error('Failed to resolve session destination:', err);
      }
    },
    [data, navigate]
  );

  const handleOpenTask = useCallback(
    (target: TaskNavigationTarget | string, explicitSlug?: string | null) => {
      const taskId = typeof target === 'string' ? target : target.taskId;
      const targetSlug = typeof target === 'string' ? (explicitSlug || slug) : (target.specSlug || explicitSlug || slug);

      if (data) {
        const change =
          [...data.active, ...data.archive].find((item) => item.slug === targetSlug) ||
          (taskId ? [...data.active, ...data.archive].find((c) => c.tasks.some((t) => t.id === taskId)) : null);
        if (change) {
          navigate({
            to: '/specs/$source/$slug',
            params: { source: change.source, slug: change.slug },
          });
          return;
        }
      }
      navigate({ to: '/' });
    },
    [data, navigate, slug]
  );

  if (loading && !data) return <LoadingScreen />;
  if (error && !data) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-red-200">{error}</div>
    );
  }
  if (data && !selectedSpec) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-6">
        <StatusCard
          variant="info"
          title="Specyfikacja nie znaleziona"
          description={`Nie znaleziono specyfikacji '${slug}'.`}
          onRetry={() => navigate({ to: source === 'active' ? '/' : '/archive' })}
          retryLabel={source === 'active' ? 'Wróć do listy specyfikacji' : 'Wróć do archiwum'}
          className="w-full text-left"
        />
      </div>
    );
  }

  return (
    <AiChatPage
      key={`${provider}:${sessionId}`}
      provider={provider}
      sessionId={sessionId}
      initialTurnId={initialTurnId}
      onTurnChange={handleTurnChange}
      onBack={handleBack}
      backLabel="Wróć do specyfikacji"
      onSwitchSession={handleSwitchSession}
      onOpenTask={handleOpenTask}
      changes={[...(data?.active ?? []), ...(data?.archive ?? [])]}
    />
  );
}

// 6. Global/Ad-hoc Chat Route Component (/ai/sessions/:provider/:sessionId)
function GlobalChatRouteComponent() {
  const params = chatRoute.useParams();
  const search = chatRoute.useSearch() as ChatSearch;

  const { data, loading, error, refresh } = useDashboardData();
  const globalSessions = useAiSessions({ enabled: Boolean(data) });
  const navigate = useNavigate();

  const provider = params.provider;
  const sessionId = params.sessionId;
  const initialTurnId = search.turnId || null;

  const activeSession = useMemo(() => {
    return globalSessions.sessions.find(
      (s) => s.provider === provider && (s.providerSessionId === sessionId || s.sessionId === sessionId)
    );
  }, [globalSessions.sessions, provider, sessionId]);

  const handleBack = useCallback(() => {
    navigate({ to: '/' });
  }, [navigate]);

  const handleTurnChange = useCallback(
    (turnId: string | null) => {
      navigate({
        to: '/ai/sessions/$provider/$sessionId',
        params: { provider, sessionId },
        search: { turnId: turnId || undefined },
        replace: true,
      });
    },
    [navigate, provider, sessionId]
  );

  const handleSwitchSession = useCallback(
    (targetSession: AiSession) => {
      const allSpecs = [...(data?.active ?? []), ...(data?.archive ?? [])];
      try {
        const dest = resolveSessionDestination(targetSession, allSpecs);
        navigate({
          to: dest.to,
          params: dest.params,
        });
      } catch (err) {
        console.error('Failed to resolve session destination:', err);
      }
    },
    [data, navigate]
  );

  const handleOpenTask = useCallback(
    (target: TaskNavigationTarget | string, explicitSlug?: string | null) => {
      const taskId = typeof target === 'string' ? target : target.taskId;
      const targetSlug = typeof target === 'string' ? explicitSlug : (target.specSlug || explicitSlug);

      if (targetSlug && data) {
        const change =
          data.active.find((item) => item.slug === targetSlug) ||
          data.archive.find((item) => item.slug === targetSlug);
        if (change) {
          navigate({
            to: '/specs/$source/$slug',
            params: { source: change.source, slug: change.slug },
          });
          return;
        }
      }
      if (data && taskId) {
        const foundChange = [...data.active, ...data.archive].find((c) => c.tasks.some((t) => t.id === taskId));
        if (foundChange) {
          navigate({
            to: '/specs/$source/$slug',
            params: { source: foundChange.source, slug: foundChange.slug },
          });
          return;
        }
      }
      navigate({ to: '/' });
    },
    [data, navigate]
  );

  if (loading && !data) return <LoadingScreen />;
  if (error && !data) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-red-200">{error}</div>
    );
  }

  // If a user opens /ai/sessions/... for a session that has a specId,
  // surface an explicit warning/guidance card instead of performing a hidden redirect.
  if (activeSession && activeSession.specId) {
    const owningSpec = [...(data?.active ?? []), ...(data?.archive ?? [])].find((s) => s.specId === activeSession.specId);
    if (owningSpec) {
      return (
        <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-6">
          <StatusCard
            variant="warning"
            title="Sesja powiązana ze specyfikacją"
            description={`Ta sesja należy do specyfikacji '${owningSpec.title}'.`}
            onRetry={() =>
              navigate({
                to: '/specs/$source/$slug/sessions/$provider/$sessionId',
                params: {
                  source: owningSpec.source,
                  slug: owningSpec.slug,
                  provider,
                  sessionId,
                },
              })
            }
            retryLabel="Przejdź do sesji w specyfikacji"
            className="w-full text-left"
          />
        </div>
      );
    }
  }

  return (
    <AiChatPage
      key={`${provider}:${sessionId}`}
      provider={provider}
      sessionId={sessionId}
      initialTurnId={initialTurnId}
      onTurnChange={handleTurnChange}
      onBack={handleBack}
      backLabel="Wróć do listy"
      onSwitchSession={handleSwitchSession}
      onOpenTask={handleOpenTask}
      changes={[...(data?.active ?? []), ...(data?.archive ?? [])]}
    />
  );
}

// Bind route components
rootRoute.update({ component: () => <Outlet /> });
appLayoutRoute.update({ component: AppLayoutComponent });
indexRoute.update({ component: ActiveDashboardComponent });
archiveRoute.update({ component: ArchiveDashboardComponent });
specRoute.update({ component: SpecDetailRouteComponent });
chatRoute.update({ component: GlobalChatRouteComponent });
specChatRoute.update({ component: SpecChatRouteComponent });

export const router = createAppRouter();

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
