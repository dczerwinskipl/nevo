import { registerMethodFallback } from '../http-compat.mjs';

export function registerHealthRoutes(fastify) {
  fastify.get('/api/health', async (request, reply) => {
    reply.code(200).send({ status: 'ok' });
  });
  registerMethodFallback(fastify, '/api/health', ['GET']);
}
