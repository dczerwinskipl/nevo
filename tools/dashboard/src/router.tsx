import {
  Outlet,
  Link,
  useNavigate,
  useRouter,
  useLocation,
  useMatches,
  useCanGoBack,
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
  createAppRouter,
  type ChatSearch,
  type NavigationHistoryState,
  createSessionSwitchNavigator,
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
            const effectiveSessionId = session.providerSessionId || session.sessionId;
            navigate({
              to: '/ai/sessions/$provider/$sessionId',
              params: { provider: session.provider, sessionId: effectiveSessionId },
              state: (prev: any) => ({ ...prev, origin: 'dashboard' }),
            });
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
                to: '/ai/sessions/$provider/$sessionId',
                params: { provider: session.provider, sessionId: effectiveSessionId },
                state: (prev: any) => ({
                  ...prev,
                  origin: 'spec',
                  originSpecSlug: spec.slug,
                  originSpecSource: 'active',
                }),
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
              to: '/ai/sessions/$provider/$sessionId',
              params: { provider: session.provider, sessionId: effectiveSessionId },
              state: (prev: any) => ({
                ...prev,
                origin: 'spec',
                originSpecSlug: targetChange.slug,
                originSpecSource: targetChange.source,
              }),
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
  const location = useLocation();
  const historyState = location.state as NavigationHistoryState | undefined;
  const initialTaskId = historyState?.restoreTaskId || null;

  const { data } = useDashboardData();
  const navigate = useNavigate();
  const [createChange, setCreateChange] = useState<DashboardChange | null>(null);

  const selected = useMemo(() => {
    if (!data) return null;
    return (
      (source === 'active' ? data.active : data.archive).find((c) => c.slug === slug) ??
      (source === 'active' ? data.archive : data.active).find((c) => c.slug === slug) ??
      null
    );
  }, [data, source, slug]);

  if (data && !selected) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-6">
        <StatusCard
          variant="info"
          title="Specyfikacja nie znaleziona"
          description={`Nie znaleziono specyfikacji '${slug}'.`}
          onRetry={() => navigate({ to: '/' })}
          retryLabel="Wróć do listy specyfikacji"
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
        initialTaskId={initialTaskId}
        onOpenSession={(session, taskId) => {
          const effectiveSessionId = session.providerSessionId || session.sessionId;
          // Store restoreTaskId on current spec history entry so Back from chat restores the dialog
          if (taskId) {
            navigate({
              to: '/specs/$source/$slug',
              params: { source, slug },
              state: (prev: any) => ({ ...prev, restoreTaskId: taskId }),
              replace: true,
            });
          }
          navigate({
            to: '/ai/sessions/$provider/$sessionId',
            params: { provider: session.provider, sessionId: effectiveSessionId },
            state: (prev: any) => ({
              ...prev,
              origin: taskId ? 'task' : 'spec',
              originTaskId: taskId,
              originSpecSlug: selected.slug,
              originSpecSource: selected.source,
            }),
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
              to: '/ai/sessions/$provider/$sessionId',
              params: { provider: session.provider, sessionId: effectiveSessionId },
              state: (prev: any) => ({
                ...prev,
                origin: 'spec',
                originSpecSlug: selected.slug,
                originSpecSource: selected.source,
              }),
            });
          }}
        />
      )}
    </>
  );
}

// 5. Chat Route Component
function ChatRouteComponent() {
  const params = chatRoute.useParams();
  const search = chatRoute.useSearch() as ChatSearch;
  const location = useLocation();
  const historyState = location.state as NavigationHistoryState | undefined;

  const { data, loading, error } = useDashboardData();
  const globalSessions = useAiSessions({ enabled: Boolean(data) });
  const navigate = useNavigate();
  const router = useRouter();

  const provider = params.provider;
  const sessionId = params.sessionId;
  const initialTurnId = search.turnId || null;

  const origin = historyState?.origin;
  const originTaskId = historyState?.originTaskId;

  const associatedChange = useMemo(() => {
    if (!data) return null;
    const activeSession = globalSessions.sessions.find(
      (s) =>
        s.provider === provider &&
        (s.providerSessionId === sessionId || s.sessionId === sessionId)
    );
    const specId = activeSession?.specId;
    if (specId) {
      const found =
        data.active.find((c) => c.specId === specId) ||
        data.archive.find((c) => c.specId === specId);
      if (found) return found;
    }
    if (originTaskId) {
      const found = [...data.active, ...data.archive].find((c) =>
        c.tasks.some((t) => t.id === originTaskId)
      );
      if (found) return found;
    }
    if (historyState?.originSpecSlug) {
      const found = [...data.active, ...data.archive].find((c) =>
        c.slug === historyState.originSpecSlug
      );
      if (found) return found;
    }
    return null;
  }, [data, globalSessions.sessions, historyState?.originSpecSlug, originTaskId, provider, sessionId]);

  const handleBack = useCallback(() => {
    if (router.history.canGoBack()) {
      router.history.back();
      return;
    }

    // Deterministic fallback for direct deep links without in-app history
    if (associatedChange) {
      navigate({
        to: '/specs/$source/$slug',
        params: { source: associatedChange.source, slug: associatedChange.slug },
      });
      return;
    }
    navigate({ to: '/' });
  }, [associatedChange, navigate, router.history]);

  const handleTurnChange = useCallback(
    (turnId: string | null) => {
      navigate({
        to: '/ai/sessions/$provider/$sessionId',
        params: { provider, sessionId },
        search: { turnId: turnId || undefined },
        state: (prev: any) => ({ ...prev, ...(historyState || {}) }),
        replace: true,
      });
    },
    [historyState, navigate, provider, sessionId]
  );

  const handleSwitchSession = useCallback(
    createSessionSwitchNavigator(navigate, historyState),
    [historyState, navigate]
  );

  const handleOpenTask = useCallback(
    (target: TaskNavigationTarget | string, explicitSlug?: string | null) => {
      const taskId = typeof target === 'string' ? target : target.taskId;
      const specSlug = typeof target === 'string' ? explicitSlug : (target.specSlug || explicitSlug);

      if (specSlug && data) {
        const change =
          data.active.find((item) => item.slug === specSlug) ||
          data.archive.find((item) => item.slug === specSlug);
        if (change) {
          navigate({
            to: '/specs/$source/$slug',
            params: { source: change.source, slug: change.slug },
            state: (prev: any) => ({ ...prev, restoreTaskId: taskId }),
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
            state: (prev: any) => ({ ...prev, restoreTaskId: taskId }),
          });
          return;
        }
      }
      navigate({ to: '/' });
    },
    [data, navigate]
  );

  const backLabel = useMemo(() => {
    if (origin === 'task') return 'Wróć do taska';
    if (origin === 'spec') return 'Wróć do specyfikacji';
    if (origin === 'dashboard') return 'Wróć do listy';
    if (associatedChange) return 'Wróć do specyfikacji';
    return 'Wróć do listy';
  }, [associatedChange, origin]);

  if (loading && !data) return <LoadingScreen />;
  if (error && !data) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-red-200">{error}</div>;
  }

  return (
    <AiChatPage
      key={`${provider}:${sessionId}`}
      provider={provider}
      sessionId={sessionId}
      initialTurnId={initialTurnId}
      onTurnChange={handleTurnChange}
      onBack={handleBack}
      backLabel={backLabel}
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
chatRoute.update({ component: ChatRouteComponent });

export const router = createAppRouter();

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
