import { createActivityDataAdapter } from './data.mjs';

const SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;
const TASK_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;
const SOURCES = new Set(['active', 'archive']);

function validSlug(raw) {
  if (typeof raw !== 'string') return null;
  return SLUG_PATTERN.test(raw) ? raw : null;
}

function validTaskId(raw) {
  if (typeof raw !== 'string') return null;
  return TASK_ID_PATTERN.test(raw) ? raw : null;
}

function rejectSource(reply, source) {
  if (SOURCES.has(source)) return false;
  reply.code(404).send({ error: 'API route not found' });
  return true;
}

/**
 * The activity capability: read-only HTTP endpoints exposing the three
 * Activity query scopes (task activity, spec-only activity, full history).
 *
 * Auto-loaded by Fastify via app.mjs (folder name 'activity' matches
 * CAPABILITY_ROUTES_PATTERN), with no manual registration in app.mjs.
 */
export default async function activityRoutes(fastify, { config = {}, dataAdapter } = {}) {
  const adapter = dataAdapter ?? createActivityDataAdapter(config);

  const sendSuccess = (reply, data) => {
    reply.code(200).header('cache-control', 'no-store').send(data);
  };

  // ── Primary capability endpoints: /api/activity/... ─────────────────────

  // GET /api/activity/:specId
  // Default: full spec history.
  // Query param ?taskId=<id> or ?scope=task&taskId=<id>: task activity.
  // Query param ?scope=spec-only | spec: spec-only activity.
  // Query param ?scope=full: full history.
  fastify.get('/api/activity/:specId', async (request, reply) => {
    const specId = validSlug(request.params.specId);
    if (!specId) {
      reply.code(404).send({ error: 'Specification activity not found' });
      return;
    }

    try {
      const { scope, taskId } = request.query ?? {};

      if (taskId || scope === 'task') {
        const targetTaskId = taskId || (typeof scope === 'string' && scope !== 'task' ? scope : null);
        const validatedTaskId = validTaskId(targetTaskId);
        if (!validatedTaskId) {
          reply.code(400).send({ error: 'Valid taskId is required for task-scoped activity query' });
          return;
        }
        const data = adapter.getTaskActivity(specId, validatedTaskId);
        sendSuccess(reply, data);
        return;
      }

      if (scope === 'spec-only' || scope === 'spec' || scope === 'speconly') {
        const data = adapter.getSpecOnlyActivity(specId);
        sendSuccess(reply, data);
        return;
      }

      const data = adapter.getFullSpecHistory(specId);
      sendSuccess(reply, data);
    } catch {
      reply.code(500).send({ error: 'Unable to load specification activity' });
    }
  });

  // GET /api/activity/:specId/spec-only (and alias /spec)
  const handleSpecOnly = async (request, reply) => {
    const specId = validSlug(request.params.specId);
    if (!specId) {
      reply.code(404).send({ error: 'Specification activity not found' });
      return;
    }
    try {
      const data = adapter.getSpecOnlyActivity(specId);
      sendSuccess(reply, data);
    } catch {
      reply.code(500).send({ error: 'Unable to load specification activity' });
    }
  };
  fastify.get('/api/activity/:specId/spec-only', handleSpecOnly);
  fastify.get('/api/activity/:specId/spec', handleSpecOnly);

  // GET /api/activity/:specId/tasks/:taskId (and alias /task/:taskId)
  const handleTaskActivity = async (request, reply) => {
    const specId = validSlug(request.params.specId);
    if (!specId) {
      reply.code(404).send({ error: 'Specification activity not found' });
      return;
    }
    const taskId = validTaskId(request.params.taskId);
    if (!taskId) {
      reply.code(404).send({ error: 'Task activity not found' });
      return;
    }
    try {
      const data = adapter.getTaskActivity(specId, taskId);
      sendSuccess(reply, data);
    } catch {
      reply.code(500).send({ error: 'Unable to load task activity' });
    }
  };
  fastify.get('/api/activity/:specId/tasks/:taskId', handleTaskActivity);
  fastify.get('/api/activity/:specId/task/:taskId', handleTaskActivity);

  // GET /api/activity/:specId/full (and alias /history)
  const handleFullHistory = async (request, reply) => {
    const specId = validSlug(request.params.specId);
    if (!specId) {
      reply.code(404).send({ error: 'Specification activity not found' });
      return;
    }
    try {
      const data = adapter.getFullSpecHistory(specId);
      sendSuccess(reply, data);
    } catch {
      reply.code(500).send({ error: 'Unable to load specification activity' });
    }
  };
  fastify.get('/api/activity/:specId/full', handleFullHistory);
  fastify.get('/api/activity/:specId/history', handleFullHistory);

  // ── Spec-scoped contextual aliases: /api/specs/:slug/activity... ─────────

  fastify.get('/api/specs/:slug/activity', async (request, reply) => {
    const specId = validSlug(request.params.slug);
    if (!specId) {
      reply.code(404).send({ error: 'Specification activity not found' });
      return;
    }
    try {
      const { scope, taskId } = request.query ?? {};
      if (taskId || scope === 'task') {
        const validatedTaskId = validTaskId(taskId);
        if (!validatedTaskId) {
          reply.code(400).send({ error: 'Valid taskId is required for task-scoped activity query' });
          return;
        }
        sendSuccess(reply, adapter.getTaskActivity(specId, validatedTaskId));
        return;
      }
      if (scope === 'spec-only' || scope === 'spec') {
        sendSuccess(reply, adapter.getSpecOnlyActivity(specId));
        return;
      }
      sendSuccess(reply, adapter.getFullSpecHistory(specId));
    } catch {
      reply.code(500).send({ error: 'Unable to load specification activity' });
    }
  });

  fastify.get('/api/specs/:slug/activity/spec-only', async (request, reply) => {
    const specId = validSlug(request.params.slug);
    if (!specId) {
      reply.code(404).send({ error: 'Specification activity not found' });
      return;
    }
    try {
      sendSuccess(reply, adapter.getSpecOnlyActivity(specId));
    } catch {
      reply.code(500).send({ error: 'Unable to load specification activity' });
    }
  });

  fastify.get('/api/specs/:slug/tasks/:taskId/activity', async (request, reply) => {
    const specId = validSlug(request.params.slug);
    const taskId = validTaskId(request.params.taskId);
    if (!specId || !taskId) {
      reply.code(404).send({ error: 'Activity not found' });
      return;
    }
    try {
      sendSuccess(reply, adapter.getTaskActivity(specId, taskId));
    } catch {
      reply.code(500).send({ error: 'Unable to load task activity' });
    }
  });

  // ── Source-scoped aliases: /api/specs/:source/:slug/activity... ──────────

  fastify.get('/api/specs/:source/:slug/activity', async (request, reply) => {
    if (rejectSource(reply, request.params.source)) return;
    const specId = validSlug(request.params.slug);
    if (!specId) {
      reply.code(404).send({ error: 'Specification activity not found' });
      return;
    }
    try {
      const { scope, taskId } = request.query ?? {};
      if (taskId || scope === 'task') {
        const validatedTaskId = validTaskId(taskId);
        if (!validatedTaskId) {
          reply.code(400).send({ error: 'Valid taskId is required for task-scoped activity query' });
          return;
        }
        sendSuccess(reply, adapter.getTaskActivity(specId, validatedTaskId));
        return;
      }
      if (scope === 'spec-only' || scope === 'spec') {
        sendSuccess(reply, adapter.getSpecOnlyActivity(specId));
        return;
      }
      sendSuccess(reply, adapter.getFullSpecHistory(specId));
    } catch {
      reply.code(500).send({ error: 'Unable to load specification activity' });
    }
  });

  fastify.get('/api/specs/:source/:slug/activity/spec-only', async (request, reply) => {
    if (rejectSource(reply, request.params.source)) return;
    const specId = validSlug(request.params.slug);
    if (!specId) {
      reply.code(404).send({ error: 'Specification activity not found' });
      return;
    }
    try {
      sendSuccess(reply, adapter.getSpecOnlyActivity(specId));
    } catch {
      reply.code(500).send({ error: 'Unable to load specification activity' });
    }
  });

  fastify.get('/api/specs/:source/:slug/tasks/:taskId/activity', async (request, reply) => {
    if (rejectSource(reply, request.params.source)) return;
    const specId = validSlug(request.params.slug);
    const taskId = validTaskId(request.params.taskId);
    if (!specId || !taskId) {
      reply.code(404).send({ error: 'Activity not found' });
      return;
    }
    try {
      sendSuccess(reply, adapter.getTaskActivity(specId, taskId));
    } catch {
      reply.code(500).send({ error: 'Unable to load task activity' });
    }
  });
}
