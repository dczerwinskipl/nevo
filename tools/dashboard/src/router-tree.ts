import {
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';

import type { AiSession } from './lib/types';

export interface SpecSearch {}

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

export function resolveSessionDestination(
  session: { provider: string; sessionId: string; providerSessionId?: string; specId?: string | null },
  specs: Array<{ specId?: string | null; source: 'active' | 'archive'; slug: string }>
): SessionRouteDestination {
  const effectiveSessionId = session.providerSessionId || session.sessionId;

  if (session.specId) {
    const owningSpec = specs.find((s) => s.specId === session.specId);
    if (!owningSpec) {
      throw new Error(`Nie znaleziono specyfikacji o ID '${session.specId}' dla sesji '${effectiveSessionId}'.`);
    }
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

  return {
    to: '/ai/sessions/$provider/$sessionId',
    params: {
      provider: session.provider,
      sessionId: effectiveSessionId,
    },
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

export const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/ai/sessions/$provider/$sessionId',
});

export const specChatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/specs/$source/$slug/sessions/$provider/$sessionId',
});

export const routeTree = rootRoute.addChildren([
  appLayoutRoute.addChildren([
    indexRoute,
    archiveRoute,
    specRoute,
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
