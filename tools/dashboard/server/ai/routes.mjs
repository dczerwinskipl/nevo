import {
  createDefaultDashboardAiService,
  createTrustedNetworkAiAccessPolicy,
} from './services.mjs';
import { aiErrorHandler } from './shared.mjs';
import providerRoutes from './providers.mjs';
import sessionRoutes from './sessions.mjs';
import turnRoutes from './turns.mjs';
import interactionRoutes from './interactions.mjs';
import aiEventRoutes from './events.mjs';

/**
 * AI/agent-session capability entry point. Constructs the AI service and
 * access policy locally — the application root (app.mjs) never sees them —
 * and registers one real Fastify route per concern (providers, sessions,
 * turns, interactions, events). `service`/`accessPolicy` are this plugin's
 * own local override options — a feature-level test seam for registering
 * this capability directly on a bare Fastify instance — never routed
 * through `buildDashboardApp()`'s `config`; real usage never passes them,
 * so the real defaults below always apply.
 */
export default async function aiRoutes(fastify, { config = {}, service: serviceOverride, accessPolicy: accessPolicyOverride } = {}) {
  const service = serviceOverride ?? createDefaultDashboardAiService();
  const accessPolicy = accessPolicyOverride ?? createTrustedNetworkAiAccessPolicy();

  let reconciliationPromise = null;
  const ensureReconciled = () => {
    if (!reconciliationPromise) {
      reconciliationPromise = Promise.resolve(service.turnRuntime?.reconcileOrphanedTurns?.()).catch(err => {
        console.error(`[ai] [reconcile] boot-time turn reconciliation failed: ${err.message}`);
      });
    }
    return reconciliationPromise;
  };

  fastify.addHook('onRequest', async () => {
    await ensureReconciled();
  });

  // AI-domain error *shape* mapping only — JSON parsing itself is inherited
  // from the application-wide parser registered once in app.mjs.
  fastify.setErrorHandler(aiErrorHandler);

  const deps = { service, accessPolicy };
  await fastify.register(providerRoutes, deps);
  await fastify.register(sessionRoutes, deps);
  await fastify.register(turnRoutes, deps);
  await fastify.register(interactionRoutes, deps);
  await fastify.register(aiEventRoutes, deps);

  // Owned here: this capability constructed (or was given) the AI service
  // and is the only one that knows how to shut it down.
  fastify.addHook('onClose', async () => {
    try {
      await (service?.shutdown?.() ?? service?.turnRuntime?.shutdown?.());
    } catch (err) {
      console.error('[server] error shutting down AI service:', err);
    }
  });
}
