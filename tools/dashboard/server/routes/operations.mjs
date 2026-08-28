import { OperationNotFoundError } from '../operations.mjs';
import { registerMethodFallback } from '../http-compat.mjs';

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

export function registerOperationRoutes(fastify, { operationRuntime } = {}) {
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
  registerMethodFallback(fastify, '/api/operations/:operationId', ['GET']);

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
  registerMethodFallback(fastify, '/api/operations/:operationId/events', ['GET']);

  // Owned here: this capability holds open SSE connections and is the
  // canonical owner of `operationRuntime`'s lifecycle (created once in the
  // composition root, but consumed and torn down by the operations/specs
  // capabilities that actually use it). `preClose`, not `onClose` — see
  // routes/events.mjs's own comment for why.
  fastify.addHook('preClose', async () => {
    for (const close of Array.from(activeConnections)) {
      try {
        close();
      } catch {}
    }
    activeConnections.clear();
    try {
      operationRuntime.shutdown?.();
    } catch (err) {
      console.error('[server] error shutting down operation runtime:', err);
    }
  });
}
