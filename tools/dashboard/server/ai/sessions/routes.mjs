import {
  PROVIDER_PATTERN,
  TURN_PATTERN,
  UUID_PATTERN,
  assertBodyObject,
  validatedSegment,
  validatedSessionId,
} from './http.mjs';
import { authorize } from '../access-policy.mjs';
import { AiValidationError, validateAiMessage } from '../contracts.mjs';

const SESSION_CREATE_BODY_LIMIT = 16_384;
const SESSION_PATCH_BODY_LIMIT = 4_096;

/**
 * Session routes: parse HTTP input, call one `AgentSessionService` operation,
 * map the result to HTTP output. No route here touches
 * `service.bindingService`/`service.registry`/`service.transcriptCache`
 * directly — that composition lives behind `service.createSession`/
 * `getSessionDetails`/`updateSessionMode`/`deleteSession`.
 */
export default async function sessionRoutes(fastify, { service, accessPolicy }) {
  fastify.get('/api/agent-sessions', async (request, reply) => {
    authorize(accessPolicy, 'read', request);
    const specId = request.query?.specId || undefined;
    const taskId = request.query?.taskId || undefined;
    const provider = request.query?.provider || undefined;
    if (specId && !UUID_PATTERN.test(specId)) throw new AiValidationError('Invalid specification ID.');
    if (taskId && !TURN_PATTERN.test(taskId)) throw new AiValidationError('Invalid task ID.');
    if (provider && !PROVIDER_PATTERN.test(provider)) throw new AiValidationError('Invalid provider ID.');
    reply.send({ sessions: await service.listSessions({ specId, taskId, provider }) });
  });

  fastify.post('/api/agent-sessions', { bodyLimit: SESSION_CREATE_BODY_LIMIT }, async (request, reply) => {
    authorize(accessPolicy, 'control', request);
    const body = assertBodyObject(request.body);
    const provider = validatedSegment(body.provider, PROVIDER_PATTERN, 'provider ID');
    if (!UUID_PATTERN.test(body.specId || '')) throw new AiValidationError('Invalid specification ID.');

    if (body.providerSessionId) {
      const providerSessionId = validatedSessionId(body.providerSessionId);
      if (body.taskId && !TURN_PATTERN.test(body.taskId)) throw new AiValidationError('Invalid task ID.');
      if (body.taskIds !== undefined && (!Array.isArray(body.taskIds) || body.taskIds.some(taskId => typeof taskId !== 'string' || !TURN_PATTERN.test(taskId)))) {
        throw new AiValidationError('Task IDs must be an array of stable IDs.');
      }
      const session = await service.attachSession(provider, {
        providerSessionId,
        specId: body.specId,
        taskId: body.taskId,
        taskIds: body.taskIds,
        purpose: body.purpose,
        mode: body.mode,
      });
      reply.code(201).send({ session });
      return;
    }

    if (body.taskIds !== undefined && (!Array.isArray(body.taskIds) || body.taskIds.some(taskId => typeof taskId !== 'string' || !TURN_PATTERN.test(taskId)))) {
      throw new AiValidationError('Task IDs must be an array of stable IDs.');
    }
    if (body.taskId !== undefined && !TURN_PATTERN.test(body.taskId)) {
      throw new AiValidationError('Invalid task ID.');
    }

    console.log(`[ai] [session:create] provider=${provider} specId=${body.specId} taskId=${body.taskId || '-'}${body.mode ? ` mode=${body.mode}` : ''}`);
    const session = await service.createSession(provider, {
      specId: body.specId,
      taskId: body.taskId,
      taskIds: body.taskIds,
      mode: body.mode,
      ...(body.title === undefined ? {} : { title: body.title }),
      ...(body.purpose === undefined ? {} : { purpose: body.purpose }),
    });
    reply.code(201).send({ session });
  });

  fastify.get('/api/agent-sessions/:provider/:providerSessionId', async (request, reply) => {
    const provider = validatedSegment(request.params.provider, PROVIDER_PATTERN, 'provider ID');
    const providerSessionId = validatedSessionId(request.params.providerSessionId);
    authorize(accessPolicy, 'read', request);
    reply.send({ session: await service.getSessionDetails(provider, providerSessionId) });
  });

  fastify.patch('/api/agent-sessions/:provider/:providerSessionId', { bodyLimit: SESSION_PATCH_BODY_LIMIT }, async (request, reply) => {
    const provider = validatedSegment(request.params.provider, PROVIDER_PATTERN, 'provider ID');
    const providerSessionId = validatedSessionId(request.params.providerSessionId);
    authorize(accessPolicy, 'control', request);
    const body = assertBodyObject(request.body);
    if (body.mode) {
      const session = await service.updateSessionMode(provider, providerSessionId, body.mode);
      reply.send({ session });
      return;
    }
    reply.send({ ok: true });
  });

  fastify.delete('/api/agent-sessions/:provider/:providerSessionId', async (request, reply) => {
    const provider = validatedSegment(request.params.provider, PROVIDER_PATTERN, 'provider ID');
    const providerSessionId = validatedSessionId(request.params.providerSessionId);
    authorize(accessPolicy, 'control', request);
    reply.send(await service.deleteSession(provider, providerSessionId));
  });

  fastify.get('/api/agent-sessions/:provider/:providerSessionId/messages', async (request, reply) => {
    authorize(accessPolicy, 'read', request);
    const provider = validatedSegment(request.params.provider, PROVIDER_PATTERN, 'provider ID');
    const sessionId = validatedSessionId(request.params.providerSessionId);
    const messages = (await service.listMessages(provider, sessionId)).map(validateAiMessage);
    reply.send({ messages });
  });
}
