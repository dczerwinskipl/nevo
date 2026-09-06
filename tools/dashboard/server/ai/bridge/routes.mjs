import { assertBodyObject } from '../sessions/http.mjs';
import { interactionBridgeHub } from './interaction-bridge-hub.mjs';

const BRIDGE_ASK_BODY_LIMIT = 32_768;

export default async function bridgeRoutes(fastify, { interactionHub = interactionBridgeHub } = {}) {
  fastify.post(
    '/api/ai/bridge/ask',
    { bodyLimit: BRIDGE_ASK_BODY_LIMIT },
    async (request, reply) => {
      // Ensure loopback access only
      const clientIp = request.ip;
      if (
        clientIp &&
        clientIp !== '127.0.0.1' &&
        clientIp !== '::1' &&
        clientIp !== '::ffff:127.0.0.1' &&
        clientIp !== 'localhost'
      ) {
        reply.code(403).send({ message: 'Forbidden: bridge requests only allowed from loopback' });
        return;
      }

      const body = assertBodyObject(request.body);
      const bridgeToken = request.headers['x-bridge-token'] || body.bridgeToken || body.token;

      const {
        provider = 'claude',
        providerSessionId,
        turnId,
        question,
        header,
        options,
        multiSelect,
      } = body;

      try {
        const result = await interactionHub.handleAsk({
          provider,
          providerSessionId,
          turnId,
          bridgeToken,
          question,
          header,
          options,
          multiSelect,
        });

        reply.send(result);
      } catch (err) {
        const statusCode = typeof err.status === 'number' ? err.status : 500;
        reply.code(statusCode).send({
          code: err.code || 'AI_BRIDGE_ERROR',
          message: err.message,
        });
      }
    },
  );
}
