import { sendJson } from '../http-utils.mjs';

export function handleEventsRoute({ request, response, method, url, eventHub }) {
  if (url.pathname !== '/api/events') {
    return false;
  }
  if (method !== 'GET') {
    sendJson(response, 405, { error: 'Method not allowed' });
    return true;
  }

  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  });
  response.write('event: connected\ndata: ' + JSON.stringify({ at: new Date().toISOString() }) + '\n\n');

  const unsubscribe = eventHub?.subscribe?.(event => {
    response.write('event: specs-changed\ndata: ' + JSON.stringify(event) + '\n\n');
  });

  const keepAlive = setInterval(() => {
    try {
      response.write(': keep-alive\n\n');
    } catch {}
  }, 20000);
  keepAlive.unref?.();

  request.on('close', () => {
    clearInterval(keepAlive);
    if (typeof unsubscribe === 'function') {
      unsubscribe();
    }
  });

  return true;
}
