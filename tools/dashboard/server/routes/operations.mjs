import { OperationNotFoundError } from '../operations.mjs';

const OPERATION_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]*$/i;

export function registerOperationRoutes(fastify, { operationRuntime } = {}) {
  const activeConnections = new Set();

  fastify.all('/api/operations/:operationId', (request, reply) => {
    // Already decoded once by Fastify/find-my-way — see routes/specs.mjs's
    // own comment on `decodedSlug` for why this must not decode again.
    const operationId = request.params.operationId;
    if (!OPERATION_ID_PATTERN.test(operationId)) {
      reply.code(404).send({ error: 'Operation not found' });
      return;
    }
    if (request.method !== 'GET') {
      reply.code(405).send({ error: 'Method not allowed' });
      return;
    }
    try {
      const snapshot = operationRuntime.getSnapshot(operationId);
      reply.code(200).header('cache-control', 'no-store').send(snapshot);
    } catch (error) {
      const status = error instanceof OperationNotFoundError ? 404 : 500;
      reply.code(status).header('cache-control', 'no-store').send({ error: error?.message || 'Operation not found' });
    }
  });

  fastify.all('/api/operations/:operationId/events', (request, reply) => {
    // Already decoded once by Fastify/find-my-way — see routes/specs.mjs's
    // own comment on `decodedSlug` for why this must not decode again.
    const operationId = request.params.operationId;
    if (!OPERATION_ID_PATTERN.test(operationId)) {
      reply.code(404).send({ error: 'Operation not found' });
      return;
    }
    if (request.method !== 'GET') {
      reply.code(405).send({ error: 'Method not allowed' });
      return;
    }

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

  const shutdown = () => {
    for (const close of Array.from(activeConnections)) {
      try {
        close();
      } catch {}
    }
    activeConnections.clear();
  };

  return {
    shutdown,
    getActiveConnectionCount: () => activeConnections.size,
  };
}
