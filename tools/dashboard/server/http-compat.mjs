// Small, shared 405 compatibility mechanism. `find-my-way` (Fastify's
// router) returns 404 — not 405 — for an unmatched HTTP method on an
// otherwise-known path, and never auto-generates OPTIONS. The dashboard's
// pre-Fastify contract always answered 405 for any unsupported method on a
// known route (including HEAD and OPTIONS). Rather than have every route
// handler branch on `request.method` itself, each capability registers its
// real verb-specific routes and then calls this once per path to cover
// every other method with 405, in one place.

const ALL_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

function methodNotAllowed(request, reply) {
  reply.code(405).send({ error: 'Method not allowed' });
}

export function registerMethodFallback(fastify, path, allowedMethods) {
  const disallowed = ALL_METHODS.filter(method => !allowedMethods.includes(method));
  if (disallowed.length) {
    fastify.route({ method: disallowed, url: path, handler: methodNotAllowed });
  }
}
