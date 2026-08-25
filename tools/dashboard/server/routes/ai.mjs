import { handleAiRequest } from '../ai-routes.mjs';
import { sendJson, readJsonBody } from '../http-utils.mjs';
import {
  createDefaultDashboardAiService,
  createTrustedNetworkAiAccessPolicy,
} from '../ai-services.mjs';

export function createAiRouteAdapter({
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

  const handleAiRoute = async ({ request, response, method, url }) => {
    const isAiPath =
      url.pathname.startsWith('/api/ai/') ||
      url.pathname === '/api/agent-sessions' ||
      url.pathname.startsWith('/api/agent-sessions/') ||
      url.pathname === '/api/agent-providers' ||
      url.pathname.startsWith('/api/agent-providers/');

    if (!isAiPath) {
      return false;
    }

    await ensureAiReconciled();
    await handleAiRequest({
      request,
      response,
      method,
      url,
      service: getAiService(),
      accessPolicy: aiAccessPolicy,
      sendJson,
      readJsonBody,
    });
    return true;
  };

  return {
    handleAiRoute,
    getAiService,
    shutdown: async () => {
      await (resolvedAiService?.shutdown?.() ?? resolvedAiService?.turnRuntime?.shutdown?.());
    },
  };
}
