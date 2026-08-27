export function registerEventsRoutes(fastify, { eventHub } = {}) {
  const activeConnections = new Set();

  fastify.all('/api/events', (request, reply) => {
    if (request.method !== 'GET') {
      reply.code(405).send({ error: 'Method not allowed' });
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
    response.write('event: connected\ndata: ' + JSON.stringify({ at: new Date().toISOString() }) + '\n\n');

    let isClosed = false;
    let unsubscribe = null;
    let keepAlive = null;

    const cleanup = () => {
      if (isClosed) return;
      isClosed = true;
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

    unsubscribe = eventHub?.subscribe?.(event => {
      if (isClosed) return;
      response.write('event: specs-changed\ndata: ' + JSON.stringify(event) + '\n\n');
    });

    keepAlive = setInterval(() => {
      if (isClosed) {
        clearInterval(keepAlive);
        return;
      }
      try {
        response.write(': keep-alive\n\n');
      } catch {
        cleanup();
      }
    }, 20000);
    keepAlive.unref?.();
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
