import {
  loadSpecificationPullRequestFileDiffs,
  loadSpecificationPullRequestFiles,
  loadSpecificationPullRequestFullDiff,
  loadSpecificationPullRequests,
} from '../providers/service.mjs';
import { registerMethodFallback } from '../http-compat.mjs';

const SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;
const SOURCES = new Set(['active', 'archive']);

// `request.params` values are already decoded once by Fastify/find-my-way
// (`safeDecodeURIComponent`) — decoding again would double-decode a slug
// containing a literal `%`. Only validate the shape.
function decodedSlug(raw) {
  return SLUG_PATTERN.test(raw) ? raw : null;
}

// A `:source` outside {active, archive} never matched the old hand-rolled
// regexes, so it fell through every capability adapter to the generic
// `/api/*` 404 — replicate that exact fallthrough, not a resource-specific
// one, by never registering these routes for other source values at all.
function rejectUnknownSource(reply, source) {
  if (SOURCES.has(source)) return false;
  reply.code(404).send({ error: 'API route not found' });
  return true;
}

export function registerPullRequestRoutes(fastify) {
  fastify.get('/api/specs/:source/:slug/pull-requests', async (request, reply) => {
    if (rejectUnknownSource(reply, request.params.source)) return;
    const slug = decodedSlug(request.params.slug);
    if (!slug) {
      reply.code(404).send({ error: 'Specification changes not found' });
      return;
    }
    try {
      const changes = await loadSpecificationPullRequests({ source: request.params.source, slug });
      if (!changes) {
        reply.code(404).send({ error: 'Specification changes not found' });
        return;
      }
      reply.code(200).header('cache-control', 'no-store').send(changes);
    } catch {
      reply.code(500).send({ error: 'Unable to load specification changes' });
    }
  });
  registerMethodFallback(fastify, '/api/specs/:source/:slug/pull-requests', ['GET']);

  fastify.get('/api/specs/:source/:slug/pull-requests/:number/files', async (request, reply) => {
    if (rejectUnknownSource(reply, request.params.source)) return;
    const slug = decodedSlug(request.params.slug);
    if (!slug) {
      reply.code(404).send({ error: 'Pull request not found' });
      return;
    }
    const number = Number(request.params.number);
    try {
      const files = await loadSpecificationPullRequestFiles({ source: request.params.source, slug, number });
      if (!files) {
        reply.code(404).send({ error: 'Pull request files not found' });
        return;
      }
      reply.code(200).header('cache-control', 'no-store').send(files);
    } catch (error) {
      const status = typeof error?.status === 'number' ? error.status : 502;
      reply.code(status).send({ error: error?.message || 'Unable to load pull request files' });
    }
  });
  registerMethodFallback(fastify, '/api/specs/:source/:slug/pull-requests/:number/files', ['GET']);

  fastify.get('/api/specs/:source/:slug/pull-requests/:number/diff', async (request, reply) => {
    if (rejectUnknownSource(reply, request.params.source)) return;
    const slug = decodedSlug(request.params.slug);
    if (!slug) {
      reply.code(404).send({ error: 'Pull request not found' });
      return;
    }
    const number = Number(request.params.number);
    try {
      const diff = await loadSpecificationPullRequestFullDiff({ source: request.params.source, slug, number });
      if (!diff) {
        reply.code(404).send({ error: 'Pull request diff not found' });
        return;
      }
      reply.code(200).header('cache-control', 'no-store').send(diff);
    } catch (error) {
      const status = typeof error?.status === 'number' ? error.status : 502;
      reply.code(status).send({ error: error?.message || 'Unable to load pull request diff' });
    }
  });
  registerMethodFallback(fastify, '/api/specs/:source/:slug/pull-requests/:number/diff', ['GET']);

  fastify.post('/api/specs/:source/:slug/pull-requests/:number/file-diffs', async (request, reply) => {
    if (rejectUnknownSource(reply, request.params.source)) return;
    const slug = decodedSlug(request.params.slug);
    if (!slug) {
      reply.code(404).send({ error: 'Pull request not found' });
      return;
    }
    const number = Number(request.params.number);
    const body = request.body ?? {};
    if (typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.paths)) {
      reply.code(400).send({ error: 'Request body must be a JSON object with a paths array.' });
      return;
    }
    try {
      const paths = body.paths.filter(path => typeof path === 'string');
      const headSha = typeof body.headSha === 'string' ? body.headSha : null;
      const diffs = await loadSpecificationPullRequestFileDiffs({ source: request.params.source, slug, number, paths, headSha });
      if (!diffs) {
        reply.code(404).send({ error: 'Pull request not found' });
        return;
      }
      reply.code(200).header('cache-control', 'no-store').send(diffs);
    } catch (error) {
      const status = typeof error?.status === 'number' ? error.status : (typeof error?.statusCode === 'number' ? error.statusCode : 502);
      reply.code(status).send({ error: error?.message || 'Unable to load pull request file diffs.' });
    }
  });
  registerMethodFallback(fastify, '/api/specs/:source/:slug/pull-requests/:number/file-diffs', ['POST']);
}
