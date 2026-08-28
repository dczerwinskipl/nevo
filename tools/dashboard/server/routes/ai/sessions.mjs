import { registerMethodFallback } from '../../http-compat.mjs';
import {
  PROVIDER_PATTERN,
  TURN_PATTERN,
  UUID_PATTERN,
  authorize,
  assertBodyObject,
  validatedSegment,
  validatedSessionId,
} from './shared.mjs';
import { AiValidationError, validateAiMessage } from '../../../../ai/contracts.mjs';

const SESSION_CREATE_BODY_LIMIT = 16_384;
const SESSION_PATCH_BODY_LIMIT = 4_096;

async function listSessionsHandler(getAiService, aiAccessPolicy, request, reply) {
  authorize(aiAccessPolicy, 'read', request);
  const specId = request.query?.specId || undefined;
  const taskId = request.query?.taskId || undefined;
  const provider = request.query?.provider || undefined;
  if (specId && !UUID_PATTERN.test(specId)) throw new AiValidationError('Invalid specification ID.');
  if (taskId && !TURN_PATTERN.test(taskId)) throw new AiValidationError('Invalid task ID.');
  if (provider && !PROVIDER_PATTERN.test(provider)) throw new AiValidationError('Invalid provider ID.');
  reply.send({ sessions: await getAiService().listSessions({ specId, taskId, provider }) });
}

async function createSessionHandler(getAiService, aiAccessPolicy, request, reply) {
  authorize(aiAccessPolicy, 'control', request);
  const body = assertBodyObject(request.body);
  const provider = validatedSegment(body.provider, PROVIDER_PATTERN, 'provider ID');
  const service = getAiService();
  if (!UUID_PATTERN.test(body.specId || '')) throw new AiValidationError('Invalid specification ID.');

  if (body.providerSessionId) {
    const providerSessionId = validatedSessionId(body.providerSessionId);
    if (body.taskId && !TURN_PATTERN.test(body.taskId)) throw new AiValidationError('Invalid task ID.');
    if (body.taskIds !== undefined && (!Array.isArray(body.taskIds) || body.taskIds.some(taskId => typeof taskId !== 'string' || !TURN_PATTERN.test(taskId)))) {
      throw new AiValidationError('Task IDs must be an array of stable IDs.');
    }
    const taskIds = Array.isArray(body.taskIds)
      ? body.taskIds.filter(Boolean)
      : (body.taskId ? [body.taskId] : []);
    let binding;
    if (service.bindingService) {
      if (taskIds.length > 0) {
        for (const taskId of taskIds) {
          binding = await service.bindingService.bindSession({
            provider,
            providerSessionId,
            specId: body.specId,
            taskId,
            purpose: body.purpose,
            mode: body.mode,
          });
        }
      } else {
        binding = await service.bindingService.bindSession({
          provider,
          providerSessionId,
          specId: body.specId,
          taskId: body.taskId,
          purpose: body.purpose,
          mode: body.mode,
        });
      }
    } else {
      binding = { provider, providerSessionId, specId: body.specId, taskId: body.taskId, mode: body.mode };
    }
    reply.code(201).send({ session: { ...binding, taskIds, taskId: body.taskId || (taskIds[0] || undefined) } });
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
}

async function getSessionHandler(getAiService, aiAccessPolicy, request, reply) {
  const provider = validatedSegment(request.params.provider, PROVIDER_PATTERN, 'provider ID');
  const providerSessionId = validatedSessionId(request.params.providerSessionId);
  authorize(aiAccessPolicy, 'read', request);
  const service = getAiService();

  // Reading durable history must not depend on the adapter currently being
  // enabled. Starting a new turn still goes through registry.get().
  const descriptor = service.registry?.has(provider)
    ? service.registry.get(provider).descriptor
    : undefined;
  const capabilities = descriptor?.capabilities || {};

  const binding = await service.getSession(provider, providerSessionId);
  const taskIds = binding?.taskIds || (binding?.taskId ? [binding.taskId] : []);
  const specId = binding?.specId;

  const transcript = service.transcriptCache
    ? await service.transcriptCache.getTranscript(provider, providerSessionId)
    : await service.getTranscript(provider, providerSessionId);

  const { status, activeTurn, pendingInteraction } = service.resolveSessionActivity(transcript);
  const resolvedMode = binding?.mode ?? descriptor?.defaultMode ?? 'edit';

  reply.send({
    session: {
      provider,
      providerSessionId,
      sessionId: providerSessionId,
      status,
      capabilities,
      mode: resolvedMode,
      specId: specId ?? binding?.specId,
      taskId: binding?.taskId,
      taskIds,
      purpose: binding?.purpose,
      title: binding?.title || binding?.purpose || `${provider} session`,
      createdAt: binding?.createdAt || transcript?.createdAt || transcript?.updatedAt || new Date().toISOString(),
      lastSeenAt: binding?.lastSeenAt || transcript?.updatedAt || new Date().toISOString(),
      lastActivityAt: binding?.lastSeenAt || transcript?.updatedAt || new Date().toISOString(),
      activeTurn,
      pendingInteraction,
      messages: transcript?.messages || [],
      lastEventSeq: transcript?.lastEventSeq || 0,
      updatedAt: transcript?.updatedAt || new Date().toISOString(),
    },
  });
}

async function patchSessionHandler(getAiService, aiAccessPolicy, request, reply) {
  const provider = validatedSegment(request.params.provider, PROVIDER_PATTERN, 'provider ID');
  const providerSessionId = validatedSessionId(request.params.providerSessionId);
  authorize(aiAccessPolicy, 'control', request);
  const body = assertBodyObject(request.body);
  if (body.mode) {
    const session = await getAiService().updateSessionMode(provider, providerSessionId, body.mode);
    reply.send({ session });
    return;
  }
  reply.send({ ok: true });
}

async function deleteSessionHandler(getAiService, aiAccessPolicy, request, reply) {
  const provider = validatedSegment(request.params.provider, PROVIDER_PATTERN, 'provider ID');
  const providerSessionId = validatedSessionId(request.params.providerSessionId);
  authorize(aiAccessPolicy, 'control', request);
  const service = getAiService();
  if (service.bindingService) {
    await service.bindingService.unbindSession(provider, providerSessionId);
  }
  if (service.transcriptCache) {
    await service.transcriptCache.deleteTranscript(provider, providerSessionId);
  }
  reply.send({ unbind: true, deleted: true });
}

async function messagesHandler(getAiService, aiAccessPolicy, request, reply) {
  authorize(aiAccessPolicy, 'read', request);
  const provider = validatedSegment(request.params.provider, PROVIDER_PATTERN, 'provider ID');
  const sessionId = validatedSessionId(request.params.providerSessionId);
  const messages = (await getAiService().listMessages(provider, sessionId)).map(validateAiMessage);
  reply.send({ messages });
}

export function registerSessionRoutes(fastify, { getAiService, aiAccessPolicy }) {
  const listOrGet = (handler) => (request, reply) => handler(getAiService, aiAccessPolicy, request, reply);

  for (const path of ['/api/agent-sessions', '/api/ai/sessions']) {
    fastify.get(path, listOrGet(listSessionsHandler));
    fastify.post(path, { bodyLimit: SESSION_CREATE_BODY_LIMIT }, listOrGet(createSessionHandler));
    registerMethodFallback(fastify, path, ['GET', 'POST']);
  }

  for (const path of ['/api/agent-sessions/:provider/:providerSessionId', '/api/ai/sessions/:provider/:providerSessionId']) {
    fastify.get(path, listOrGet(getSessionHandler));
    fastify.patch(path, { bodyLimit: SESSION_PATCH_BODY_LIMIT }, listOrGet(patchSessionHandler));
    fastify.delete(path, listOrGet(deleteSessionHandler));
    registerMethodFallback(fastify, path, ['GET', 'PATCH', 'DELETE']);
  }

  for (const path of ['/api/agent-sessions/:provider/:providerSessionId/messages', '/api/ai/sessions/:provider/:providerSessionId/messages']) {
    fastify.get(path, listOrGet(messagesHandler));
    registerMethodFallback(fastify, path, ['GET']);
  }
}
