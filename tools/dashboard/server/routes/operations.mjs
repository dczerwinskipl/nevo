import { OperationNotFoundError } from '../operations.mjs';
import { sendJson } from '../http-utils.mjs';

export function createOperationRouteAdapter({ operationRuntime } = {}) {
  const activeConnections = new Set();

  const handleOperationRoute = ({
    request,
    response,
    method,
    url,
    operationRuntime: runtimeOverride,
  }) => {
    const runtime = runtimeOverride || operationRuntime;
    const operationRoute = url.pathname.match(/^\/api\/operations\/([^/]+)(\/events)?$/);
    if (!operationRoute) return false;

    let operationId;
    try {
      operationId = decodeURIComponent(operationRoute[1]);
    } catch {
      sendJson(response, 404, { error: 'Operation not found' });
      return true;
    }
    if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(operationId)) {
      sendJson(response, 404, { error: 'Operation not found' });
      return true;
    }

    const isEvents = operationRoute[2] === '/events';
    if (isEvents) {
      if (method !== 'GET') {
        sendJson(response, 405, { error: 'Method not allowed' });
        return true;
      }

      const headerCursor = request.headers['last-event-id'];
      const queryCursor = url.searchParams.get('after');
      const rawCursor = headerCursor ?? queryCursor;
      let afterSequence = 0;
      if (rawCursor !== undefined && rawCursor !== null && rawCursor !== '') {
        afterSequence = Number(rawCursor);
        if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
          sendJson(response, 400, { error: 'Invalid event cursor.' });
          return true;
        }
      }

      let snapshot;
      try {
        snapshot = runtime.getSnapshot(operationId);
      } catch (error) {
        const status = error instanceof OperationNotFoundError ? 404 : 500;
        sendJson(response, status, { error: error?.message || 'Operation not found' });
        return true;
      }

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
      request.on('close', cleanup);

      const replayCursor = rawCursor !== undefined && rawCursor !== null && rawCursor !== ''
        ? afterSequence
        : snapshot.lastEventId;

      if ((snapshot.status === 'completed' || snapshot.status === 'failed') && replayCursor >= snapshot.lastEventId) {
        cleanup();
        return true;
      }

      try {
        unsubscribe = runtime.subscribe(operationId, {
          afterSequence: replayCursor,
          onEvent: event => {
            if (isEnded) return;
            response.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
            if (event.type === 'operation.completed' || event.type === 'operation.failed') {
              cleanup();
            }
          },
        });
      } catch (error) {
        cleanup();
        return true;
      }

      if (snapshot.status === 'completed' || snapshot.status === 'failed') {
        cleanup();
        return true;
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

      return true;
    }

    if (method !== 'GET') {
      sendJson(response, 405, { error: 'Method not allowed' });
      return true;
    }
    try {
      const snapshot = runtime.getSnapshot(operationId);
      sendJson(response, 200, snapshot);
    } catch (error) {
      const status = error instanceof OperationNotFoundError ? 404 : 500;
      sendJson(response, status, { error: error?.message || 'Operation not found' });
    }
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
    handleOperationRoute,
    shutdown,
    getActiveConnectionCount: () => activeConnections.size,
  };
}

const defaultOperationAdapter = createOperationRouteAdapter();
export const handleOperationRoute = defaultOperationAdapter.handleOperationRoute;
