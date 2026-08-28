import {
  createDefaultDashboardAiService,
  createTrustedNetworkAiAccessPolicy,
} from '../../ai-services.mjs';
import { permissiveAiJsonParser, aiErrorHandler } from './shared.mjs';
import { registerProviderRoutes } from './providers.mjs';
import { registerSessionRoutes } from './sessions.mjs';
import { registerTurnRoutes } from './turns.mjs';
import { registerInteractionRoutes } from './interactions.mjs';
import { registerAiEventRoutes } from './events.mjs';

/**
 * AI/agent-session capability entry point. Registers real Fastify routes
 * (method + path + params + query + body all resolved by Fastify itself) —
 * one sub-module per concern (providers, sessions, turns, interactions,
 * events) — instead of a second, internal URL router behind a single
 * wildcard/hijack handler.
 */
export function registerAiRoutes(fastify, {
  aiService,
  aiServiceFactory = createDefaultDashboardAiService,
  aiAccessPolicy = createTrustedNetworkAiAccessPolicy(),
} = {}) {
  let resolvedAiService = aiService;
  const getAiService = () => {
    resolvedAiService ||= aiServiceFactory();
    return resolvedAiService;
  };

  let aiReconciliationPromise = null;
  const ensureAiReconciled = () => {
    const service = getAiService();
    if (!aiReconciliationPromise) {
      aiReconciliationPromise = Promise.resolve(service.turnRuntime?.reconcileOrphanedTurns?.()).catch(err => {
        console.error(`[ai] [reconcile] boot-time turn reconciliation failed: ${err.message}`);
      });
    }
    return aiReconciliationPromise;
  };

  fastify.register(async (scoped) => {
    // Content-type-agnostic JSON parsing scoped to this plugin only,
    // matching the previous `readJsonBody` contract exactly. Each route
    // still declares its own `bodyLimit` (128 KiB for turns, 16 KiB for
    // session/control payloads, 4096 B for smaller updates, 512 B where the
    // body is read only for its size contract) — see area
    // dashboard-server-runtime.md's per-endpoint limits.
    scoped.removeAllContentTypeParsers();
    scoped.addContentTypeParser('*', { parseAs: 'string' }, permissiveAiJsonParser);
    scoped.setErrorHandler(aiErrorHandler);

    scoped.addHook('onRequest', async () => {
      await ensureAiReconciled();
    });

    const deps = { getAiService, aiAccessPolicy };
    registerProviderRoutes(scoped, deps);
    registerSessionRoutes(scoped, deps);
    registerTurnRoutes(scoped, deps);
    registerInteractionRoutes(scoped, deps);
    registerAiEventRoutes(scoped, deps);
  });

  // Owned here: this capability created (or was given) the AI service and
  // is the only one that knows how to shut it down.
  fastify.addHook('onClose', async () => {
    try {
      await (resolvedAiService?.shutdown?.() ?? resolvedAiService?.turnRuntime?.shutdown?.());
    } catch (err) {
      console.error('[server] error shutting down AI adapter:', err);
    }
  });
}
