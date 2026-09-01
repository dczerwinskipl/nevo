import {
  PROVIDER_PATTERN,
  validatedSegment,
  validatedSessionId,
} from '../http.mjs';
import { authorize } from '../../access-policy.mjs';
import { AiValidationError } from '../../contracts.mjs';

/**
 * `@fastify/sse` owns SSE framing, headers, heartbeat, and per-connection
 * close detection. This route owns only the domain semantics: which
 * session's turn events to replay/stream, from which cursor.
 */
export default async function aiEventRoutes(fastify, { service, accessPolicy }) {
  const activeConnections = new Set();

  fastify.get('/api/agent-sessions/:provider/:providerSessionId/events', { sse: 'only' }, async (request, reply) => {
    const provider = validatedSegment(request.params.provider, PROVIDER_PATTERN, 'provider ID');
    const providerSessionId = validatedSessionId(request.params.providerSessionId);
    authorize(accessPolicy, 'read', request);

    // An explicit `Last-Event-ID` header (parsed by @fastify/sse) or
    // `?after=` query param (kept for simple fetch()-driven reconnects that
    // don't set a custom header) — absent either, replay starts from 0.
    const rawCursor = reply.sse.lastEventId ?? request.query?.after;
    const afterSequence = Number(rawCursor ?? 0);
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) throw new AiValidationError('Invalid event cursor.');

    console.log(`[ai] [sse:connect] provider=${provider} session=${providerSessionId} after=${afterSequence}`);

    reply.sse.keepAlive();
    reply.sse.sendHeaders();
    if (typeof reply.raw.flushHeaders === 'function') {
      reply.raw.flushHeaders();
    }
    activeConnections.add(reply.sse);
    reply.sse.onClose(() => activeConnections.delete(reply.sse));

    // Sends are serialized per connection: @fastify/sse's writeToStream() registers a
    // fresh once('drain')/once('error') pair on the raw ServerResponse every time a
    // write hits backpressure. Replaying a reconnect's backlog (subscribeToSession
    // replays every buffered event synchronously) or a burst of live events would
    // otherwise fire many overlapping, un-awaited send() calls — each adding its own
    // listener pair — and pile past Node's default MaxListeners before any of them
    // gets a chance to resolve. Chaining onto one promise ensures at most one write
    // (and therefore at most one pending listener pair) is ever in flight.
    let sendQueue = Promise.resolve();
    const unsubscribe = service.subscribeToSession(provider, providerSessionId, {
      afterSequence,
      onEvent: event => {
        sendQueue = sendQueue.then(() =>
          reply.sse.send({ id: event.seq ?? event.id, event: event.type, data: event }).catch(() => {}),
        );
      },
    });
    reply.sse.onClose(() => unsubscribe());
  });

  fastify.addHook('preClose', async () => {
    for (const sse of Array.from(activeConnections)) {
      try { sse.close(); } catch {}
    }
    activeConnections.clear();
  });
}
