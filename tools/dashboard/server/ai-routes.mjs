import {
  AiError,
  AiValidationError,
  publicAiError,
  validateAiMessage,
} from '../../ai/contracts.mjs';

const PROVIDER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const TURN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function decodedSegment(value, pattern, label) {
  try {
    const decoded = decodeURIComponent(value);
    if (!pattern.test(decoded)) throw new Error();
    return decoded;
  } catch {
    throw new AiValidationError(`Invalid ${label}.`);
  }
}

function decodedSessionId(value) {
  try {
    const decoded = decodeURIComponent(value);
    if (!decoded || decoded.length > 512 || /[\u0000-\u001f\u007f]/.test(decoded)) throw new Error();
    return decoded;
  } catch {
    throw new AiValidationError('Invalid session ID.');
  }
}

function assertBodyObject(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AiValidationError('Request body must be a JSON object.');
  }
  return body;
}

function assertControlRequest(request) {
  if (request.headers['x-nevo-dashboard-action'] !== '1') {
    throw new AiError('AI_CONTROL_HEADER_REQUIRED', 'Dashboard action header is required.', { status: 403 });
  }
  const origin = request.headers.origin;
  if (origin) {
    let originHost;
    try { originHost = new URL(origin).host; } catch { throw new AiError('AI_ORIGIN_REJECTED', 'Request origin is invalid.', { status: 403 }); }
    if (originHost !== request.headers.host) {
      throw new AiError('AI_ORIGIN_REJECTED', 'Cross-origin AI control requests are not allowed.', { status: 403 });
    }
  }
}

function authorize(accessPolicy, capability, request) {
  if (accessPolicy({ capability, request, mode: 'trusted-network' }) !== true) {
    throw new AiError('AI_ACCESS_DENIED', 'AI access is not allowed.', { status: 403 });
  }
  if (capability === 'control') assertControlRequest(request);
}

function writeSse(response, eventName, data, id) {
  if (id !== undefined) response.write(`id: ${id}\n`);
  response.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
}

function errorResponse(error, sendJson, response) {
  if (error?.name === 'SpecificationActionError') {
    sendJson(response, error.status || 400, { error: { code: 'AI_VALIDATION_ERROR', message: error.message } });
    return;
  }
  const normalized = publicAiError(error);
  sendJson(response, normalized.status, normalized.toJSON());
}

export async function handleAiRequest({
  request,
  response,
  method,
  url,
  service,
  accessPolicy,
  sendJson,
  readJsonBody,
}) {
  if (!url.pathname.startsWith('/api/ai/')) return false;

  try {
    if (url.pathname === '/api/ai/providers') {
      authorize(accessPolicy, 'read', request);
      if (method !== 'GET') return sendJson(response, 405, { error: 'Method not allowed' }) ?? true;
      sendJson(response, 200, {
        providers: service.listProviders(),
        access: { mode: 'trusted-network', identityAuthenticated: false },
      });
      return true;
    }

    if (url.pathname === '/api/ai/sessions') {
      if (method === 'GET') {
        authorize(accessPolicy, 'read', request);
        const specId = url.searchParams.get('specId') || undefined;
        const taskId = url.searchParams.get('taskId') || undefined;
        const provider = url.searchParams.get('provider') || undefined;
        if (specId && !UUID_PATTERN.test(specId)) throw new AiValidationError('Invalid specification ID.');
        if (taskId && !TURN_PATTERN.test(taskId)) throw new AiValidationError('Invalid task ID.');
        if (provider && !PROVIDER_PATTERN.test(provider)) throw new AiValidationError('Invalid provider ID.');
        sendJson(response, 200, { sessions: await service.listSessions({ specId, taskId, provider }) });
        return true;
      }
      if (method === 'POST') {
        authorize(accessPolicy, 'control', request);
        const body = assertBodyObject(await readJsonBody(request, 16_384));
        const provider = decodedSegment(body.provider, PROVIDER_PATTERN, 'provider ID');
        if (!UUID_PATTERN.test(body.specId || '')) throw new AiValidationError('Invalid specification ID.');
        if (!Array.isArray(body.taskIds) || body.taskIds.some(taskId => typeof taskId !== 'string' || !TURN_PATTERN.test(taskId))) {
          throw new AiValidationError('Task IDs must be an array of stable IDs.');
        }
        const session = await service.createSession(provider, {
          specId: body.specId,
          taskIds: body.taskIds,
          ...(body.title === undefined ? {} : { title: body.title }),
        });
        sendJson(response, 201, { session });
        return true;
      }
      sendJson(response, 405, { error: 'Method not allowed' });
      return true;
    }

    const messagesRoute = url.pathname.match(/^\/api\/ai\/sessions\/([^/]+)\/([^/]+)\/messages$/);
    if (messagesRoute) {
      authorize(accessPolicy, 'read', request);
      if (method !== 'GET') return sendJson(response, 405, { error: 'Method not allowed' }) ?? true;
      const provider = decodedSegment(messagesRoute[1], PROVIDER_PATTERN, 'provider ID');
      const sessionId = decodedSessionId(messagesRoute[2]);
      const messages = (await service.listMessages(provider, sessionId)).map(validateAiMessage);
      sendJson(response, 200, { messages });
      return true;
    }

    const turnsRoute = url.pathname.match(/^\/api\/ai\/sessions\/([^/]+)\/([^/]+)\/turns$/);
    if (turnsRoute) {
      authorize(accessPolicy, 'control', request);
      if (method !== 'POST') return sendJson(response, 405, { error: 'Method not allowed' }) ?? true;
      const body = assertBodyObject(await readJsonBody(request, 128 * 1024));
      const provider = decodedSegment(turnsRoute[1], PROVIDER_PATTERN, 'provider ID');
      const sessionId = decodedSessionId(turnsRoute[2]);
      const result = await service.startTurn(provider, sessionId, {
        message: body.message,
        ...(body.idempotencyKey === undefined ? {} : { idempotencyKey: body.idempotencyKey }),
      });
      sendJson(response, result.idempotent ? 200 : 202, result);
      return true;
    }

    const sessionRoute = url.pathname.match(/^\/api\/ai\/sessions\/([^/]+)\/([^/]+)$/);
    if (sessionRoute) {
      authorize(accessPolicy, 'read', request);
      if (method !== 'GET') return sendJson(response, 405, { error: 'Method not allowed' }) ?? true;
      const provider = decodedSegment(sessionRoute[1], PROVIDER_PATTERN, 'provider ID');
      const sessionId = decodedSessionId(sessionRoute[2]);
      sendJson(response, 200, { session: await service.getSession(provider, sessionId) });
      return true;
    }

    const interactionRoute = url.pathname.match(/^\/api\/ai\/turns\/([^/]+)\/interactions\/([^/]+)\/response$/);
    if (interactionRoute) {
      authorize(accessPolicy, 'control', request);
      if (method !== 'POST') return sendJson(response, 405, { error: 'Method not allowed' }) ?? true;
      const turnId = decodedSegment(interactionRoute[1], TURN_PATTERN, 'turn ID');
      const interactionId = decodedSegment(interactionRoute[2], TURN_PATTERN, 'interaction ID');
      const body = assertBodyObject(await readJsonBody(request, 16_384));
      sendJson(response, 200, { turn: await service.resolveInteraction(turnId, interactionId, body) });
      return true;
    }

    const cancelRoute = url.pathname.match(/^\/api\/ai\/turns\/([^/]+)\/cancel$/);
    if (cancelRoute) {
      authorize(accessPolicy, 'control', request);
      if (method !== 'POST') return sendJson(response, 405, { error: 'Method not allowed' }) ?? true;
      const turnId = decodedSegment(cancelRoute[1], TURN_PATTERN, 'turn ID');
      await readJsonBody(request, 512);
      sendJson(response, 200, { turn: await service.cancelTurn(turnId) });
      return true;
    }

    const eventRoute = url.pathname.match(/^\/api\/ai\/turns\/([^/]+)\/events$/);
    if (eventRoute) {
      authorize(accessPolicy, 'read', request);
      if (method !== 'GET') return sendJson(response, 405, { error: 'Method not allowed' }) ?? true;
      const turnId = decodedSegment(eventRoute[1], TURN_PATTERN, 'turn ID');
      const headerCursor = request.headers['last-event-id'];
      const queryCursor = url.searchParams.get('after');
      const afterSequence = Number(headerCursor ?? queryCursor ?? 0);
      if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) throw new AiValidationError('Invalid event cursor.');
      const snapshot = service.getTurn(turnId);
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      });
      writeSse(response, 'snapshot', snapshot);
      const unsubscribe = service.subscribeToTurn(turnId, {
        afterSequence: snapshot.lastEventId,
        onEvent: event => writeSse(response, event.type, event, event.id),
      });
      if (snapshot.status === 'completed' || snapshot.status === 'failed') {
        unsubscribe();
        response.end();
        return true;
      }
      const keepAlive = setInterval(() => response.write(': keep-alive\n\n'), 20_000);
      request.on('close', () => {
        clearInterval(keepAlive);
        unsubscribe();
      });
      return true;
    }

    const turnRoute = url.pathname.match(/^\/api\/ai\/turns\/([^/]+)$/);
    if (turnRoute) {
      authorize(accessPolicy, 'read', request);
      if (method !== 'GET') return sendJson(response, 405, { error: 'Method not allowed' }) ?? true;
      const turnId = decodedSegment(turnRoute[1], TURN_PATTERN, 'turn ID');
      sendJson(response, 200, { turn: service.getTurn(turnId) });
      return true;
    }

    sendJson(response, 404, { error: 'API route not found' });
    return true;
  } catch (error) {
    errorResponse(error, sendJson, response);
    return true;
  }
}
