import { authorize } from './shared.mjs';

export default async function providerRoutes(fastify, { service, accessPolicy }) {
  fastify.get('/api/agent-providers', async (request, reply) => {
    authorize(accessPolicy, 'read', request);
    reply.send({
      providers: service.listProviders(),
      access: { mode: 'trusted-network', identityAuthenticated: false },
    });
  });
}
