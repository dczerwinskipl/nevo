import { OperationNotFoundError } from '../infrastructure/operation-runtime.mjs';

const OPERATION_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]*$/i;

function validOperationId(request, reply) {
  // Already decoded once by Fastify/find-my-way (`safeDecodeURIComponent`) —
  // decoding again would double-decode an id containing a literal `%`.
  const operationId = request.params.operationId;
  if (!OPERATION_ID_PATTERN.test(operationId)) {
    reply.code(404).send({ error: 'Operation not found' });
    return null;
  }
  return operationId;
}

/**
 * The operations capability: exposes the shared `operationRuntime` (long-
 * running action progress + resumable SSE replay) over HTTP.
 * `operationRuntime` is the one resource genuinely consumed by two
 * independent capabilities (specs actions write to it; this capability
 * reads/streams from it), so app.mjs constructs one instance and decorates
 * the root Fastify app with it (`fastify.operationRuntime`) — read here via
 * that decoration, not as an explicit option app.mjs threads through
 * registration. See app.mjs's own comment for why that's the single
 * justified exception to "capabilities own their dependencies."
 *
 * `@fastify/sse` owns SSE framing, headers, heartbeat, and per-connection
 * close detection. This route owns the domain semantics on top of it:
 * snapshot-then-replay-then-live-events cursoring, and stopping once an
 * operation reaches a terminal state.
 */
export default async function operationRoutes(fastify) {
  const { operationRuntime } = fastify;
  const activeConnections = new Set();

  fastify.get('/api/operations/:operationId', (request, reply) => {
    const operationId = validOperationId(request, reply);
    if (!operationId) return;
    try {
      const snapshot = operationRuntime.getSnapshot(operationId);
      reply.code(200).header('cache-control', 'no-store').send(snapshot);
    } catch (error) {
      const status = error instanceof OperationNotFoundError ? 404 : 500;
      reply.code(status).header('cache-control', 'no-store').send({ error: error?.message || 'Operation not found' });
    }
  });

  fastify.get('/api/operations/:operationId/events', { sse: 'only' }, async (request, reply) => {
    const operationId = validOperationId(request, reply);
    if (!operationId) return;

    // An explicit `Last-Event-ID` header (parsed by @fastify/sse) or
    // `?after=` query param (kept for simple fetch()-driven reconnects that
    // don't set a custom header) — absent either, replay starts from the
    // snapshot's own `lastEventId` below (only new events from here).
    const rawCursor = reply.sse.lastEventId ?? request.query?.after;
    let afterSequence;
    if (rawCursor !== undefined && rawCursor !== null && rawCursor !== '') {
      afterSequence = Number(rawCursor);
      if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
        reply.code(400).send({ error: 'Invalid event cursor.' });
        return;
      }
    }

    let snapshot;
    try {
      snapshot = operationRuntime.getSnapshot(operationId);
    } catch (error) {
      const status = error instanceof OperationNotFoundError ? 404 : 500;
      reply.code(status).send({ error: error?.message || 'Operation not found' });
      return;
    }

    reply.sse.keepAlive();
    activeConnections.add(reply.sse);
    reply.sse.onClose(() => activeConnections.delete(reply.sse));

    await reply.sse.send({ event: 'snapshot', data: snapshot });

    const replayCursor = afterSequence !== undefined ? afterSequence : snapshot.lastEventId;

    if ((snapshot.status === 'completed' || snapshot.status === 'failed') && replayCursor >= snapshot.lastEventId) {
      reply.sse.close();
      return;
    }

    let unsubscribe;
    try {
      unsubscribe = operationRuntime.subscribe(operationId, {
        afterSequence: replayCursor,
        onEvent: event => {
          reply.sse.send({ id: event.id, event: event.type, data: event }).catch(() => {});
          if (event.type === 'operation.completed' || event.type === 'operation.failed') {
            reply.sse.close();
          }
        },
      });
    } catch {
      reply.sse.close();
      return;
    }
    reply.sse.onClose(() => unsubscribe());

    if (snapshot.status === 'completed' || snapshot.status === 'failed') {
      reply.sse.close();
    }
  });

  // Draining open SSE connections is a Fastify request-lifecycle concern —
  // `preClose` (see specs/events.mjs's own comment for why), which always
  // runs before any `onClose` hook, guaranteeing this drains before the
  // shared runtime itself shuts down (and, more importantly, before the
  // specs capability's own `onClose`-independent `preClose` hook that aborts
  // in-flight actions has to compete with a runtime already shut down).
  // The runtime's own shutdown is NOT this capability's job to call — app.mjs
  // constructed it, so app.mjs owns tearing it down (see its own comment).
  fastify.addHook('preClose', async () => {
    for (const sse of Array.from(activeConnections)) {
      try { sse.close(); } catch {}
    }
    activeConnections.clear();
  });
}
