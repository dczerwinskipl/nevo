import {
  PROVIDER_PATTERN,
  authorize,
  validatedSegment,
  validatedSessionId,
  writeSse,
} from './shared.mjs';
import { AiValidationError } from '../../../../ai/contracts.mjs';

export default async function aiEventRoutes(fastify, { service, accessPolicy }) {
  const activeConnections = new Set();

  fastify.get('/api/agent-sessions/:provider/:providerSessionId/events', (request, reply) => {
    const provider = validatedSegment(request.params.provider, PROVIDER_PATTERN, 'provider ID');
    const providerSessionId = validatedSessionId(request.params.providerSessionId);
    authorize(accessPolicy, 'read', request);

    const headerCursor = request.headers['last-event-id'];
    const queryCursor = request.query?.after;
    const afterSequence = Number(headerCursor ?? queryCursor ?? 0);
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) throw new AiValidationError('Invalid event cursor.');

    console.log(`[ai] [sse:connect] provider=${provider} session=${providerSessionId} after=${afterSequence}`);

    // Validation/authorization above ran through Fastify's normal
    // request/reply lifecycle — only the actual streaming needs the raw
    // response.
    reply.hijack();
    const response = reply.raw;

    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    });
    response.write(': connected\n\n');

    const unsubscribe = service.subscribeToSession(provider, providerSessionId, {
      afterSequence,
      onEvent: event => writeSse(response, event.type, event, event.seq ?? event.id),
    });

    const cleanup = () => {
      if (!activeConnections.has(cleanup)) return;
      activeConnections.delete(cleanup);
      clearInterval(keepAlive);
      unsubscribe();
    };
    activeConnections.add(cleanup);

    const keepAlive = setInterval(() => response.write(': keep-alive\n\n'), 20_000);
    keepAlive.unref();
    request.raw.on('close', cleanup);
  });

  fastify.addHook('preClose', async () => {
    for (const cleanup of Array.from(activeConnections)) {
      try {
        cleanup();
      } catch {}
    }
    activeConnections.clear();
  });
}
