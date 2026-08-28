import {
  loadDashboardData,
  loadSpecificationManifest,
  loadSpecificationDocument,
  loadTaskStatuses,
} from '../data.mjs';
import {
  loadSpecificationActions,
  executeSpecificationAction,
  SpecificationActionError,
} from '../actions.mjs';
import {
  createSpecification,
  SpecValidationError,
  SpecConflictError,
  SpecRollbackError,
} from '../../../specs/identity.mjs';
import { HttpError } from '../http-utils.mjs';
import { registerMethodFallback } from '../http-compat.mjs';

const SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;
const SOURCES = new Set(['active', 'archive']);

// `request.params` values are already decoded once by Fastify/find-my-way —
// decoding again would double-decode a slug containing a literal `%`.
function decodedSlug(raw) {
  return SLUG_PATTERN.test(raw) ? raw : null;
}

// A `:source` outside {active, archive} never matched the old hand-rolled
// regexes, so it fell through every capability adapter to the generic
// `/api/*` 404.
function rejectUnknownSource(reply, source) {
  if (SOURCES.has(source)) return false;
  reply.code(404).send({ error: 'API route not found' });
  return true;
}

export function registerSpecsRoutes(fastify, {
  operationRuntime,
  actionExecutor = executeSpecificationAction,
  activeDir,
  root,
} = {}) {
  const activeActions = new Map(); // slug -> { controller, completion }

  fastify.get('/api/dashboard', async (request, reply) => {
    try {
      const data = await loadDashboardData();
      reply.code(200).header('cache-control', 'no-store').send(data);
    } catch {
      reply.code(500).send({ error: 'Unable to load specifications' });
    }
  });
  registerMethodFallback(fastify, '/api/dashboard', ['GET']);

  fastify.post('/api/specs', async (request, reply) => {
    const body = request.body ?? {};
    if (typeof body !== 'object' || Array.isArray(body)) {
      reply.code(400).send({ error: 'Request body must be a JSON object.' });
      return;
    }
    try {
      const result = await createSpecification({
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
  registerMethodFallback(fastify, '/api/specs', ['POST']);

  // The `source === 'archive'` -> 405 rule is data-driven (a param value),
  // not method-driven, so it can't be expressed via registerMethodFallback;
  // both GET and POST share this one guard instead of each re-checking it.
  const actionsPath = '/api/specs/:source/:slug/actions';
  function rejectArchiveActions(reply, source) {
    if (source !== 'archive') return false;
    reply.code(405).send({ error: 'Method not allowed' });
    return true;
  }

  fastify.get(actionsPath, async (request, reply) => {
    const { source, slug: rawSlug } = request.params;
    if (rejectArchiveActions(reply, source)) return;
    if (rejectUnknownSource(reply, source)) return;
    const slug = decodedSlug(rawSlug);
    if (!slug) {
      reply.code(404).send({ error: 'Specification actions not found' });
      return;
    }
    try {
      const result = await loadSpecificationActions({ slug, activeDir, root });
      reply.code(200).header('cache-control', 'no-store').send(result);
    } catch (error) {
      const status = error instanceof SpecificationActionError ? error.status : 500;
      reply.code(status).send({ error: status === 404 ? 'Specification actions not found' : 'Unable to load specification actions' });
    }
  });

  fastify.post(actionsPath, async (request, reply) => {
    const { source, slug: rawSlug } = request.params;
    if (rejectArchiveActions(reply, source)) return;
    if (rejectUnknownSource(reply, source)) return;
    const slug = decodedSlug(rawSlug);
    if (!slug) {
      reply.code(404).send({ error: 'Specification actions not found' });
      return;
    }

    if (request.headers['x-nevo-dashboard-action'] !== '1') {
      reply.code(403).send({ error: 'Dashboard action header is required.' });
      return;
    }
    if (activeActions.has(slug)) {
      reply.code(409).send({ error: 'Another specification action is already running.' });
      return;
    }
    const controller = new AbortController();
    let hasStarted = false;
    let cleanupDone = false;
    const cleanup = () => {
      if (cleanupDone) return;
      cleanupDone = true;
      activeActions.delete(slug);
    };

    try {
      const body = request.body ?? {};
      if (typeof body !== 'object' || Array.isArray(body)) {
        throw new SpecificationActionError('Request body must be a JSON object.', 400);
      }
      const result = actionExecutor({
        slug,
        action: body.action,
        taskId: body.taskId,
        confirmed: body.confirmed === true,
        activeDir,
        root,
        operationRuntime,
        signal: controller.signal,
        onFinished: cleanup,
      });

      const completion = (result?.completion && typeof result.completion.then === 'function')
        ? result.completion.finally(cleanup)
        : Promise.resolve().finally(cleanup);

      activeActions.set(slug, { controller, completion });
      hasStarted = true;

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
    } finally {
      if (!hasStarted) {
        cleanup();
      }
    }
  });
  registerMethodFallback(fastify, actionsPath, ['GET', 'POST']);

  fastify.get('/api/specs/:source/:slug/content/:docId', async (request, reply) => {
    if (rejectUnknownSource(reply, request.params.source)) return;
    try {
      const slug = request.params.slug;
      const docId = request.params.docId;
      if (!SLUG_PATTERN.test(slug)) {
        reply.code(404).send({ error: 'Specification document not found' });
        return;
      }
      const document = await loadSpecificationDocument({ source: request.params.source, slug, docId });
      if (!document) {
        reply.code(404).send({ error: 'Specification document not found' });
        return;
      }
      reply.code(200).header('cache-control', 'no-store').send(document);
    } catch {
      reply.code(404).send({ error: 'Specification document not found' });
    }
  });
  registerMethodFallback(fastify, '/api/specs/:source/:slug/content/:docId', ['GET']);

  fastify.get('/api/specs/:source/:slug/content', async (request, reply) => {
    if (rejectUnknownSource(reply, request.params.source)) return;
    try {
      const slug = request.params.slug;
      if (!SLUG_PATTERN.test(slug)) {
        reply.code(404).send({ error: 'Specification content not found' });
        return;
      }
      const manifest = await loadSpecificationManifest({ source: request.params.source, slug });
      if (!manifest) {
        reply.code(404).send({ error: 'Specification content not found' });
        return;
      }
      reply.code(200).header('cache-control', 'no-store').send(manifest);
    } catch {
      reply.code(404).send({ error: 'Specification content not found' });
    }
  });
  registerMethodFallback(fastify, '/api/specs/:source/:slug/content', ['GET']);

  fastify.get('/api/specs/:source/:slug/task-statuses', async (request, reply) => {
    if (rejectUnknownSource(reply, request.params.source)) return;
    try {
      const slug = request.params.slug;
      if (!SLUG_PATTERN.test(slug)) {
        reply.code(404).send({ error: 'Specification task statuses not found' });
        return;
      }
      const statuses = await loadTaskStatuses({ source: request.params.source, slug });
      if (!statuses) {
        reply.code(404).send({ error: 'Specification task statuses not found' });
        return;
      }
      reply.code(200).header('cache-control', 'no-store').send(statuses);
    } catch {
      reply.code(404).send({ error: 'Specification task statuses not found' });
    }
  });
  registerMethodFallback(fastify, '/api/specs/:source/:slug/task-statuses', ['GET']);

  // Owned here: this capability is the only one that starts background
  // action work tied to an AbortController, so it is the only one that
  // needs to abort and await that work on shutdown.
  fastify.addHook('preClose', async () => {
    const entries = Array.from(activeActions.values());
    for (const { controller } of entries) {
      try {
        controller.abort(new Error('Dashboard server shutting down'));
      } catch {}
    }
    if (entries.length > 0) {
      await Promise.allSettled(entries.map(e => e.completion));
    }
    activeActions.clear();
  });
}
