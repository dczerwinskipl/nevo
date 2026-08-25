import {
  Outlet,
  Link,
  useNavigate,
  useLocation,
  useMatches,
  useRouter,
} from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Menu, Radio } from 'lucide-react';

import { AppSidebar, type DashboardMode } from '@/components/app-sidebar';
import { ListOverview } from '@/components/list-overview';
import { SpecDetail } from '@/components/spec-detail';
import { AiChatPage } from '@/components/ai-chat';
import { AiSessionCreateModal } from '@/components/ai-session-create-modal';
import { SpecCreateModal } from '@/components/spec-create-modal';
import { Button } from '@/components/ui/button';
import { StatusCard, RetryButton } from '@/components/ui/status-card';
import { useDashboardData } from '@/hooks/use-dashboard-data';
import { useAiSessions } from '@/components/ai-chat/ai-chat-queries';
import { pendingDispatchStore } from '@/components/ai-chat/pending-dispatch-store';
import type { AiSession, DashboardChange } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  rootRoute,
  appLayoutRoute,
  indexRoute,
  archiveRoute,
  specRoute,
  specChatRoute,
  createAppRouter,
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
              if (initialPrompt) {
                pendingDispatchStore.setPending(session.provider, session.providerSessionId, initialPrompt);
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

      {createChange && (
        <AiSessionCreateModal
          change={createChange}
          onClose={() => setCreateChange(null)}
          onCreated={(session, initialMessage) => {
            const targetChange = createChange;
            setCreateChange(null);
            if (initialMessage) {
              pendingDispatchStore.setPending(session.provider, session.providerSessionId, initialMessage);
            }
            navigate({
              to: '/specs/$source/$slug/sessions/$provider/$providerSessionId',
              params: {
                source: targetChange.source,
                slug: targetChange.slug,
                provider: session.provider,
                providerSessionId: session.providerSessionId,
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

  const fallbackSpec = useMemo(() => {
    if (!data || selected) return null;
    const oppositeSource = source === 'active' ? 'archive' : 'active';
    const oppositeCollection = source === 'active' ? data.archive : data.active;
    const match = oppositeCollection.find((c) => c.slug === slug);
    return match ? { change: match, oppositeSource } : null;
  }, [data, selected, source, slug]);

  useEffect(() => {
    if (fallbackSpec) {
      navigate({
        to: '/specs/$source/$slug',
        params: { source: fallbackSpec.oppositeSource, slug },
        replace: true,
      });
    }
  }, [fallbackSpec, navigate, slug]);

  const effectiveSpec = selected || fallbackSpec?.change || null;

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

  if (data && !effectiveSpec) {
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

  if (!effectiveSpec) {
    return <LoadingScreen />;
  }

  return (
    <>
      <SpecDetail
        change={effectiveSpec}
        onOpenSession={(session) => {
          navigate({
            to: '/specs/$source/$slug/sessions/$provider/$providerSessionId',
            params: {
              source: effectiveSpec.source,
              slug: effectiveSpec.slug,
              provider: session.provider,
              providerSessionId: session.providerSessionId,
            },
          });
        }}
        onCreateSession={() => setCreateChange(effectiveSpec)}
        onNavigateMode={(m) => navigate({ to: m === 'archive' ? '/archive' : '/' })}
      />
      {createChange && (
        <AiSessionCreateModal
          change={createChange}
          onClose={() => setCreateChange(null)}
          onCreated={(session, initialMessage) => {
            const targetChange = createChange;
            setCreateChange(null);
            if (initialMessage) {
              pendingDispatchStore.setPending(session.provider, session.providerSessionId, initialMessage);
            }
            navigate({
              to: '/specs/$source/$slug/sessions/$provider/$providerSessionId',
              params: {
                source: targetChange.source,
                slug: targetChange.slug,
                provider: session.provider,
                providerSessionId: session.providerSessionId,
              },
            });
          }}
        />
      )}
    </>
  );
}

// 5. Spec-Scoped Chat Route Component (/specs/:source/:slug/sessions/:provider/:providerSessionId)
function SpecChatRouteComponent() {
  const params = specChatRoute.useParams();
  const source = params.source as 'active' | 'archive';
  const slug = params.slug;
  const provider = params.provider;
  const providerSessionId = params.providerSessionId;

  const { data, loading: dataLoading, error: dataError } = useDashboardData();
  const navigate = useNavigate();

  const selectedSpec = useMemo(() => {
    if (!data) return null;
    const collection = source === 'active' ? data.active : data.archive;
    return collection.find((c) => c.slug === slug) ?? null;
  }, [data, source, slug]);

  const fallbackSpec = useMemo(() => {
    if (!data || selectedSpec) return null;
    const oppositeSource = source === 'active' ? 'archive' : 'active';
    const oppositeCollection = source === 'active' ? data.archive : data.active;
    const match = oppositeCollection.find((c) => c.slug === slug);
    return match ? { change: match, oppositeSource } : null;
  }, [data, selectedSpec, source, slug]);

  useEffect(() => {
    if (fallbackSpec) {
      navigate({
        to: '/specs/$source/$slug/sessions/$provider/$providerSessionId',
        params: {
          source: fallbackSpec.oppositeSource,
          slug,
          provider,
          providerSessionId,
        },
        replace: true,
      });
    }
  }, [fallbackSpec, navigate, provider, providerSessionId, slug]);

  const effectiveSpec = selectedSpec || fallbackSpec?.change || null;
  const effectiveSource = effectiveSpec?.source || source;

  const specId = effectiveSpec?.specId ?? null;
  const sessionsQuery = useAiSessions({
    specId: specId || undefined,
    enabled: Boolean(specId),
  });

  const session = useMemo(() => {
    return sessionsQuery.sessions.find(
      (s) => s.provider === provider && s.providerSessionId === providerSessionId
    ) ?? null;
  }, [sessionsQuery.sessions, provider, providerSessionId]);

  const router = useRouter();

  const handleBack = useCallback(() => {
    if (router.history.canGoBack?.() || (router.history.length > 1 && typeof (router.history as any).canGoBack !== 'function')) {
      router.history.back();
    } else {
      navigate({
        to: '/specs/$source/$slug',
        params: { source: effectiveSource, slug },
        replace: true,
      });
    }
  }, [navigate, router, slug, effectiveSource]);

  const handleSwitchSession = useCallback(
    (targetSession: AiSession) => {
      navigate({
        to: '/specs/$source/$slug/sessions/$provider/$providerSessionId',
        params: {
          source: effectiveSource,
          slug,
          provider: targetSession.provider,
          providerSessionId: targetSession.providerSessionId,
        },
        replace: true,
      });
    },
    [navigate, slug, effectiveSource]
  );

  if (dataLoading && !data) return <LoadingScreen />;
  if (dataError && !data) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-red-200">
        {dataError}
      </div>
    );
  }

  // Spec Not Found in either collection
  if (data && !effectiveSpec) {
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

  if (sessionsQuery.loading && !sessionsQuery.data) return <LoadingScreen />;

  // Fatal initial Sessions Query Error (error && !data)
  if (sessionsQuery.error && !sessionsQuery.data) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-6">
        <StatusCard
          variant="error"
          title="Nie udało się wczytać sesji specyfikacji"
          description={sessionsQuery.error}
          onRetry={() => void sessionsQuery.refresh()}
          retryLabel="Spróbuj ponownie"
          className="w-full text-left"
        >
          <div className="mt-3">
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2 text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
              onClick={handleBack}
            >
              Wróć do specyfikacji
            </Button>
          </div>
        </StatusCard>
      </div>
    );
  }

  // Session Not Found in this spec
  if (sessionsQuery.data && !session) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-6">
        <StatusCard
          variant="info"
          title="Sesja nie znaleziona"
          description={`Nie znaleziono sesji '${providerSessionId}' (${provider}) w specyfikacji '${effectiveSpec?.title || slug}'.`}
          onRetry={handleBack}
          retryLabel="Wróć do specyfikacji"
          className="w-full text-left"
        />
      </div>
    );
  }

  if (!effectiveSpec || !session) {
    return <LoadingScreen />;
  }

  return (
    <AiChatPage
      key={`${session.provider}:${session.providerSessionId}`}
      spec={effectiveSpec}
      session={session}
      onBack={handleBack}
      backLabel="Wróć do specyfikacji"
      onSwitchSession={handleSwitchSession}
    />
  );
}

// Bind route components
rootRoute.update({ component: () => <Outlet /> });
appLayoutRoute.update({ component: AppLayoutComponent });
indexRoute.update({ component: ActiveDashboardComponent });
archiveRoute.update({ component: ArchiveDashboardComponent });
specRoute.update({ component: SpecDetailRouteComponent });
specChatRoute.update({ component: SpecChatRouteComponent });

export const router = createAppRouter();

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
