import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  loadDashboardData,
  loadSpecificationManifest,
  loadSpecificationDocument,
  loadTaskStatuses,
} from './data.mjs';
import {
  executeSpecificationAction,
  loadSpecificationActions,
  SpecificationActionError,
} from './actions.mjs';
import { dashboardNetworkConfig } from './network-config.mjs';
import {
  loadSpecificationPullRequestFileDiffs,
  loadSpecificationPullRequestFiles,
  loadSpecificationPullRequestFullDiff,
  loadSpecificationPullRequests,
} from './providers/service.mjs';
import { createSpecEventHub } from './watcher.mjs';
import { handleAiRequest } from './ai-routes.mjs';
import {
  createDefaultDashboardAiService,
  createTrustedNetworkAiAccessPolicy,
} from './ai-services.mjs';
import {
  createOperationRuntime,
  OperationNotFoundError,
} from './operations.mjs';

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

async function readJsonBody(request, maxBytes = 4096) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new SpecificationActionError('Request body is too large.', 413);
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new SpecificationActionError('Request body must be valid JSON.', 400);
  }
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
  manifestLoader = loadSpecificationManifest,
  documentLoader = loadSpecificationDocument,
  taskStatusLoader = loadTaskStatuses,
  pullRequestLoader = loadSpecificationPullRequests,
  pullRequestFilesLoader = loadSpecificationPullRequestFiles,
  pullRequestFileDiffsLoader = loadSpecificationPullRequestFileDiffs,
  pullRequestFullDiffLoader = loadSpecificationPullRequestFullDiff,
  actionLoader = loadSpecificationActions,
  actionExecutor = executeSpecificationAction,
  eventHub = createSpecEventHub(),
  aiService,
  aiServiceFactory = createDefaultDashboardAiService,
  aiAccessPolicy = createTrustedNetworkAiAccessPolicy(),
  operationRuntime = createOperationRuntime(),
  distDir = DEFAULT_DIST_DIR,
} = {}) {
  const runningActions = new Set();
  let resolvedAiService = aiService;
  const getAiService = () => {
    resolvedAiService ||= aiServiceFactory({ dataLoader });
    return resolvedAiService;
  };
  let aiReconciliationPromise = null;
  const ensureAiReconciled = () => {
    const service = getAiService();
    if (!aiReconciliationPromise) {
      aiReconciliationPromise = Promise.resolve(service.turnRuntime?.reconcileOrphanedTurns?.()).catch(err => {
        console.error(`[ai] [reconcile] boot-time turn reconciliation failed: ${err.message}`);
      });
    }
    return aiReconciliationPromise;
  };
  const server = createServer(async (request, response) => {
    const method = request.method || 'GET';
    const url = new URL(request.url || '/', 'http://127.0.0.1');

    if (
      url.pathname.startsWith('/api/ai/') ||
      url.pathname === '/api/agent-sessions' ||
      url.pathname.startsWith('/api/agent-sessions/') ||
      url.pathname === '/api/agent-providers' ||
      url.pathname.startsWith('/api/agent-providers/')
    ) {
      await ensureAiReconciled();
      await handleAiRequest({
        request,
        response,
        method,
        url,
        service: getAiService(),
        accessPolicy: aiAccessPolicy,
        sendJson,
        readJsonBody,
      });
      return;
    }

    const operationRoute = url.pathname.match(/^\/api\/operations\/([^/]+)(\/events)?$/);
    if (operationRoute) {
      let operationId;
      try {
        operationId = decodeURIComponent(operationRoute[1]);
      } catch {
        sendJson(response, 404, { error: 'Operation not found' });
        return;
      }
      if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(operationId)) {
        sendJson(response, 404, { error: 'Operation not found' });
        return;
      }

      const isEvents = operationRoute[2] === '/events';
      if (isEvents) {
        if (method !== 'GET') {
          sendJson(response, 405, { error: 'Method not allowed' });
          return;
        }
        try {
          const headerCursor = request.headers['last-event-id'];
          const queryCursor = url.searchParams.get('after');
          const afterSequence = Number(headerCursor ?? queryCursor ?? 0);
          if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
            sendJson(response, 400, { error: 'Invalid event cursor.' });
            return;
          }
          const snapshot = operationRuntime.getSnapshot(operationId);
          response.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache, no-transform',
            connection: 'keep-alive',
          });
          response.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);

          const unsubscribe = operationRuntime.subscribe(operationId, {
            afterSequence: snapshot.lastEventId,
            onEvent: event => {
              response.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
              if (event.type === 'operation.completed' || event.type === 'operation.failed') {
                cleanup();
                response.end();
              }
            },
          });

          if (snapshot.status === 'completed' || snapshot.status === 'failed') {
            unsubscribe();
            response.end();
            return;
          }

          const keepAlive = setInterval(() => response.write(': keep-alive\n\n'), 20_000);
          const cleanup = () => {
            clearInterval(keepAlive);
            unsubscribe();
          };
          request.on('close', cleanup);
        } catch (error) {
          const status = error instanceof OperationNotFoundError ? 404 : 500;
          sendJson(response, status, { error: error?.message || 'Unable to stream operation events' });
        }
        return;
      }

      if (method !== 'GET') {
        sendJson(response, 405, { error: 'Method not allowed' });
        return;
      }
      try {
        const snapshot = operationRuntime.getSnapshot(operationId);
        sendJson(response, 200, snapshot);
      } catch (error) {
        const status = error instanceof OperationNotFoundError ? 404 : 500;
        sendJson(response, status, { error: error?.message || 'Operation not found' });
      }
      return;
    }

    const actionRoute = url.pathname.match(/^\/api\/specs\/active\/([^/]+)\/actions$/);
    if (actionRoute) {
      let slug;
      try {
        slug = decodeURIComponent(actionRoute[1]);
      } catch {
        sendJson(response, 404, { error: 'Specification actions not found' });
        return;
      }
      if (!/^[a-z0-9][a-z0-9._-]*$/i.test(slug)) {
        sendJson(response, 404, { error: 'Specification actions not found' });
        return;
      }

      if (method === 'GET') {
        try {
          sendJson(response, 200, actionLoader({ slug }));
        } catch (error) {
          const status = error instanceof SpecificationActionError ? error.status : 500;
          sendJson(response, status, { error: status === 404 ? 'Specification actions not found' : 'Unable to load specification actions' });
        }
        return;
      }

      if (method === 'POST') {
        if (request.headers['x-nevo-dashboard-action'] !== '1') {
          sendJson(response, 403, { error: 'Dashboard action header is required.' });
          return;
        }
        if (runningActions.has(slug)) {
          sendJson(response, 409, { error: 'Another specification action is already running.' });
          return;
        }
        runningActions.add(slug);
        let hasAsyncOperation = false;
        try {
          const body = await readJsonBody(request);
          if (!body || typeof body !== 'object' || Array.isArray(body)) {
            throw new SpecificationActionError('Request body must be a JSON object.', 400);
          }
          const result = actionExecutor({
            slug,
            action: body.action,
            taskId: body.taskId,
            confirmed: body.confirmed === true,
            operationRuntime,
            onFinished: () => {
              runningActions.delete(slug);
            },
          });

          if (result?.operationId && operationRuntime) {
            try {
              const snapshot = operationRuntime.getSnapshot(result.operationId);
              if (snapshot.status === 'running') {
                hasAsyncOperation = true;
              }
            } catch {}
          }

          sendJson(response, 200, result);
        } catch (error) {
          const known = error instanceof SpecificationActionError;
          sendJson(response, known ? error.status : 500, {
            error: known ? error.message : 'Unable to execute specification action.',
          });
        } finally {
          if (!hasAsyncOperation) {
            runningActions.delete(slug);
          }
        }
        return;
      }

      sendJson(response, 405, { error: 'Method not allowed' });
      return;
    }

    // File-diffs is a POST (a `{ paths, headSha }` body), so this route group
    // is handled before the blanket GET-only gate below, same as actionRoute.
    const pullRequestSubRoute = url.pathname.match(
      /^\/api\/specs\/(active|archive)\/([^/]+)\/pull-requests\/(\d+)\/(files|file-diffs|diff)$/,
    );
    if (pullRequestSubRoute) {
      const [, source, rawSlug, rawNumber, resource] = pullRequestSubRoute;
      let slug;
      try {
        slug = decodeURIComponent(rawSlug);
      } catch {
        sendJson(response, 404, { error: 'Pull request not found' });
        return;
      }
      if (!/^[a-z0-9][a-z0-9._-]*$/i.test(slug)) {
        sendJson(response, 404, { error: 'Pull request not found' });
        return;
      }
      const number = Number(rawNumber);

      if (resource === 'files') {
        if (method !== 'GET') { sendJson(response, 405, { error: 'Method not allowed' }); return; }
        try {
          const files = await pullRequestFilesLoader({ source, slug, number });
          if (!files) { sendJson(response, 404, { error: 'Pull request files not found' }); return; }
          sendJson(response, 200, files);
        } catch (error) {
          const status = typeof error?.status === 'number' ? error.status : 502;
          sendJson(response, status, { error: error?.message || 'Unable to load pull request files' });
        }
        return;
      }

      if (resource === 'diff') {
        if (method !== 'GET') { sendJson(response, 405, { error: 'Method not allowed' }); return; }
        try {
          const diff = await pullRequestFullDiffLoader({ source, slug, number });
          if (!diff) { sendJson(response, 404, { error: 'Pull request diff not found' }); return; }
          sendJson(response, 200, diff);
        } catch (error) {
          const status = typeof error?.status === 'number' ? error.status : 502;
          sendJson(response, status, { error: error?.message || 'Unable to load pull request diff' });
        }
        return;
      }

      // resource === 'file-diffs'
      if (method !== 'POST') { sendJson(response, 405, { error: 'Method not allowed' }); return; }
      try {
        const body = await readJsonBody(request);
        if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.paths)) {
          sendJson(response, 400, { error: 'Request body must be a JSON object with a paths array.' });
          return;
        }
        const paths = body.paths.filter(path => typeof path === 'string');
        const headSha = typeof body.headSha === 'string' ? body.headSha : null;
        const diffs = await pullRequestFileDiffsLoader({ source, slug, number, paths, headSha });
        if (!diffs) { sendJson(response, 404, { error: 'Pull request not found' }); return; }
        sendJson(response, 200, diffs);
      } catch (error) {
        const status = typeof error?.status === 'number' ? error.status : (error instanceof SpecificationActionError ? error.status : 502);
        sendJson(response, status, {
          error: error?.message || 'Unable to load pull request file diffs.',
        });
      }
      return;
    }

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

    const documentRoute = url.pathname.match(/^\/api\/specs\/(active|archive)\/([^/]+)\/content\/([^/]+)$/);
    if (documentRoute) {
      try {
        const slug = decodeURIComponent(documentRoute[2]);
        const docId = decodeURIComponent(documentRoute[3]);
        if (!/^[a-z0-9][a-z0-9._-]*$/i.test(slug)) {
          sendJson(response, 404, { error: 'Specification document not found' });
          return;
        }
        const docStart = performance.now();
        const document = await documentLoader({ source: documentRoute[1], slug, docId });
        const docMs = Math.round(performance.now() - docStart);
        if (process.env.DEBUG || process.env.NODE_ENV !== 'production') {
          console.log(`[document] slug=${slug} docId=${docId} total=${docMs}ms`);
        }
        if (!document) {
          sendJson(response, 404, { error: 'Specification document not found' });
          return;
        }
        sendJson(response, 200, document);
      } catch {
        sendJson(response, 404, { error: 'Specification document not found' });
      }
      return;
    }

    const contentRoute = url.pathname.match(/^\/api\/specs\/(active|archive)\/([^/]+)\/content$/);
    if (contentRoute) {
      try {
        const slug = decodeURIComponent(contentRoute[2]);
        if (!/^[a-z0-9][a-z0-9._-]*$/i.test(slug)) {
          sendJson(response, 404, { error: 'Specification content not found' });
          return;
        }
        const manifest = await manifestLoader({ source: contentRoute[1], slug });
        if (!manifest) {
          sendJson(response, 404, { error: 'Specification content not found' });
          return;
        }
        sendJson(response, 200, manifest);
      } catch {
        sendJson(response, 404, { error: 'Specification content not found' });
      }
      return;
    }

    const taskStatusesRoute = url.pathname.match(/^\/api\/specs\/(active|archive)\/([^/]+)\/task-statuses$/);
    if (taskStatusesRoute) {
      try {
        const slug = decodeURIComponent(taskStatusesRoute[2]);
        if (!/^[a-z0-9][a-z0-9._-]*$/i.test(slug)) {
          sendJson(response, 404, { error: 'Specification task statuses not found' });
          return;
        }
        const statuses = taskStatusLoader({ source: taskStatusesRoute[1], slug });
        if (!statuses) {
          sendJson(response, 404, { error: 'Specification task statuses not found' });
          return;
        }
        sendJson(response, 200, statuses);
      } catch {
        sendJson(response, 404, { error: 'Specification task statuses not found' });
      }
      return;
    }

    const pullRequestRoute = url.pathname.match(/^\/api\/specs\/(active|archive)\/([^/]+)\/pull-requests$/);
    if (pullRequestRoute) {
      try {
        const slug = decodeURIComponent(pullRequestRoute[2]);
        if (!/^[a-z0-9][a-z0-9._-]*$/i.test(slug)) {
          sendJson(response, 404, { error: 'Specification changes not found' });
          return;
        }
        const changes = await pullRequestLoader({ source: pullRequestRoute[1], slug });
        if (!changes) {
          sendJson(response, 404, { error: 'Specification changes not found' });
          return;
        }
        sendJson(response, 200, changes);
      } catch {
        sendJson(response, 500, { error: 'Unable to load specification changes' });
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

  server.on('close', () => {
    eventHub.close?.();
    resolvedAiService?.turnRuntime?.shutdown?.();
    operationRuntime.shutdown?.();
  });
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
  console.warn('AI access mode: trusted network (VPN boundary); requests are not identity-authenticated.');
}

export { safeStaticPath };
