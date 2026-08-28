import {
  createDefaultDashboardAiService,
  createTrustedNetworkAiAccessPolicy,
} from '../../ai-services.mjs';
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
 * turns, interactions, events). `config.ai` is this capability's own,
 * opaque-to-the-root override namespace: tests pass a stub `service`
 * through it; app.mjs never reads or forwards individual fields out of it.
 */
export default async function aiRoutes(fastify, { config = {} } = {}) {
  const aiConfig = config.ai || {};
  const service = aiConfig.service ?? (aiConfig.serviceFactory ?? createDefaultDashboardAiService)();
  const accessPolicy = aiConfig.accessPolicy ?? createTrustedNetworkAiAccessPolicy();

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
