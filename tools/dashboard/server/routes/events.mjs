import { createSpecEventHub } from '../watcher.mjs';

/**
 * The events capability: a spec-change file watcher exposed over SSE.
 * `eventHub` is used only here — no other capability touches it — so it is
 * constructed and torn down entirely inside this subtree.
 */
export default async function eventsRoutes(fastify, { config = {} } = {}) {
  const eventHub = config.events?.eventHub ?? createSpecEventHub();
  const activeConnections = new Set();

  fastify.get('/api/events', (request, reply) => {
    // SSE genuinely needs the raw response for framing/keepalive/streaming
    // ownership — everything before this point (route match, method
    // dispatch) already went through Fastify's normal lifecycle.
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

  // Draining open SSE connections is a Fastify request-lifecycle concern —
  // `preClose` (not `onClose`: an open SSE stream never finishes on its
  // own, and Fastify's shutdown lifecycle blocks `server.close()` on
  // in-flight requests finishing before any `onClose` hook would run).
  fastify.addHook('preClose', async () => {
    for (const close of Array.from(activeConnections)) {
      try {
        close();
      } catch {}
    }
    activeConnections.clear();
  });

  // `eventHub` is local to this capability — close it here, on the same
  // resource-lifecycle phase the rest of the app uses for non-connection
  // resources.
  fastify.addHook('onClose', async () => {
    try {
      eventHub?.close?.();
    } catch (err) {
      console.error('[server] error closing event hub:', err);
    }
  });
}
