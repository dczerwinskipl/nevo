import { sendJson } from '../http-utils.mjs';

export function handleHealthRoute({ request, response, method, url }) {
  if (url.pathname !== '/api/health') {
    return false;
  }
  if (method !== 'GET') {
    sendJson(response, 405, { error: 'Method not allowed' });
    return true;
  }
  sendJson(response, 200, { status: 'ok' });
  return true;
}
