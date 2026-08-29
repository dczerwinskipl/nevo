import { createSpecChangeWatcher } from './watcher.mjs';
import { ACTIVE_DIR, ARCHIVE_DIR } from '../../../specs/store.mjs';

/**
 * Spec-change notifications over SSE: `specs-changed` events straight from
 * the Specs watcher. `@fastify/sse` owns SSE framing, headers, heartbeat,
 * and per-connection close detection; this module owns only the domain
 * semantics (there is exactly one event type, no replay/cursor — a client
 * that missed events while disconnected just gets the next one).
 *
 * `config.activeDir`/`config.archiveDir` are the same directories the rest
 * of the Specs capability resolves (see specs/routes.mjs) — this is the one
 * place that maps them to the watcher's explicit `{ path, prefix }` roots,
 * so a custom Specs directory configuration (e.g. a test fixture or a
 * worktree) is watched, not the repo's own real `specs/active`/`specs/archive`
 * regardless of configuration. `ACTIVE_DIR`/`ARCHIVE_DIR` only apply as the
 * default when no override is configured — this is the outer Specs
 * configuration boundary, not the (fully generic) watcher implementation.
 * `watcher` is this plugin's own local override option (a feature-level
 * test seam); real usage never passes one, so a real
 * `createSpecChangeWatcher()` runs against the resolved directories.
 */
export default async function specEventRoutes(fastify, { config = {}, watcher } = {}) {
  const hub = watcher ?? createSpecChangeWatcher({
    roots: [
      { path: config.activeDir ?? ACTIVE_DIR, prefix: 'specs/active' },
      { path: config.archiveDir ?? ARCHIVE_DIR, prefix: 'specs/archive' },
    ],
  });
  const activeConnections = new Set();

  fastify.get('/api/events', { sse: 'only' }, async (request, reply) => {
    reply.sse.keepAlive();
    activeConnections.add(reply.sse);
    reply.sse.onClose(() => activeConnections.delete(reply.sse));

    await reply.sse.send({ event: 'connected', data: { at: new Date().toISOString() } });

    const unsubscribe = hub.subscribe(event => {
      reply.sse.send({ event: 'specs-changed', data: event }).catch(() => {});
    });
    reply.sse.onClose(() => unsubscribe());
  });

  // Draining open SSE connections is a Fastify request-lifecycle concern —
  // `preClose` (not `onClose`: an open SSE stream never finishes on its
  // own, and Fastify's shutdown lifecycle blocks `server.close()` on
  // in-flight requests finishing before any `onClose` hook would run).
  fastify.addHook('preClose', async () => {
    for (const sse of Array.from(activeConnections)) {
      try { sse.close(); } catch {}
    }
    activeConnections.clear();
  });

  // `hub` is local to this capability — close it here, on the same
  // resource-lifecycle phase the rest of the app uses for non-connection
  // resources. Awaited: chokidar's own close() is asynchronous, and
  // app.close() must not resolve before the underlying filesystem watchers
  // actually finish closing.
  fastify.addHook('onClose', async () => {
    try {
      await hub.close();
    } catch (err) {
      console.error('[server] error closing spec change watcher:', err);
    }
  });
}
