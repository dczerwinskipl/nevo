import Fastify from 'fastify';
import { registerGlobalHttpInfrastructure } from '../../server/infrastructure/http.mjs';
import aiRoutes from '../../server/ai/routes.mjs';

// `service`/`accessPolicy` are the AI slice's own local override options
// (see ai/routes.mjs's own comment) — this builds a bare Fastify instance
// with the same global infra app.mjs installs, registering just the AI
// capability directly, never routed through `buildDashboardApp()`'s config.
// Lives under `tools/dashboard/` (not `tools/tests/`) so its own `fastify`
// import resolves against `tools/dashboard/node_modules` regardless of
// which test file — inside or outside this project — imports it.
export async function buildAiTestApp({ service, accessPolicy, config } = {}) {
  const app = Fastify({ bodyLimit: 4096, exposeHeadRoutes: false });
  await registerGlobalHttpInfrastructure(app);
  await app.register(aiRoutes, { service, accessPolicy, config });
  return app;
}
