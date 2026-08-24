import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from '@tanstack/react-router';

import type { AiSession } from './lib/types';

export interface SpecSearch {}

export interface ChatSearch {
  turnId?: string;
}

export interface NavigationHistoryState {
  origin?: 'dashboard' | 'spec' | 'task';
  originTaskId?: string;
  restoreTaskId?: string;
}

export type SessionRouteDestination =
  | {
      to: '/specs/$source/$slug/sessions/$provider/$sessionId';
      params: {
        source: 'active' | 'archive';
        slug: string;
        provider: string;
        sessionId: string;
      };
    }
  | {
      to: '/ai/sessions/$provider/$sessionId';
      params: {
        provider: string;
        sessionId: string;
      };
    };

export function resolveSessionRoute(
  session: { provider: string; sessionId: string; providerSessionId?: string; specId?: string | null },
  specs: Array<{ specId?: string | null; source: 'active' | 'archive'; slug: string }>
): SessionRouteDestination {
  const effectiveSessionId = session.providerSessionId || session.sessionId;

  if (session.specId) {
    const owningSpec = specs.find((s) => s.specId === session.specId);
    if (owningSpec) {
      return {
        to: '/specs/$source/$slug/sessions/$provider/$sessionId',
        params: {
          source: owningSpec.source,
          slug: owningSpec.slug,
          provider: session.provider,
          sessionId: effectiveSessionId,
        },
      };
    }
  }

  return {
    to: '/ai/sessions/$provider/$sessionId',
    params: {
      provider: session.provider,
      sessionId: effectiveSessionId,
    },
  };
}

export function createSessionSwitchNavigator(
  navigate: (opts: any) => Promise<any> | void,
  specs: Array<{ specId?: string | null; source: 'active' | 'archive'; slug: string }>,
  historyState?: NavigationHistoryState
) {
  return (session: AiSession) => {
    const destination = resolveSessionRoute(session, specs);
    return navigate({
      to: destination.to,
      params: destination.params,
      state: (prev: any) => ({ ...prev, ...(historyState || {}) }),
      replace: true,
    });
  };
}

export function createBackNavigator({
  routerHistory,
  navigate,
  specContext,
}: {
  routerHistory: { canGoBack: () => boolean; back: () => void };
  navigate: (opts: any) => Promise<any> | void;
  specContext?: { source: 'active' | 'archive'; slug: string } | null;
}) {
  return () => {
    if (routerHistory.canGoBack()) {
      routerHistory.back();
      return;
    }
    if (specContext) {
      navigate({
        to: '/specs/$source/$slug',
        params: { source: specContext.source, slug: specContext.slug },
        replace: true,
      });
      return;
    }
    navigate({ to: '/', replace: true });
  };
}

export function createRestoreTaskIdConsumer(
  navigate: (opts: any) => Promise<any> | void,
  source: 'active' | 'archive',
  slug: string
) {
  return () => {
    navigate({
      to: '/specs/$source/$slug',
      params: { source, slug },
      state: (prev: any) => {
        if (!prev || !prev.restoreTaskId) return prev;
        const { restoreTaskId: _, ...rest } = prev;
        return rest;
      },
      replace: true,
    });
  };
}

export interface SpecCanonicalTarget {
  slug: string;
  source: 'active' | 'archive';
  [key: string]: any;
}

export function resolveSpecRouteCanonicalization<T extends SpecCanonicalTarget>({
  requestedSource,
  slug,
  activeSpecs,
  archiveSpecs,
}: {
  requestedSource: 'active' | 'archive';
  slug: string;
  activeSpecs: T[];
  archiveSpecs: T[];
}): {
  status: 'matched' | 'redirect' | 'not-found';
  canonicalSource?: 'active' | 'archive';
  spec?: T;
} {
  const currentCollection = requestedSource === 'active' ? activeSpecs : archiveSpecs;
  const matched = currentCollection.find((s) => s.slug === slug);
  if (matched) {
    return { status: 'matched', canonicalSource: requestedSource, spec: matched };
  }

  const oppositeSource: 'active' | 'archive' = requestedSource === 'active' ? 'archive' : 'active';
  const oppositeCollection = requestedSource === 'active' ? archiveSpecs : activeSpecs;
  const oppositeMatched = oppositeCollection.find((s) => s.slug === slug);
  if (oppositeMatched) {
    return { status: 'redirect', canonicalSource: oppositeSource, spec: oppositeMatched };
  }

  return { status: 'not-found' };
}

export const rootRoute = createRootRoute();

export const appLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app-layout',
});

export const indexRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/',
});

export const archiveRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/archive',
});

export const specRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/specs/$source/$slug',
  validateSearch: (): SpecSearch => ({}),
});

export const activeAliasRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/active',
  beforeLoad: () => {
    throw redirect({ to: '/' });
  },
});

export const specsArchiveAliasRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/specs/archive',
  beforeLoad: () => {
    throw redirect({ to: '/archive' });
  },
});

export const specSlugAliasRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/specs/$slug',
  beforeLoad: ({ params }: { params: { slug: string } }) => {
    throw redirect({
      to: '/specs/$source/$slug',
      params: { source: 'active', slug: params.slug },
    });
  },
});

export const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/ai/sessions/$provider/$sessionId',
  validateSearch: (search: Record<string, unknown>): ChatSearch => ({
    turnId: typeof search.turnId === 'string' ? search.turnId : undefined,
  }),
});

export const specChatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/specs/$source/$slug/sessions/$provider/$sessionId',
  validateSearch: (search: Record<string, unknown>): ChatSearch => ({
    turnId: typeof search.turnId === 'string' ? search.turnId : undefined,
  }),
});

export const routeTree = rootRoute.addChildren([
  appLayoutRoute.addChildren([
    indexRoute,
    archiveRoute,
    specRoute,
    activeAliasRoute,
    specsArchiveAliasRoute,
    specSlugAliasRoute,
  ]),
  chatRoute,
  specChatRoute,
]);

export function createAppRouter(history?: any) {
  return createRouter({
    routeTree,
    history,
    defaultPreload: 'intent',
  });
}
