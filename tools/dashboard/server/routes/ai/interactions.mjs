import { registerMethodFallback } from '../../http-compat.mjs';
import {
  PROVIDER_PATTERN,
  TURN_PATTERN,
  authorize,
  assertBodyObject,
  validatedSegment,
  validatedSessionId,
} from './shared.mjs';

const RESPOND_BODY_LIMIT = 16_384;

export function registerInteractionRoutes(fastify, { getAiService, aiAccessPolicy }) {
  // Canonical: correlated to provider + session + interaction.
  fastify.post(
    '/api/agent-sessions/:provider/:providerSessionId/interactions/:interactionId/respond',
    { bodyLimit: RESPOND_BODY_LIMIT },
    async (request, reply) => {
      const provider = validatedSegment(request.params.provider, PROVIDER_PATTERN, 'provider ID');
      const providerSessionId = validatedSessionId(request.params.providerSessionId);
      const interactionId = validatedSegment(request.params.interactionId, TURN_PATTERN, 'interaction ID');
      authorize(aiAccessPolicy, 'control', request);
      const body = assertBodyObject(request.body);

      const turnId = body.turnId ? validatedSegment(body.turnId, TURN_PATTERN, 'turn ID') : undefined;
      console.log(`[ai] [interaction:resolve] provider=${provider} session=${providerSessionId} interaction=${interactionId}${turnId ? ` turnId=${turnId}` : ''}`);

      const turn = await getAiService().resolveInteraction(turnId, interactionId, body, { provider, providerSessionId });
      reply.send({ turn });
    },
  );
  registerMethodFallback(
    fastify,
    '/api/agent-sessions/:provider/:providerSessionId/interactions/:interactionId/respond',
    ['POST'],
  );

  // Legacy: correlated to turn only.
  fastify.post(
    '/api/ai/turns/:turnId/interactions/:interactionId/response',
    { bodyLimit: RESPOND_BODY_LIMIT },
    async (request, reply) => {
      const turnId = validatedSegment(request.params.turnId, TURN_PATTERN, 'turn ID');
      const interactionId = validatedSegment(request.params.interactionId, TURN_PATTERN, 'interaction ID');
      authorize(aiAccessPolicy, 'control', request);
      const body = assertBodyObject(request.body);
      reply.send({ turn: await getAiService().resolveInteraction(turnId, interactionId, body) });
    },
  );
  registerMethodFallback(fastify, '/api/ai/turns/:turnId/interactions/:interactionId/response', ['POST']);
}
