export default async function healthRoutes(fastify) {
  fastify.get('/api/health', async (request, reply) => {
    reply.code(200).send({ status: 'ok' });
  });
}
