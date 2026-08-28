import { dirname, extname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';

import { createOperationRuntime } from './operations.mjs';
import healthRoutes from './routes/health.mjs';
import eventsRoutes from './routes/events.mjs';
import operationRoutes from './routes/operations.mjs';
import specsRoutes from './routes/specs.mjs';
import pullRequestRoutes from './pull-requests/routes.mjs';
import aiRoutes from './routes/ai/index.mjs';

const DASHBOARD_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DIST_DIR = resolve(DASHBOARD_ROOT, 'dist');

// Content-type-agnostic JSON body reader: any content-type is accepted, an
// empty body parses as `{}`, and Fastify's own `parseAs: 'string'`
// accumulation enforces `bodyLimit` for us. Defined exactly once, here — no
// capability registers an equivalent parser of its own; a capability that
// needs its own error *shape* for a parse/size failure maps it in its own
// `setErrorHandler`, inheriting this same parser (see routes/ai/shared.mjs).
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

function registerGlobalHttpInfrastructure(app) {
  // `removeAllContentTypeParsers` first: otherwise Fastify's own built-in
  // `application/json`/`text/plain` parsers would still claim requests
  // carrying those headers before our catch-all ever runs (Fastify resolves
  // an exact content-type match before falling back to a `'*'` registration
  // in the same scope).
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
}

function registerStaticAssets(app, distDir) {
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
}

// Generic route loading: the one place that knows the full list of
// capability route plugins. Adding a capability means adding one line here,
// not touching `buildDashboardApp` or threading anything through it —
// `config` (plus the one shared `operationRuntime` exception) is all any
// plugin ever receives. Every capability constructs its own dependencies
// inside its own route subtree (see routes/ai/index.mjs, routes/specs.mjs,
// pull-requests/routes.mjs, routes/events.mjs).
async function registerRoutes(app, { config }) {
  const operationRuntime = config.operations?.operationRuntime ?? createOperationRuntime();

  await app.register(healthRoutes, { config });
  await app.register(eventsRoutes, { config });
  await app.register(operationRoutes, { config, operationRuntime });
  await app.register(specsRoutes, { config, operationRuntime });
  await app.register(pullRequestRoutes, { config });
  await app.register(aiRoutes, { config });
}

/**
 * `buildDashboardApp({ config })` — a testable Fastify application factory,
 * and nothing more than that. It creates the Fastify instance, installs
 * application-wide HTTP infrastructure (parsing, error handling, static/SPA
 * fallback), and delegates to `registerRoutes` for the capability route
 * tree — it never constructs or even names a feature-specific service,
 * runtime, provider, or store itself. `config` is passed through to every
 * plugin unopened — this function never destructures a capability-specific
 * field out of it.
 *
 * `operationRuntime` (constructed inside `registerRoutes`) is the one
 * exception: it's genuinely shared by two independent capabilities (specs
 * writes to it, operations reads/streams it) — see routes/operations.mjs's
 * own comment.
 *
 * Contains no `listen()`/process-lifecycle concerns; `index.mjs` (the
 * runtime boundary) owns that separately, and tests can drive this
 * instance directly via `app.inject()` without opening a network port.
 */
export async function buildDashboardApp({ config = {} } = {}) {
  const app = Fastify({ logger: false, bodyLimit: 4096, exposeHeadRoutes: false });

  registerGlobalHttpInfrastructure(app);
  await registerRoutes(app, { config });
  registerStaticAssets(app, config.distDir ?? DEFAULT_DIST_DIR);

  return app;
}

export { DEFAULT_DIST_DIR };
