import { handleAiRequest } from '../ai-routes.mjs';
import { sendJson, readJsonBody } from '../http-utils.mjs';
import {
  createDefaultDashboardAiService,
  createTrustedNetworkAiAccessPolicy,
} from '../ai-services.mjs';

const AI_ROUTE_PATTERNS = [
  '/api/ai/*',
  '/api/agent-sessions',
  '/api/agent-sessions/*',
  '/api/agent-providers',
  '/api/agent-providers/*',
];

function isAiPath(pathname) {
  return pathname.startsWith('/api/ai/')
    || pathname === '/api/agent-sessions'
    || pathname.startsWith('/api/agent-sessions/')
    || pathname === '/api/agent-providers'
    || pathname.startsWith('/api/agent-providers/');
}

/**
 * Registers the AI/agent-session capability on Fastify via `reply.hijack()`.
 * `ai-routes.mjs`'s internal behavior and structure are preserved exactly
 * (per area dashboard-server-runtime.md's own constraint) — this plugin only
 * adapts the transport boundary: Fastify's body-parsing pipeline is bypassed
 * for this capability (a wildcard passthrough content-type parser, scoped to
 * this encapsulated plugin only) so `request.raw` remains an unconsumed
 * stream, letting `handleAiRequest` keep reading it with the existing
 * `readJsonBody(request, maxBytes)` and its existing, per-endpoint byte
 * limits — never Fastify's own global JSON parser/`bodyLimit`.
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
    // Passthrough, scoped to this plugin only: without stripping the
    // inherited built-in `application/json`/`text/plain` parsers first,
    // those would still claim matching requests ahead of a `'*'`
    // registration (Fastify resolves an exact content-type match before a
    // wildcard one), draining `request.raw` before `readJsonBody` gets to
    // it. Removing them here is encapsulated to this plugin — it does not
    // affect the root app's own parser used by the other capabilities.
    scoped.removeAllContentTypeParsers();
    scoped.addContentTypeParser('*', (request, payload, done) => done(null, payload));

    const hijackToAiHandler = async (request, reply) => {
      const url = new URL(request.raw.url, 'http://127.0.0.1');
      if (!isAiPath(url.pathname)) {
        reply.code(404).send({ error: 'API route not found' });
        return;
      }
      reply.hijack();
      await ensureAiReconciled();
      await handleAiRequest({
        request: request.raw,
        response: reply.raw,
        method: request.raw.method,
        url,
        service: getAiService(),
        accessPolicy: aiAccessPolicy,
        sendJson,
        readJsonBody,
      });
    };

    // Fastify's shorthand route registration requires one string `url` per
    // call (an array throws `FST_ERR_INVALID_URL`) — register each pattern
    // individually rather than fighting that constraint.
    for (const pattern of AI_ROUTE_PATTERNS) {
      scoped.all(pattern, hijackToAiHandler);
    }
  });

  return {
    getAiService,
    shutdown: async () => {
      await (resolvedAiService?.shutdown?.() ?? resolvedAiService?.turnRuntime?.shutdown?.());
    },
  };
}
