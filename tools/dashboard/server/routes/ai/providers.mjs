import { registerMethodFallback } from '../../http-compat.mjs';
import { authorize } from './shared.mjs';

export function registerProviderRoutes(fastify, { getAiService, aiAccessPolicy }) {
  const handler = async (request, reply) => {
    authorize(aiAccessPolicy, 'read', request);
    reply.send({
      providers: getAiService().listProviders(),
      access: { mode: 'trusted-network', identityAuthenticated: false },
    });
  };

  fastify.get('/api/agent-providers', handler);
  registerMethodFallback(fastify, '/api/agent-providers', ['GET']);

  // Legacy alias.
  fastify.get('/api/ai/providers', handler);
  registerMethodFallback(fastify, '/api/ai/providers', ['GET']);
}
