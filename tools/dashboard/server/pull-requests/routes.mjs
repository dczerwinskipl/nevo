import { createPullRequestService } from './service.mjs';
import { createGitHubPullRequestProvider } from './github.mjs';

const SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;
const SOURCES = new Set(['active', 'archive']);

// `request.params` values are already decoded once by Fastify/find-my-way —
// decoding again would double-decode a slug containing a literal `%`.
function decodedSlug(raw) {
  return SLUG_PATTERN.test(raw) ? raw : null;
}

// A `:source` outside {active, archive} never matched the old hand-rolled
// regexes, so it fell through to the generic `/api/*` 404.
function rejectUnknownSource(reply, source) {
  if (SOURCES.has(source)) return false;
  reply.code(404).send({ error: 'API route not found' });
  return true;
}

/**
 * The pull-requests capability: constructs its own GitHub-backed service
 * locally. GitHub is the only source today — no registry, just direct
 * composition. `provider` is this plugin's own local override option — a
 * feature-level test seam for registering this capability directly on a
 * bare Fastify instance — never routed through `buildDashboardApp()`'s
 * `config`; real usage never passes one, so the real GitHub provider always
 * applies.
 */
export default async function pullRequestRoutes(fastify, { config = {}, provider } = {}) {
  const service = createPullRequestService({
    provider: provider ?? createGitHubPullRequestProvider(),
    root: config.root,
    specsDir: config.specsDir,
    activeDir: config.activeDir,
    archiveDir: config.archiveDir,
  });

  fastify.get('/api/specs/:source/:slug/pull-requests', async (request, reply) => {
    if (rejectUnknownSource(reply, request.params.source)) return;
    const slug = decodedSlug(request.params.slug);
    if (!slug) {
      reply.code(404).send({ error: 'Specification changes not found' });
      return;
    }
    try {
      const changes = await service.loadPullRequests({ source: request.params.source, slug });
      if (!changes) {
        reply.code(404).send({ error: 'Specification changes not found' });
        return;
      }
      reply.code(200).header('cache-control', 'no-store').send(changes);
    } catch {
      reply.code(500).send({ error: 'Unable to load specification changes' });
    }
  });

  fastify.get('/api/specs/:source/:slug/pull-requests/:number/files', async (request, reply) => {
    if (rejectUnknownSource(reply, request.params.source)) return;
    const slug = decodedSlug(request.params.slug);
    if (!slug) {
      reply.code(404).send({ error: 'Pull request not found' });
      return;
    }
    const number = Number(request.params.number);
    try {
      const files = await service.loadFiles({ source: request.params.source, slug, number });
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

  fastify.get('/api/specs/:source/:slug/pull-requests/:number/diff', async (request, reply) => {
    if (rejectUnknownSource(reply, request.params.source)) return;
    const slug = decodedSlug(request.params.slug);
    if (!slug) {
      reply.code(404).send({ error: 'Pull request not found' });
      return;
    }
    const number = Number(request.params.number);
    try {
      const diff = await service.loadFullDiff({ source: request.params.source, slug, number });
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
      const diffs = await service.loadFileDiffs({ source: request.params.source, slug, number, paths, headSha });
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
}
