import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadDashboardData } from './data.mjs';
import { dashboardNetworkConfig } from './network-config.mjs';
import { createSpecEventHub } from './watcher.mjs';

const DASHBOARD_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DIST_DIR = resolve(DASHBOARD_ROOT, 'dist');

const CONTENT_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.woff2', 'font/woff2'],
]);

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  response.end(body);
}

function safeStaticPath(distDir, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const candidate = resolve(distDir, decoded.replace(/^\/+/, ''));
  return candidate === distDir || candidate.startsWith(`${distDir}${sep}`) ? candidate : null;
}

function serveStatic(response, pathname, distDir) {
  if (!existsSync(distDir)) return false;
  let filePath = safeStaticPath(distDir, pathname === '/' ? '/index.html' : pathname);
  if (!filePath) return false;

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    if (extname(pathname)) return false;
    filePath = resolve(distDir, 'index.html');
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) return false;

  response.writeHead(200, {
    'content-type': CONTENT_TYPES.get(extname(filePath).toLowerCase()) || 'application/octet-stream',
    'cache-control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  createReadStream(filePath).pipe(response);
  return true;
}

export function createDashboardServer({
  dataLoader = loadDashboardData,
  eventHub = createSpecEventHub(),
  distDir = DEFAULT_DIST_DIR,
} = {}) {
  const server = createServer((request, response) => {
    const method = request.method || 'GET';
    const url = new URL(request.url || '/', 'http://127.0.0.1');

    if (method !== 'GET') {
      sendJson(response, 405, { error: 'Method not allowed' });
      return;
    }

    if (url.pathname === '/api/health') {
      sendJson(response, 200, { status: 'ok' });
      return;
    }

    if (url.pathname === '/api/dashboard') {
      try {
        sendJson(response, 200, dataLoader());
      } catch {
        sendJson(response, 500, { error: 'Unable to load specifications' });
      }
      return;
    }

    if (url.pathname === '/api/events') {
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      });
      response.write(`event: connected\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
      const unsubscribe = eventHub.subscribe(event => {
        response.write(`event: specs-changed\ndata: ${JSON.stringify(event)}\n\n`);
      });
      const keepAlive = setInterval(() => response.write(': keep-alive\n\n'), 20_000);
      request.on('close', () => {
        clearInterval(keepAlive);
        unsubscribe();
      });
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      sendJson(response, 404, { error: 'API route not found' });
      return;
    }

    if (!serveStatic(response, url.pathname, distDir)) {
      sendJson(response, 404, {
        error: 'Dashboard assets not found',
        detail: 'Run the dashboard build before starting the production server.',
      });
    }
  });

  server.on('close', () => eventHub.close?.());
  return server;
}

export function listen(server, { port = 4317, host = '127.0.0.1' } = {}) {
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      const address = server.address();
      resolvePromise(`http://${host}:${address.port}`);
    });
  });
}

const isDirectRun = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  const { host, port } = dashboardNetworkConfig();
  const server = createDashboardServer();
  const url = await listen(server, { port, host });
  console.log(`NEvo dashboard: ${url}`);
  console.log(`NEvo dashboard API: ${url}/api/dashboard`);
}

export { safeStaticPath };
