import {
  AiError,
  AiNotFoundError,
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
  const isAgentSessionRoute = url.pathname.startsWith('/api/agent-sessions') || url.pathname === '/api/agent-sessions';
  const isAgentProviderRoute = url.pathname.startsWith('/api/agent-providers') || url.pathname === '/api/agent-providers';
  const isLegacyAiRoute = url.pathname.startsWith('/api/ai/');

  if (!isAgentSessionRoute && !isAgentProviderRoute && !isLegacyAiRoute) return false;

  try {
    // 1. Providers endpoint
    if (url.pathname === '/api/agent-providers' || url.pathname === '/api/ai/providers') {
      authorize(accessPolicy, 'read', request);
      if (method !== 'GET') return sendJson(response, 405, { error: 'Method not allowed' }) ?? true;
      sendJson(response, 200, {
        providers: service.listProviders(),
        access: { mode: 'trusted-network', identityAuthenticated: false },
      });
      return true;
    }

    // 2. Turns with atomic session creation: POST /api/agent-sessions/turns
    if (url.pathname === '/api/agent-sessions/turns') {
      authorize(accessPolicy, 'control', request);
      if (method !== 'POST') return sendJson(response, 405, { error: 'Method not allowed' }) ?? true;
      const body = assertBodyObject(await readJsonBody(request, 128 * 1024));
      const provider = decodedSegment(body.provider, PROVIDER_PATTERN, 'provider ID');
      if (body.specId && !UUID_PATTERN.test(body.specId)) throw new AiValidationError('Invalid specification ID.');
      if (body.taskId && !TURN_PATTERN.test(body.taskId)) throw new AiValidationError('Invalid task ID.');
      const result = await service.startTurn(provider, undefined, {
        message: body.message ?? body.prompt,
        specId: body.specId,
        taskId: body.taskId,
        purpose: body.purpose,
        idempotencyKey: body.idempotencyKey,
      });
      sendJson(response, result.idempotent ? 200 : 201, result);
      return true;
    }

    // 3. Sessions listing & creation / binding
    if (url.pathname === '/api/agent-sessions' || url.pathname === '/api/ai/sessions') {
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

        if (body.providerSessionId) {
          const providerSessionId = decodedSessionId(body.providerSessionId);
          if (body.taskId && !TURN_PATTERN.test(body.taskId)) throw new AiValidationError('Invalid task ID.');
          const binding = service.bindingService
            ? await service.bindingService.bindSession({
                provider,
                providerSessionId,
                specId: body.specId,
                taskId: body.taskId,
                purpose: body.purpose,
              })
            : { provider, providerSessionId, specId: body.specId, taskId: body.taskId };
          sendJson(response, 201, { session: binding });
          return true;
        }

        if (typeof service.createSession === 'function') {
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

        throw new AiValidationError('providerSessionId is required to bind an existing session.');
      }
      sendJson(response, 405, { error: 'Method not allowed' });
      return true;
    }

    // 4. Session SSE Events: GET /api/agent-sessions/:provider/:providerSessionId/events
    const sessionEventsRoute = url.pathname.match(/^\/api\/agent-sessions\/([^/]+)\/([^/]+)\/events$/);
    if (sessionEventsRoute) {
      authorize(accessPolicy, 'read', request);
      if (method !== 'GET') return sendJson(response, 405, { error: 'Method not allowed' }) ?? true;
      const provider = decodedSegment(sessionEventsRoute[1], PROVIDER_PATTERN, 'provider ID');
      const providerSessionId = decodedSessionId(sessionEventsRoute[2]);
      const headerCursor = request.headers['last-event-id'];
      const queryCursor = url.searchParams.get('after');
      const afterSequence = Number(headerCursor ?? queryCursor ?? 0);
      if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) throw new AiValidationError('Invalid event cursor.');

      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      });
      response.write(': connected\n\n');

      const unsubscribe = service.subscribeToSession(provider, providerSessionId, {
        afterSequence,
        onEvent: event => writeSse(response, event.type, event, event.seq ?? event.id),
      });

      const keepAlive = setInterval(() => response.write(': keep-alive\n\n'), 20_000);
      keepAlive.unref();
      request.on('close', () => {
        clearInterval(keepAlive);
        unsubscribe();
      });
      return true;
    }

    // 5. Session Interaction respond: POST /api/agent-sessions/:provider/:providerSessionId/interactions/:interactionId/respond
    const sessionInteractionRoute = url.pathname.match(/^\/api\/agent-sessions\/([^/]+)\/([^/]+)\/interactions\/([^/]+)\/respond$/);
    if (sessionInteractionRoute) {
      authorize(accessPolicy, 'control', request);
      if (method !== 'POST') return sendJson(response, 405, { error: 'Method not allowed' }) ?? true;
      const provider = decodedSegment(sessionInteractionRoute[1], PROVIDER_PATTERN, 'provider ID');
      const providerSessionId = decodedSessionId(sessionInteractionRoute[2]);
      const interactionId = decodedSegment(sessionInteractionRoute[3], TURN_PATTERN, 'interaction ID');
      const body = assertBodyObject(await readJsonBody(request, 16_384));

      let turnId = body.turnId;
      if (turnId) {
        const turn = await service.getTurn(turnId);
        if (!turn || turn.provider !== provider || (turn.providerSessionId || turn.sessionId) !== providerSessionId) {
          throw new AiNotFoundError(`Turn '${turnId}' does not belong to session '${providerSessionId}'.`, { provider, providerSessionId, turnId });
        }
      } else {
        const transcript = await service.getTranscript(provider, providerSessionId);
        turnId = transcript?.activeTurn?.turnId;
      }
      if (!turnId) {
        throw new AiNotFoundError('No active turn found for this session.', { provider, providerSessionId });
      }

      const turn = await service.getTurn(turnId);
      if (!turn || turn.provider !== provider || (turn.providerSessionId || turn.sessionId) !== providerSessionId) {
        throw new AiNotFoundError(`Turn '${turnId}' does not belong to session '${providerSessionId}'.`, { provider, providerSessionId, turnId });
      }

      if (!turn.pendingInteraction || turn.pendingInteraction.id !== interactionId) {
        throw new AiNotFoundError(`Interaction '${interactionId}' is not pending on session '${providerSessionId}'.`, { provider, providerSessionId, interactionId });
      }

      const resolved = await service.resolveInteraction(turnId, interactionId, body);
      sendJson(response, 200, { turn: resolved });
      return true;
    }

    // 6. Session Turn Cancel: POST /api/agent-sessions/:provider/:providerSessionId/turns/:turnId/cancel
    const sessionTurnCancelRoute = url.pathname.match(/^\/api\/agent-sessions\/([^/]+)\/([^/]+)\/turns\/([^/]+)\/cancel$/);
    if (sessionTurnCancelRoute) {
      authorize(accessPolicy, 'control', request);
      if (method !== 'POST') return sendJson(response, 405, { error: 'Method not allowed' }) ?? true;
      const provider = decodedSegment(sessionTurnCancelRoute[1], PROVIDER_PATTERN, 'provider ID');
      const providerSessionId = decodedSessionId(sessionTurnCancelRoute[2]);
      const turnId = decodedSegment(sessionTurnCancelRoute[3], TURN_PATTERN, 'turn ID');
      await readJsonBody(request, 512);

      const turn = await service.getTurn(turnId);
      if (!turn || turn.provider !== provider || (turn.providerSessionId || turn.sessionId) !== providerSessionId) {
        throw new AiNotFoundError(`Turn '${turnId}' does not belong to session '${providerSessionId}'.`, { provider, providerSessionId, turnId });
      }

      sendJson(response, 200, { turn: await service.cancelTurn(turnId) });
      return true;
    }

    // 7. Messages: GET /api/agent-sessions/:provider/:providerSessionId/messages or /api/ai/sessions/:provider/:providerSessionId/messages
    const messagesRoute = url.pathname.match(/^\/api\/(?:agent-sessions|ai\/sessions)\/([^/]+)\/([^/]+)\/messages$/);
    if (messagesRoute) {
      authorize(accessPolicy, 'read', request);
      if (method !== 'GET') return sendJson(response, 405, { error: 'Method not allowed' }) ?? true;
      const provider = decodedSegment(messagesRoute[1], PROVIDER_PATTERN, 'provider ID');
      const sessionId = decodedSessionId(messagesRoute[2]);
      const messages = (await service.listMessages(provider, sessionId)).map(validateAiMessage);
      sendJson(response, 200, { messages });
      return true;
    }

    // 8. Subsequent Turns: POST /api/agent-sessions/:provider/:providerSessionId/turns or /api/ai/sessions/:provider/:providerSessionId/turns
    const turnsRoute = url.pathname.match(/^\/api\/(?:agent-sessions|ai\/sessions)\/([^/]+)\/([^/]+)\/turns$/);
    if (turnsRoute) {
      authorize(accessPolicy, 'control', request);
      if (method !== 'POST') return sendJson(response, 405, { error: 'Method not allowed' }) ?? true;
      const body = assertBodyObject(await readJsonBody(request, 128 * 1024));
      const provider = decodedSegment(turnsRoute[1], PROVIDER_PATTERN, 'provider ID');
      const sessionId = decodedSessionId(turnsRoute[2]);
      const result = await service.startTurn(provider, sessionId, {
        message: body.message ?? body.prompt,
        ...(body.idempotencyKey === undefined ? {} : { idempotencyKey: body.idempotencyKey }),
      });
      sendJson(response, result.idempotent ? 200 : 202, result);
      return true;
    }

    // 9. Session Details & Snapshot: GET/DELETE /api/agent-sessions/:provider/:providerSessionId or GET /api/ai/sessions/:provider/:providerSessionId
    const sessionRoute = url.pathname.match(/^\/api\/(?:agent-sessions|ai\/sessions)\/([^/]+)\/([^/]+)$/);
    if (sessionRoute) {
      const provider = decodedSegment(sessionRoute[1], PROVIDER_PATTERN, 'provider ID');
      const providerSessionId = decodedSessionId(sessionRoute[2]);

      if (method === 'DELETE') {
        authorize(accessPolicy, 'control', request);
        if (service.bindingService) {
          await service.bindingService.unbindSession(provider, providerSessionId);
        }
        sendJson(response, 200, { unbind: true });
        return true;
      }

      if (method === 'GET') {
        authorize(accessPolicy, 'read', request);
        const descriptor = service.registry?.get(provider);
        const capabilities = descriptor?.capabilities || {};
        const binding = service.bindingService
          ? await service.bindingService.getBinding(provider, providerSessionId)
          : await service.getSession(provider, providerSessionId);
        const transcript = service.transcriptCache
          ? await service.transcriptCache.getTranscript(provider, providerSessionId)
          : await service.getTranscript(provider, providerSessionId);

        let activeTurn = null;
        let pendingInteraction = transcript?.pendingInteraction || null;

        if (transcript?.activeTurn?.turnId) {
          try {
            const turnSnapshot = service.getTurn(transcript.activeTurn.turnId);
            if (turnSnapshot && turnSnapshot.status !== 'completed' && turnSnapshot.status !== 'failed') {
              activeTurn = {
                turnId: turnSnapshot.turnId,
                startedAt: turnSnapshot.startedAt,
                status: turnSnapshot.status,
              };
              pendingInteraction = turnSnapshot.pendingInteraction || pendingInteraction;
            }
          } catch {
            activeTurn = transcript.activeTurn;
          }
        }

        const status = activeTurn
          ? (activeTurn.status === 'waitingForUser' ? 'waitingForUser' : 'running')
          : 'idle';

        const session = {
          provider,
          providerSessionId,
          sessionId: providerSessionId,
          status,
          capabilities,
          specId: binding?.specId,
          taskId: binding?.taskId,
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
        };

        sendJson(response, 200, { session });
        return true;
      }

      sendJson(response, 405, { error: 'Method not allowed' });
      return true;
    }

    // 10. Legacy Interaction Response: POST /api/ai/turns/:turnId/interactions/:interactionId/response
    const legacyInteractionRoute = url.pathname.match(/^\/api\/ai\/turns\/([^/]+)\/interactions\/([^/]+)\/response$/);
    if (legacyInteractionRoute) {
      authorize(accessPolicy, 'control', request);
      if (method !== 'POST') return sendJson(response, 405, { error: 'Method not allowed' }) ?? true;
      const turnId = decodedSegment(legacyInteractionRoute[1], TURN_PATTERN, 'turn ID');
      const interactionId = decodedSegment(legacyInteractionRoute[2], TURN_PATTERN, 'interaction ID');
      const body = assertBodyObject(await readJsonBody(request, 16_384));
      sendJson(response, 200, { turn: await service.resolveInteraction(turnId, interactionId, body) });
      return true;
    }

    // 11. Legacy Turn Cancel: POST /api/ai/turns/:turnId/cancel
    const legacyCancelRoute = url.pathname.match(/^\/api\/ai\/turns\/([^/]+)\/cancel$/);
    if (legacyCancelRoute) {
      authorize(accessPolicy, 'control', request);
      if (method !== 'POST') return sendJson(response, 405, { error: 'Method not allowed' }) ?? true;
      const turnId = decodedSegment(legacyCancelRoute[1], TURN_PATTERN, 'turn ID');
      await readJsonBody(request, 512);
      sendJson(response, 200, { turn: await service.cancelTurn(turnId) });
      return true;
    }

    // 12. Legacy Turn Events: GET /api/ai/turns/:turnId/events
    const legacyEventRoute = url.pathname.match(/^\/api\/ai\/turns\/([^/]+)\/events$/);
    if (legacyEventRoute) {
      authorize(accessPolicy, 'read', request);
      if (method !== 'GET') return sendJson(response, 405, { error: 'Method not allowed' }) ?? true;
      const turnId = decodedSegment(legacyEventRoute[1], TURN_PATTERN, 'turn ID');
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
      keepAlive.unref();
      request.on('close', () => {
        clearInterval(keepAlive);
        unsubscribe();
      });
      return true;
    }

    // 13. Legacy Turn Details: GET /api/ai/turns/:turnId
    const legacyTurnRoute = url.pathname.match(/^\/api\/ai\/turns\/([^/]+)$/);
    if (legacyTurnRoute) {
      authorize(accessPolicy, 'read', request);
      if (method !== 'GET') return sendJson(response, 405, { error: 'Method not allowed' }) ?? true;
      const turnId = decodedSegment(legacyTurnRoute[1], TURN_PATTERN, 'turn ID');
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

