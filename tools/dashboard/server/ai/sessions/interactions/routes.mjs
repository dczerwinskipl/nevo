import {
  PROVIDER_PATTERN,
  TURN_PATTERN,
  assertBodyObject,
  validatedSegment,
  validatedSessionId,
} from '../http.mjs';
import { authorize } from '../../access-policy.mjs';

const RESPOND_BODY_LIMIT = 16_384;

export default async function interactionRoutes(fastify, { service, accessPolicy }) {
  fastify.post(
    '/api/agent-sessions/:provider/:providerSessionId/interactions/:interactionId/respond',
    { bodyLimit: RESPOND_BODY_LIMIT },
    async (request, reply) => {
      const provider = validatedSegment(request.params.provider, PROVIDER_PATTERN, 'provider ID');
      const providerSessionId = validatedSessionId(request.params.providerSessionId);
      const interactionId = validatedSegment(request.params.interactionId, TURN_PATTERN, 'interaction ID');
      authorize(accessPolicy, 'control', request);
      const body = assertBodyObject(request.body);

      const turnId = body.turnId ? validatedSegment(body.turnId, TURN_PATTERN, 'turn ID') : undefined;
      console.log(`[ai] [interaction:resolve] provider=${provider} session=${providerSessionId} interaction=${interactionId}${turnId ? ` turnId=${turnId}` : ''}`);

      const turn = await service.resolveInteraction(turnId, interactionId, body, { provider, providerSessionId });
      reply.send({ turn });
    },
  );
}
