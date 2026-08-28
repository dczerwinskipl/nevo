// Genuinely application-wide HTTP infrastructure — the common JSON body
// parser and the generic transport-level error handler every capability
// inherits. Exported (not inlined in app.mjs) so slice-level tests that
// bypass `buildDashboardApp()` to exercise a single capability's `routes.mjs`
// directly can still stand up the same parsing/error-handling behavior a
// capability actually runs under, without duplicating it.

// Content-type-agnostic JSON body reader: any content-type is accepted, an
// empty body parses as `{}`, and Fastify's own `parseAs: 'string'`
// accumulation enforces `bodyLimit` for us. Defined exactly once — no
// capability registers an equivalent parser of its own; a capability that
// needs its own error *shape* for a parse/size failure maps it in its own
// `setErrorHandler`, inheriting this same parser (see ai/shared.mjs).
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

export function registerGlobalHttpInfrastructure(app) {
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
