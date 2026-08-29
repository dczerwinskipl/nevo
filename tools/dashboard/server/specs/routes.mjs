import { SpecificationActionError } from './actions.mjs';
import { createSpecsCapability } from './service.mjs';
import {
  SpecValidationError,
  SpecConflictError,
  SpecRollbackError,
} from '../../../specs/identity.mjs';
import { HttpError } from './http-utils.mjs';
import specEventRoutes from './events.mjs';

const SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;
const SOURCES = new Set(['active', 'archive']);

// `request.params` values are already decoded once by Fastify/find-my-way —
// decoding again would double-decode a slug containing a literal `%`.
function decodedSlug(raw) {
  return SLUG_PATTERN.test(raw) ? raw : null;
}

// A `:source` outside {active, archive} — or, for the actions route,
// anything other than `active` — never matched the old hand-rolled regexes,
// so it fell through every capability adapter to the generic `/api/*` 404.
function rejectSource(reply, source, allowed) {
  if (allowed.has(source)) return false;
  reply.code(404).send({ error: 'API route not found' });
  return true;
}

/**
 * The specs capability: constructs its own application-layer service
 * (data/actions/identity composition — see service.mjs) locally.
 * `operationRuntime` is the one exception, read from the shared
 * `fastify.operationRuntime` decoration the app root installs (see
 * app.mjs's own comment for why it's genuinely shared) — not threaded
 * through `config`, and not this plugin's own dependency to construct.
 * `actionExecutor` is a local override for feature-level tests only; real
 * usage never passes one, so `createSpecActionsCapability`'s own default
 * (the real `executeSpecificationAction`) applies. `watcher` is the same
 * kind of local override, forwarded to the spec-events sub-plugin (see
 * events.mjs's own comment) — `config` is forwarded alongside it so the
 * watcher resolves the same `activeDir`/`archiveDir` this capability does,
 * rather than a separately-derived default.
 */
export default async function specsRoutes(fastify, { config = {}, actionExecutor, watcher } = {}) {
  const service = createSpecsCapability({
    operationRuntime: fastify.operationRuntime,
    actionExecutor,
    activeDir: config.activeDir,
    root: config.root,
  });

  await fastify.register(specEventRoutes, { config, watcher });

  fastify.get('/api/dashboard', async (request, reply) => {
    try {
      const data = await service.getDashboardData();
      reply.code(200).header('cache-control', 'no-store').send(data);
    } catch {
      reply.code(500).send({ error: 'Unable to load specifications' });
    }
  });

  fastify.post('/api/specs', async (request, reply) => {
    const body = request.body ?? {};
    if (typeof body !== 'object' || Array.isArray(body)) {
      reply.code(400).send({ error: 'Request body must be a JSON object.' });
      return;
    }
    try {
      const result = await service.createSpecification({
        slug: body.slug,
        title: body.title,
        type: body.type,
        goal: body.goal,
      });
      reply.code(201).send(result);
    } catch (error) {
      if (error instanceof SpecValidationError) {
        reply.code(400).send({ error: error.message, code: error.code, field: error.field });
      } else if (error instanceof SpecConflictError) {
        reply.code(409).send({ error: error.message, code: error.code, slug: error.slug });
      } else if (error instanceof SpecRollbackError) {
        reply.code(500).send({
          error: error.message,
          code: error.code,
          slug: error.slug,
          failedSteps: error.failedSteps,
        });
      } else if (error instanceof HttpError) {
        reply.code(error.status).send({ error: error.message });
      } else {
        reply.code(500).send({ error: error?.message || 'Unable to create specification.' });
      }
    }
  });

  const actionsPath = '/api/specs/:source/:slug/actions';
  const ACTIVE_ONLY = new Set(['active']);

  fastify.get(actionsPath, async (request, reply) => {
    const { source, slug: rawSlug } = request.params;
    if (rejectSource(reply, source, ACTIVE_ONLY)) return;
    const slug = decodedSlug(rawSlug);
    if (!slug) {
      reply.code(404).send({ error: 'Specification actions not found' });
      return;
    }
    try {
      const result = await service.loadActions(slug);
      reply.code(200).header('cache-control', 'no-store').send(result);
    } catch (error) {
      const status = error instanceof SpecificationActionError ? error.status : 500;
      reply.code(status).send({ error: status === 404 ? 'Specification actions not found' : 'Unable to load specification actions' });
    }
  });

  fastify.post(actionsPath, async (request, reply) => {
    const { source, slug: rawSlug } = request.params;
    if (rejectSource(reply, source, ACTIVE_ONLY)) return;
    const slug = decodedSlug(rawSlug);
    if (!slug) {
      reply.code(404).send({ error: 'Specification actions not found' });
      return;
    }
    if (request.headers['x-nevo-dashboard-action'] !== '1') {
      reply.code(403).send({ error: 'Dashboard action header is required.' });
      return;
    }
    try {
      const body = request.body ?? {};
      if (typeof body !== 'object' || Array.isArray(body)) {
        throw new SpecificationActionError('Request body must be a JSON object.', 400);
      }
      const result = service.startAction({
        slug,
        action: body.action,
        taskId: body.taskId,
        confirmed: body.confirmed === true,
      });
      reply.code(200).send({
        ok: result.ok,
        operationId: result.operationId,
        action: result.action,
        ...(result.taskId ? { taskId: result.taskId } : {}),
        message: result.message,
      });
    } catch (error) {
      const known = error instanceof SpecificationActionError || error instanceof HttpError;
      reply.code(known ? error.status : 500).send({
        error: known ? error.message : 'Unable to execute specification action.',
      });
    }
  });

  fastify.get('/api/specs/:source/:slug/content/:docId', async (request, reply) => {
    if (rejectSource(reply, request.params.source, SOURCES)) return;
    try {
      const slug = request.params.slug;
      const docId = request.params.docId;
      if (!SLUG_PATTERN.test(slug)) {
        reply.code(404).send({ error: 'Specification document not found' });
        return;
      }
      const document = await service.getDocument({ source: request.params.source, slug, docId });
      if (!document) {
        reply.code(404).send({ error: 'Specification document not found' });
        return;
      }
      reply.code(200).header('cache-control', 'no-store').send(document);
    } catch {
      reply.code(404).send({ error: 'Specification document not found' });
    }
  });

  fastify.get('/api/specs/:source/:slug/content', async (request, reply) => {
    if (rejectSource(reply, request.params.source, SOURCES)) return;
    try {
      const slug = request.params.slug;
      if (!SLUG_PATTERN.test(slug)) {
        reply.code(404).send({ error: 'Specification content not found' });
        return;
      }
      const manifest = await service.getManifest({ source: request.params.source, slug });
      if (!manifest) {
        reply.code(404).send({ error: 'Specification content not found' });
        return;
      }
      reply.code(200).header('cache-control', 'no-store').send(manifest);
    } catch {
      reply.code(404).send({ error: 'Specification content not found' });
    }
  });

  fastify.get('/api/specs/:source/:slug/task-statuses', async (request, reply) => {
    if (rejectSource(reply, request.params.source, SOURCES)) return;
    try {
      const slug = request.params.slug;
      if (!SLUG_PATTERN.test(slug)) {
        reply.code(404).send({ error: 'Specification task statuses not found' });
        return;
      }
      const statuses = await service.getTaskStatuses({ source: request.params.source, slug });
      if (!statuses) {
        reply.code(404).send({ error: 'Specification task statuses not found' });
        return;
      }
      reply.code(200).header('cache-control', 'no-store').send(statuses);
    } catch {
      reply.code(404).send({ error: 'Specification task statuses not found' });
    }
  });

  // Owned here: this capability is the only one that starts background
  // action work tied to an AbortController, so it is the only one that
  // needs to abort and await that work on shutdown. `preClose` (runs before
  // any `onClose` hook) so it always finishes before the shared
  // `operationRuntime` shuts down (see operations/routes.mjs's own comment).
  fastify.addHook('preClose', async () => {
    await service.shutdown();
  });
}
