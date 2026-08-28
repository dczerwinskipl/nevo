import { dirname, extname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';

import { createSpecEventHub } from './watcher.mjs';
import { createOperationRuntime } from './operations.mjs';
import { registerHealthRoutes } from './routes/health.mjs';
import { registerEventsRoutes } from './routes/events.mjs';
import { registerOperationRoutes } from './routes/operations.mjs';
import { registerSpecsRoutes } from './routes/specs.mjs';
import { registerPullRequestRoutes } from './routes/pull-requests.mjs';
import { registerAiRoutes } from './routes/ai/index.mjs';

const DASHBOARD_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DIST_DIR = resolve(DASHBOARD_ROOT, 'dist');

// Content-type-agnostic JSON body reader, matching the previous hand-rolled
// `readJsonBody` contract exactly: any content-type is accepted, an empty
// body parses as `{}`, and Fastify's own `parseAs: 'string'` accumulation
// enforces `bodyLimit` for us (surfaced to `FST_ERR_CTP_BODY_TOO_LARGE` in
// the shared error handler below) — this preserves the 4096-byte default
// contract without re-implementing size tracking here.
function permissiveJsonParser(_request, body, done) {
  if (!body) {
    done(null, {});
    return;
  }
  try {
    done(null, JSON.parse(body));
  } catch {
    const error = new Error('Request body must be valid JSON.');
    error.statusCode = 400;
    done(error);
  }
}

/**
 * `buildDashboardApp(deps)` — a testable Fastify application factory.
 * Contains no `listen()`/process-lifecycle concerns; `index.mjs` (the
 * runtime boundary) owns those separately, and tests can drive this
 * instance directly via `app.inject()` without opening a network port.
 *
 * This is purely a composition root: each `registerXRoutes(fastify, deps)`
 * call registers its own concrete routes *and* whatever lifecycle hooks its
 * own resources need (an open SSE connection, a runtime, a service to shut
 * down). Nothing here reaches back into a capability's internals or
 * sequences its teardown — that coupling stays inside the capability that
 * owns the resource.
 */
export function buildDashboardApp({
  eventHub = createSpecEventHub(),
  aiService,
  aiServiceFactory,
  aiAccessPolicy,
  operationRuntime = createOperationRuntime(),
  actionExecutor,
  activeDir,
  root,
  distDir = DEFAULT_DIST_DIR,
} = {}) {
  const app = Fastify({ logger: false, bodyLimit: 4096, exposeHeadRoutes: false });

  // `removeAllContentTypeParsers` first: otherwise Fastify's own built-in
  // `application/json`/`text/plain` parsers would still claim requests
  // carrying those headers before our catch-all ever runs (Fastify resolves
  // an exact content-type match before falling back to a `'*'` registration
  // in the same scope), which would surface Fastify's own generic parse
  // errors instead of the old content-type-agnostic contract this preserves.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'string' }, permissiveJsonParser);

  // Small and generic on purpose: only transport-level concerns (body too
  // large, malformed body, truly unexpected failures). Each capability maps
  // its own domain errors before they ever reach this handler.
  app.setErrorHandler((error, request, reply) => {
    if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      reply.code(413).send({ error: 'Request body is too large.' });
      return;
    }
    if (typeof error.statusCode === 'number' && error.statusCode < 500) {
      reply.code(error.statusCode).send({ error: error.message });
      return;
    }
    console.error('[server] unexpected error:', error);
    reply.code(500).send({ error: 'Internal server error' });
  });

  registerSpecsRoutes(app, { operationRuntime, actionExecutor, activeDir, root });
  registerEventsRoutes(app, { eventHub });
  registerOperationRoutes(app, { operationRuntime });
  registerPullRequestRoutes(app);
  registerHealthRoutes(app);
  registerAiRoutes(app, { aiService, aiServiceFactory, aiAccessPolicy });

  app.setNotFoundHandler((request, reply) => {
    const pathname = request.url.split('?')[0];
    if (pathname.startsWith('/api/')) {
      reply.code(404).send({ error: 'API route not found' });
      return;
    }
    if (!existsSync(distDir)) {
      reply.code(404).send({
        error: 'Dashboard assets not found',
        detail: 'Run the dashboard build before starting the production server.',
      });
      return;
    }
    if (extname(pathname)) {
      reply.code(404).send({
        error: 'Dashboard assets not found',
        detail: 'Run the dashboard build before starting the production server.',
      });
      return;
    }
    reply.sendFile('index.html');
  });

  app.register(fastifyStatic, {
    root: distDir,
    index: ['index.html'],
    wildcard: false,
    // @fastify/static v10 invokes this with the Fastify `reply` (not the
    // raw `http.ServerResponse`) as the first argument — use `reply.header`,
    // not `res.setHeader`.
    setHeaders: (reply, path) => {
      reply.header(
        'cache-control',
        path.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
      );
    },
  });

  return app;
}

export { DEFAULT_DIST_DIR };
