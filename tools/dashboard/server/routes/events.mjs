import { sendJson } from '../http-utils.mjs';

export function createEventsRouteAdapter({ eventHub } = {}) {
  const activeConnections = new Set();

  const handleEventsRoute = ({ request, response, method, url, eventHub: hubOverride }) => {
    if (url.pathname !== '/api/events') {
      return false;
    }
    if (method !== 'GET') {
      sendJson(response, 405, { error: 'Method not allowed' });
      return true;
    }

    const hub = hubOverride || eventHub;

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
    request.on('close', cleanup);

    unsubscribe = hub?.subscribe?.(event => {
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

    return true;
  };

  const shutdown = () => {
    for (const close of Array.from(activeConnections)) {
      try {
        close();
      } catch {}
    }
    activeConnections.clear();
  };

  return {
    handleEventsRoute,
    shutdown,
    getActiveConnectionCount: () => activeConnections.size,
  };
}

const defaultEventsAdapter = createEventsRouteAdapter();
export const handleEventsRoute = defaultEventsAdapter.handleEventsRoute;
