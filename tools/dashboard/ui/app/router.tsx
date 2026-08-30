import { Outlet } from '@tanstack/react-router';

import { SpecificationConsoleLayout } from '@/features/specifications/specification-console-layout';
import { ActiveSpecificationsRoute } from '@/features/specifications/list/active-specifications-route';
import { ArchiveSpecificationsRoute } from '@/features/specifications/list/archive-specifications-route';
import { SpecificationRoute } from '@/features/specifications/detail/specification-route';
import { AgentSessionRoute } from '@/features/agent-sessions/agent-session-route';
import {
  rootRoute,
  specificationLayoutRoute,
  indexRoute,
  archiveRoute,
  specRoute,
  agentSessionRoute,
  createAppRouter,
} from '@/router-tree';

// Bind route definitions (router-tree.ts) to their feature-owned route
// components. This file is intentionally just composition — it owns no
// Specification or Agent Session logic itself.
rootRoute.update({ component: () => <Outlet /> });
specificationLayoutRoute.update({ component: SpecificationConsoleLayout });
indexRoute.update({ component: ActiveSpecificationsRoute });
archiveRoute.update({ component: ArchiveSpecificationsRoute });
specRoute.update({ component: SpecificationRoute });
agentSessionRoute.update({ component: AgentSessionRoute });

export const router = createAppRouter();

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
