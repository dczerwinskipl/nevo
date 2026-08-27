export function registerHealthRoutes(fastify) {
  fastify.all('/api/health', async (request, reply) => {
    if (request.method !== 'GET') {
      reply.code(405).send({ error: 'Method not allowed' });
      return;
    }
    reply.code(200).send({ status: 'ok' });
  });
}
