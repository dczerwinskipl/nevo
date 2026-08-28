import {
  PROVIDER_PATTERN,
  TURN_PATTERN,
  UUID_PATTERN,
  authorize,
  assertBodyObject,
  validatedSegment,
  validatedSessionId,
} from './shared.mjs';
import { AiValidationError } from '../../../ai/contracts.mjs';

const TURN_BODY_LIMIT = 128 * 1024;
const CANCEL_BODY_LIMIT = 512;

export default async function turnRoutes(fastify, { service, accessPolicy }) {
  // Atomic first-turn + session creation.
  fastify.post('/api/agent-sessions/turns', { bodyLimit: TURN_BODY_LIMIT }, async (request, reply) => {
    authorize(accessPolicy, 'control', request);
    const body = assertBodyObject(request.body);
    const provider = validatedSegment(body.provider, PROVIDER_PATTERN, 'provider ID');
    if (body.specId && !UUID_PATTERN.test(body.specId)) throw new AiValidationError('Invalid specification ID.');
    if (body.taskId && !TURN_PATTERN.test(body.taskId)) throw new AiValidationError('Invalid task ID.');
    console.log(`[ai] [turn:start] provider=${provider} session=new specId=${body.specId || '-'} taskId=${body.taskId || '-'}${body.mode ? ` mode=${body.mode}` : ''}`);
    const result = await service.startTurn(provider, undefined, {
      message: body.message ?? body.prompt,
      specId: body.specId,
      taskId: body.taskId,
      purpose: body.purpose,
      mode: body.mode,
      idempotencyKey: body.idempotencyKey,
    });
    console.log(`[ai] [turn:started] provider=${provider} session=${result.providerSessionId} turnId=${result.turnId} idempotent=${result.idempotent}`);
    reply.code(result.idempotent ? 200 : 201).send(result);
  });

  // Subsequent turns on an existing session.
  fastify.post(
    '/api/agent-sessions/:provider/:providerSessionId/turns',
    { bodyLimit: TURN_BODY_LIMIT },
    async (request, reply) => {
      authorize(accessPolicy, 'control', request);
      const body = assertBodyObject(request.body);
      const provider = validatedSegment(request.params.provider, PROVIDER_PATTERN, 'provider ID');
      const sessionId = validatedSessionId(request.params.providerSessionId);
      console.log(`[ai] [turn:start] provider=${provider} session=${sessionId}${body.mode ? ` mode=${body.mode}` : ''} prompt="${(body.message ?? body.prompt ?? '').slice(0, 60)}"`);
      const result = await service.startTurn(provider, sessionId, {
        message: body.message ?? body.prompt,
        mode: body.mode,
        ...(body.idempotencyKey === undefined ? {} : { idempotencyKey: body.idempotencyKey }),
      });
      console.log(`[ai] [turn:started] provider=${provider} session=${result.providerSessionId} turnId=${result.turnId} idempotent=${result.idempotent}`);
      reply.code(result.idempotent ? 200 : 202).send(result);
    },
  );

  // Cancel, correlated to session + turn.
  fastify.post(
    '/api/agent-sessions/:provider/:providerSessionId/turns/:turnId/cancel',
    { bodyLimit: CANCEL_BODY_LIMIT },
    async (request, reply) => {
      const provider = validatedSegment(request.params.provider, PROVIDER_PATTERN, 'provider ID');
      const providerSessionId = validatedSessionId(request.params.providerSessionId);
      const turnId = validatedSegment(request.params.turnId, TURN_PATTERN, 'turn ID');
      authorize(accessPolicy, 'control', request);
      // Body content is intentionally unused — only its size contract matters.
      console.log(`[ai] [turn:cancel] provider=${provider} session=${providerSessionId} turnId=${turnId}`);
      const turn = await service.cancelTurn(turnId, { provider, providerSessionId });
      reply.send({ turn });
    },
  );
}
