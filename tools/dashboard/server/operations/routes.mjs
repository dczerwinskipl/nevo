import { OperationNotFoundError } from './runtime.mjs';

const OPERATION_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]*$/i;

function validOperationId(request, reply) {
  // Already decoded once by Fastify/find-my-way (`safeDecodeURIComponent`) —
  // decoding again would double-decode an id containing a literal `%`.
  const operationId = request.params.operationId;
  if (!OPERATION_ID_PATTERN.test(operationId)) {
    reply.code(404).send({ error: 'Operation not found' });
    return null;
  }
  return operationId;
}

/**
 * The operations capability: exposes the shared `operationRuntime` (long-
 * running action progress + resumable SSE) over HTTP. `operationRuntime` is
 * the one resource genuinely consumed by two independent capabilities
 * (specs actions write to it; this capability reads/streams from it), so
 * app.mjs constructs one instance and decorates the root Fastify app with
 * it (`fastify.operationRuntime`) — read here via that decoration, not as
 * an explicit option app.mjs threads through registration. See app.mjs's
 * own comment for why that's the single justified exception to
 * "capabilities own their dependencies."
 */
export default async function operationRoutes(fastify) {
  const { operationRuntime } = fastify;
  const activeConnections = new Set();

  fastify.get('/api/operations/:operationId', (request, reply) => {
    const operationId = validOperationId(request, reply);
    if (!operationId) return;
    try {
      const snapshot = operationRuntime.getSnapshot(operationId);
      reply.code(200).header('cache-control', 'no-store').send(snapshot);
    } catch (error) {
      const status = error instanceof OperationNotFoundError ? 404 : 500;
      reply.code(status).header('cache-control', 'no-store').send({ error: error?.message || 'Operation not found' });
    }
  });

  fastify.get('/api/operations/:operationId/events', (request, reply) => {
    const operationId = validOperationId(request, reply);
    if (!operationId) return;

    const headerCursor = request.headers['last-event-id'];
    const queryCursor = request.query?.after;
    const rawCursor = headerCursor ?? queryCursor;
    let afterSequence = 0;
    if (rawCursor !== undefined && rawCursor !== null && rawCursor !== '') {
      afterSequence = Number(rawCursor);
      if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
        reply.code(400).send({ error: 'Invalid event cursor.' });
        return;
      }
    }

    let snapshot;
    try {
      snapshot = operationRuntime.getSnapshot(operationId);
    } catch (error) {
      const status = error instanceof OperationNotFoundError ? 404 : 500;
      reply.code(status).send({ error: error?.message || 'Operation not found' });
      return;
    }

    // SSE genuinely needs the raw response — validation/lookup above already
    // ran through Fastify's normal request/reply lifecycle.
    reply.hijack();
    const response = reply.raw;
    const requestRaw = request.raw;

    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    });

    response.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);

    let isEnded = false;
    let keepAlive = null;
    let unsubscribe = null;

    const cleanup = () => {
      if (isEnded) return;
      isEnded = true;
      if (keepAlive) {
        clearInterval(keepAlive);
        keepAlive = null;
      }
      if (typeof unsubscribe === 'function') {
        try { unsubscribe(); } catch {}
        unsubscribe = null;
      }
      activeConnections.delete(cleanup);
      try {
        if (!response.writableEnded) {
          response.end();
        }
      } catch {}
    };

    activeConnections.add(cleanup);
    requestRaw.on('close', cleanup);

    const replayCursor = rawCursor !== undefined && rawCursor !== null && rawCursor !== ''
      ? afterSequence
      : snapshot.lastEventId;

    if ((snapshot.status === 'completed' || snapshot.status === 'failed') && replayCursor >= snapshot.lastEventId) {
      cleanup();
      return;
    }

    try {
      unsubscribe = operationRuntime.subscribe(operationId, {
        afterSequence: replayCursor,
        onEvent: event => {
          if (isEnded) return;
          response.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
          if (event.type === 'operation.completed' || event.type === 'operation.failed') {
            cleanup();
          }
        },
      });
    } catch {
      cleanup();
      return;
    }

    if (snapshot.status === 'completed' || snapshot.status === 'failed') {
      cleanup();
      return;
    }

    if (!isEnded) {
      keepAlive = setInterval(() => {
        if (isEnded) {
          clearInterval(keepAlive);
          return;
        }
        try {
          response.write(': keep-alive\n\n');
        } catch {
          cleanup();
        }
      }, 20_000);
    }
  });

  // Draining open SSE connections is a Fastify request-lifecycle concern —
  // `preClose` (see events/routes.mjs's own comment for why), which always
  // runs before any `onClose` hook, guaranteeing this drains before the
  // shared runtime itself shuts down (and, more importantly, before the
  // specs capability's own `onClose`-independent `preClose` hook that aborts
  // in-flight actions has to compete with a runtime already shut down).
  // The runtime's own shutdown is NOT this capability's job to call — app.mjs
  // constructed it, so app.mjs owns tearing it down (see its own comment).
  fastify.addHook('preClose', async () => {
    for (const close of Array.from(activeConnections)) {
      try {
        close();
      } catch {}
    }
    activeConnections.clear();
  });
}
