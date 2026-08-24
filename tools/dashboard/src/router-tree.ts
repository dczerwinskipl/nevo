import {
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';

export interface SpecSearch {}

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

export const specChatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/specs/$source/$slug/sessions/$sessionId',
});

export const routeTree = rootRoute.addChildren([
  appLayoutRoute.addChildren([
    indexRoute,
    archiveRoute,
    specRoute,
  ]),
  specChatRoute,
]);

export function createAppRouter(history?: any) {
  return createRouter({
    routeTree,
    history,
    defaultPreload: 'intent',
  });
}
