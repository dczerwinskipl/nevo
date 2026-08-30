import {
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';

export interface SpecSearch {}

export const rootRoute = createRootRoute();

export const specificationLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'specification-layout',
});

export const indexRoute = createRoute({
  getParentRoute: () => specificationLayoutRoute,
  path: '/',
});

export const archiveRoute = createRoute({
  getParentRoute: () => specificationLayoutRoute,
  path: '/archive',
});

export const specRoute = createRoute({
  getParentRoute: () => specificationLayoutRoute,
  path: '/specs/$source/$slug',
  validateSearch: (): SpecSearch => ({}),
});

export const agentSessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/specs/$source/$slug/sessions/$provider/$providerSessionId',
});

export const routeTree = rootRoute.addChildren([
  specificationLayoutRoute.addChildren([
    indexRoute,
    archiveRoute,
    specRoute,
  ]),
  agentSessionRoute,
]);

export function createAppRouter(history?: any) {
  return createRouter({
    routeTree,
    history,
    defaultPreload: 'intent',
  });
}
