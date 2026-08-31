import fastifySse from '@fastify/sse';

// Genuinely application-wide HTTP infrastructure — Fastify's own standard
// JSON body parsing, SSE transport (@fastify/sse), and a generic
// transport-level error handler every capability inherits. Exported (not
// inlined in app.mjs) so slice-level tests that bypass `buildDashboardApp()`
// to exercise a single capability's `routes.mjs` directly can still stand up
// the same infrastructure a capability actually runs under, without
// duplicating it.
export async function registerGlobalHttpInfrastructure(app) {
  // No custom content-type parser: `Content-Type: application/json` already
  // gets Fastify's own built-in JSON parsing (empty body -> 400
  // FST_ERR_CTP_EMPTY_JSON_BODY, malformed JSON -> 400
  // FST_ERR_CTP_INVALID_JSON_BODY, both already shaped by the error handler
  // below). A request with an unrelated content-type (text/plain,
  // application/octet-stream, ...) is never silently treated as JSON —
  // every dashboard consumer already sends `content-type: application/json`
  // on every request that carries a body.
  await app.register(fastifySse);

  // Small and generic on purpose: only transport-level concerns (a known
  // 4xx from Fastify's own body parsing, or a truly unexpected failure).
  // Each capability maps its own domain errors before they ever reach this
  // handler. Kept because the frontend depends on `{ error: <message> }` —
  // Fastify's own default error shape puts the HTTP reason phrase (e.g.
  // "Bad Request") in `.error` and the actual message in `.message`, which
  // does not match what dashboard consumers already parse.
  app.setErrorHandler((error, request, reply) => {
    if (typeof error.statusCode === 'number' && error.statusCode < 500) {
      reply.code(error.statusCode).send({ error: error.message });
      return;
    }
    console.error('[server] unexpected error:', error);
    reply.code(500).send({ error: 'Internal server error' });
  });
}
