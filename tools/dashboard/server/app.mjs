import { dirname, extname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import autoLoad from '@fastify/autoload';

import { registerGlobalHttpInfrastructure } from './infrastructure/http.mjs';
import { createOperationRuntime } from './operations/runtime.mjs';

const DASHBOARD_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_DIST_DIR = resolve(DASHBOARD_ROOT, 'dist');

// A capability's HTTP entry point is always `<capability>/routes.mjs`,
// directly under `server/` — matches nothing else at the server root
// (`app.mjs`, `index.mjs`, `dev.mjs`) and nothing under `infrastructure/`
// (which has no `routes.mjs` of its own, so it's never treated as a
// capability). `dev.mjs` in particular runs side-effecting top-level code
// on import (it starts a dev server) — this filter must exclude it, not
// merely rely on autoload's "doesn't look like a plugin" fallback.
const CAPABILITY_ROUTES_PATTERN = /^\/[^/]+\/routes\.mjs$/;

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
    // `wildcard: false` globs `distDir` once at plugin-registration time and
    // pre-registers one route per file found then — it never serves a file
    // added later, so a long-running server started before a rebuild 404s on
    // every newly hashed asset until restarted. `wildcard: true` (the
    // default) serves files dynamically per request instead. This isn't an
    // encapsulated/prefixed registration, so the SPA-fallback
    // `setNotFoundHandler` above still runs correctly for genuinely missing
    // paths (per @fastify/static's own "Handling 404s" docs).
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

/**
 * `operationRuntime` is the one resource genuinely shared by two
 * independent capabilities: specs' actions write to it, operations reads
 * and streams it (see operations/routes.mjs's own comment). Neither slice
 * alone owns both consumers, so it's constructed at the one level that
 * does — here — and exposed to every capability via Fastify's own
 * decoration mechanism rather than being threaded through registration
 * options by name. This is a single, explicit line of coupling to
 * Operations' public factory function, not an understanding of how
 * `OperationRuntime` works internally, and it is the only capability-shaped
 * thing this file touches.
 */
function registerSharedOperationRuntime(app) {
  const operationRuntime = createOperationRuntime();
  app.decorate('operationRuntime', operationRuntime);
  app.addHook('onClose', async () => {
    try {
      operationRuntime.shutdown?.();
    } catch (err) {
      console.error('[server] error shutting down operation runtime:', err);
    }
  });
}

/**
 * `buildDashboardApp({ config })` — a testable Fastify application factory,
 * and nothing more than that. It creates the Fastify instance, installs
 * application-wide HTTP infrastructure (parsing, error handling,
 * static/SPA fallback), decorates the one genuinely shared resource
 * (`operationRuntime`), and discovers capability routes generically via
 * `@fastify/autoload` — it never imports or enumerates a normal capability
 * by name, and never constructs a feature-specific service, provider, or
 * store itself. `config` is passed through to every discovered plugin
 * unopened; this function never destructures a capability-specific field
 * out of it. Adding a normal capability means adding a
 * `<capability>/routes.mjs` folder under `server/` — nothing here changes.
 *
 * Contains no `listen()`/process-lifecycle concerns; `index.mjs` (the
 * runtime boundary) owns that separately, and tests can drive this
 * instance directly via `app.inject()` without opening a network port.
 */
export async function buildDashboardApp({ config = {} } = {}) {
  const app = Fastify({ logger: false, bodyLimit: 4096, exposeHeadRoutes: false });

  registerGlobalHttpInfrastructure(app);
  registerSharedOperationRuntime(app);

  await app.register(autoLoad, {
    dir: SERVER_ROOT,
    dirNameRoutePrefix: false,
    matchFilter: (path) => CAPABILITY_ROUTES_PATTERN.test(path.replace(/\\/g, '/')),
    indexPattern: /^routes\.mjs$/,
    options: { config },
  });

  registerStaticAssets(app, config.distDir ?? DEFAULT_DIST_DIR);

  return app;
}

export { DEFAULT_DIST_DIR };
