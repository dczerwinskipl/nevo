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
  originSpecSlug?: string;
  originSpecSource?: 'active' | 'archive';
  originTaskId?: string;
  restoreTaskId?: string;
}

export function createSessionSwitchNavigator(
  navigate: (opts: any) => Promise<any> | void,
  historyState?: NavigationHistoryState
) {
  return (session: AiSession) => {
    const effectiveSessionId = session.providerSessionId || session.sessionId;
    return navigate({
      to: '/ai/sessions/$provider/$sessionId',
      params: { provider: session.provider, sessionId: effectiveSessionId },
      state: (prev: any) => ({ ...prev, ...(historyState || {}) }),
      replace: true,
    });
  };
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
]);

export function createAppRouter(history?: any) {
  return createRouter({
    routeTree,
    history,
    defaultPreload: 'intent',
  });
}
