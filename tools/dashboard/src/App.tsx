import { AlertTriangle, Menu, Radio } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { AppSidebar } from '@/components/app-sidebar';
import { ListOverview } from '@/components/list-overview';
import { SpecDetail } from '@/components/spec-detail';
import { AiChatPage } from '@/components/ai-chat';
import { AiSessionCreateModal } from '@/components/ai-session-create-modal';
import { SpecCreateModal } from '@/components/spec-create-modal';
import { Button } from '@/components/ui/button';
import { StatusCard, RetryButton } from '@/components/ui/status-card';
import { useAiSessions, useDashboardData } from '@/hooks/use-dashboard-data';
import type { AiSession, DashboardChange, TaskNavigationTarget } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  type AppRoute,
  type DashboardMode,
  formatRoute,
  parseRoute,
} from '@/lib/router';

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
  const [route, setRoute] = useState<AppRoute>(() =>
    parseRoute(window.location.pathname, window.location.search)
  );
  const [search, setSearch] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pendingInitialMessage, setPendingInitialMessage] = useState<string | null>(null);
  const [chatOriginTaskId, setChatOriginTaskId] = useState<string | null>(() =>
    typeof window.history.state?.originTaskId === 'string' ? window.history.state.originTaskId : null
  );
  const [createChange, setCreateChange] = useState<DashboardChange | null>(null);
  const [createSpecOpen, setCreateSpecOpen] = useState(false);
  const globalSessions = useAiSessions({ enabled: Boolean(data) });

  const navigate = useCallback((nextRoute: AppRoute, options: { replace?: boolean; originTaskId?: string | null } = {}) => {
    const path = formatRoute(nextRoute);
    const nextOrigin = options.originTaskId !== undefined
      ? options.originTaskId
      : (nextRoute.type === 'chat' ? chatOriginTaskId : null);
    const historyState = {
      nevoRoute: nextRoute,
      originTaskId: nextOrigin,
    };
    if (options.replace) {
      window.history.replaceState(historyState, '', path);
    } else {
      window.history.pushState(historyState, '', path);
    }
    setRoute(nextRoute);
    if (options.originTaskId !== undefined) {
      setChatOriginTaskId(options.originTaskId);
    }
    setSidebarOpen(false);
  }, [chatOriginTaskId]);

  useEffect(() => {
    const handlePopState = () => {
      const nextRoute = parseRoute(window.location.pathname, window.location.search);
      setRoute(nextRoute);
      setChatOriginTaskId(
        typeof window.history.state?.originTaskId === 'string'
          ? window.history.state.originTaskId
          : null
      );
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const mode: DashboardMode = route.type === 'spec' ? route.source : route.type === 'dashboard' ? route.mode : 'active';
  const selectedSlug: string | null = route.type === 'spec' ? route.slug : null;

  const source = mode === 'active' ? data?.active ?? [] : data?.archive ?? [];
  const filteredChanges = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('pl');
    return source.filter(change =>
      !query || change.title.toLocaleLowerCase('pl').includes(query) || change.slug.includes(query),
    );
  }, [source, search]);

  const selected = useMemo(() => {
    if (route.type !== 'spec' || !data) return null;
    return (
      (route.source === 'active' ? data.active : data.archive).find((c) => c.slug === route.slug) ??
      (route.source === 'active' ? data.archive : data.active).find((c) => c.slug === route.slug) ??
      null
    );
  }, [data, route]);

  // Reconcile spec route if source (active/archive) is mismatching
  useEffect(() => {
    if (!data || route.type !== 'spec') return;
    const inActive = data.active.some((c) => c.slug === route.slug);
    const inArchive = data.archive.some((c) => c.slug === route.slug);
    if (route.source === 'active' && !inActive && inArchive) {
      navigate({ type: 'spec', source: 'archive', slug: route.slug }, { replace: true });
    } else if (route.source === 'archive' && !inArchive && inActive) {
      navigate({ type: 'spec', source: 'active', slug: route.slug }, { replace: true });
    }
  }, [data, route, navigate]);

  const changeMode = (nextMode: DashboardMode) => {
    navigate({ type: 'dashboard', mode: nextMode });
    setSearch('');
  };

  const selectChange = (change: DashboardChange) => {
    navigate({ type: 'spec', source: change.source, slug: change.slug });
  };

  const openSession = (
    session: AiSession,
    initialMessage: string | null = null,
    originTaskId?: string | null,
    replaceHistory = false
  ) => {
    const effectiveSessionId = session.providerSessionId || session.sessionId;
    const nextOrigin = originTaskId === undefined ? (route.type === 'chat' ? chatOriginTaskId : null) : originTaskId;
    navigate(
      { type: 'chat', provider: session.provider, sessionId: effectiveSessionId, turnId: null },
      { replace: replaceHistory, originTaskId: nextOrigin }
    );
    setPendingInitialMessage(initialMessage);
  };

  const updateTurnRoute = useCallback((turnId: string | null) => {
    setRoute((prev) => {
      if (prev.type !== 'chat' || prev.turnId === turnId) return prev;
      const nextRoute: AppRoute = { ...prev, turnId };
      const path = formatRoute(nextRoute);
      window.history.replaceState({ ...window.history.state, nevoRoute: nextRoute, turnId }, '', path);
      return nextRoute;
    });
  }, []);

  const leaveChat = useCallback(() => {
    if (route.type === 'chat' && data) {
      const activeSession = globalSessions.sessions.find(
        (s) => s.provider === route.provider && (s.providerSessionId === route.sessionId || s.sessionId === route.sessionId)
      );
      const specId = activeSession?.specId;
      const associatedChange = specId
        ? (data.active.find((c) => c.specId === specId) || data.archive.find((c) => c.specId === specId))
        : null;
      if (associatedChange) {
        navigate({ type: 'spec', source: associatedChange.source, slug: associatedChange.slug });
        setPendingInitialMessage(null);
        return;
      }
    }
    navigate({ type: 'dashboard', mode: 'active' });
    setPendingInitialMessage(null);
  }, [data, globalSessions.sessions, navigate, route]);

  const handleInitialMessageConsumed = useCallback(() => {
    setPendingInitialMessage(null);
  }, []);

  const handleOpenTask = useCallback((target: TaskNavigationTarget | string, explicitSlug?: string | null) => {
    const taskId = typeof target === 'string' ? target : target.taskId;
    const specSlug = typeof target === 'string' ? explicitSlug : (target.specSlug || explicitSlug);

    if (specSlug && data) {
      const change = data.active.find(item => item.slug === specSlug) || data.archive.find(item => item.slug === specSlug);
      if (change) {
        navigate({ type: 'spec', source: change.source, slug: change.slug }, { originTaskId: taskId });
        return;
      }
    }
    if (data && taskId) {
      const foundChange = [...data.active, ...data.archive].find(c => c.tasks.some(t => t.id === taskId));
      if (foundChange) {
        navigate({ type: 'spec', source: foundChange.source, slug: foundChange.slug }, { originTaskId: taskId });
        return;
      }
    }
    navigate({ type: 'dashboard', mode: 'active' }, { originTaskId: taskId });
  }, [data, navigate]);

  if (route.type === 'chat') {
    if (loading && !data) return <LoadingScreen />;
    if (error && !data) return <div className="flex min-h-screen items-center justify-center text-sm text-red-200">{error}</div>;
    return (
      <AiChatPage
        key={`${route.provider}:${route.sessionId}`}
        provider={route.provider}
        sessionId={route.sessionId}
        initialTurnId={route.turnId}
        initialMessage={pendingInitialMessage}
        onInitialMessageConsumed={handleInitialMessageConsumed}
        onTurnChange={updateTurnRoute}
        onBack={leaveChat}
        backLabel={chatOriginTaskId ? 'Wróć do taska' : 'Wróć do specyfikacji'}
        onSwitchSession={session => openSession(session, null, chatOriginTaskId, true)}
        onOpenTask={handleOpenTask}
        changes={[...(data?.active ?? []), ...(data?.archive ?? [])]}
      />
    );
  }

  return (
    <div className="min-h-screen lg:pl-[370px]">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--background)_88%,transparent)] px-4 backdrop-blur-xl sm:px-7 lg:px-9">
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(true)} aria-label="Otwórz menu specyfikacji">
            <Menu className="size-4" />
          </Button>
          <button
            type="button"
            onClick={() => navigate({ type: 'dashboard', mode: 'active' })}
            className="flex items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded-lg cursor-pointer"
            title="Przejdź do listy specyfikacji"
          >
            <div className="flex size-8 items-center justify-center rounded-lg bg-[var(--accent)] text-sm font-black text-[#101505]">N</div>
            <div>
              <p className="text-xs font-semibold text-[var(--foreground)]">NEvo Flow</p>
              <p className="text-[9px] uppercase tracking-[0.14em] text-[var(--muted)]">Specification console</p>
            </div>
          </button>
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
              <span className={cn('absolute -top-0.5 -right-0.5 size-1.5 rounded-full', live ? 'bg-[var(--accent)]' : 'bg-amber-400 animate-ping')} />
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
        ) : route.type === 'spec' && selected ? (
          <SpecDetail
            change={selected}
            initialTaskId={chatOriginTaskId}
            onOpenSession={(session, taskId) => openSession(session, null, taskId ?? null)}
            onCreateSession={() => { setChatOriginTaskId(null); setCreateChange(selected); }}
            onNavigateMode={changeMode}
          />
        ) : route.type === 'spec' && data && !selected ? (
          <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-6">
            <StatusCard
              variant="info"
              title="Specyfikacja nie znaleziona"
              description={`Nie znaleziono specyfikacji '${route.slug}'.`}
              onRetry={() => navigate({ type: 'dashboard', mode: 'active' })}
              retryLabel="Wróć do listy specyfikacji"
              className="w-full text-left"
            />
          </div>
        ) : (
          <ListOverview mode={mode} changes={filteredChanges} onSelect={selectChange} />
        )}
      </main>

      {data && (
        <AppSidebar
          mode={mode}
          onModeChange={changeMode}
          active={data.active}
          archive={data.archive}
          changes={filteredChanges}
          selectedSlug={selectedSlug}
          onSelect={selectChange}
          sessions={globalSessions.sessions}
          sessionsLoading={globalSessions.loading}
          sessionsError={globalSessions.error}
          onSessionsRetry={() => void globalSessions.refresh()}
          onOpenSession={session => openSession(session, null, null)}
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
              openSession(session, initialPrompt, null);
            } else {
              navigate({ type: 'spec', source: 'active', slug: spec.slug });
            }
          }}
        />
      )}
      {createChange && (
        <AiSessionCreateModal
          change={createChange}
          onClose={() => setCreateChange(null)}
          onCreated={(session, initialMessage) => {
            setCreateChange(null);
            openSession(session, initialMessage, null);
          }}
        />
      )}
    </div>
  );
}
