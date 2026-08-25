import { sendJson, readJsonBody, HttpError } from '../http-utils.mjs';
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
} from '../../../specs/service.mjs';

const runningActions = new Set();

export async function handleSpecsRoute({
  request,
  response,
  method,
  url,
  operationRuntime,
}) {
  if (url.pathname === '/api/dashboard') {
    if (method !== 'GET') {
      sendJson(response, 405, { error: 'Method not allowed' });
      return true;
    }
    try {
      const data = await loadDashboardData();
      sendJson(response, 200, data);
    } catch {
      sendJson(response, 500, { error: 'Unable to load specifications' });
    }
    return true;
  }

  if (url.pathname === '/api/specs') {
    if (method === 'POST') {
      try {
        const body = await readJsonBody(request);
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          sendJson(response, 400, { error: 'Request body must be a JSON object.' });
          return true;
        }

        const result = await createSpecification({
          slug: body.slug,
          title: body.title,
          type: body.type,
          goal: body.goal,
        });

        sendJson(response, 201, result);
      } catch (error) {
        if (error instanceof SpecValidationError) {
          sendJson(response, 400, { error: error.message, code: error.code, field: error.field });
        } else if (error instanceof SpecConflictError) {
          sendJson(response, 409, { error: error.message, code: error.code, slug: error.slug });
        } else if (error instanceof SpecRollbackError) {
          sendJson(response, 500, {
            error: error.message,
            code: error.code,
            slug: error.slug,
            failedSteps: error.failedSteps,
          });
        } else if (error instanceof HttpError) {
          sendJson(response, error.status, { error: error.message });
        } else {
          sendJson(response, 500, { error: error?.message || 'Unable to create specification.' });
        }
      }
      return true;
    }
    sendJson(response, 405, { error: 'Method not allowed' });
    return true;
  }

  const actionRoute = url.pathname.match(/^\/api\/specs\/active\/([^/]+)\/actions$/);
  if (actionRoute) {
    let slug;
    try {
      slug = decodeURIComponent(actionRoute[1]);
    } catch {
      sendJson(response, 404, { error: 'Specification actions not found' });
      return true;
    }
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(slug)) {
      sendJson(response, 404, { error: 'Specification actions not found' });
      return true;
    }

    if (method === 'GET') {
      try {
        const result = await loadSpecificationActions({ slug });
        sendJson(response, 200, result);
      } catch (error) {
        const status = error instanceof SpecificationActionError ? error.status : 500;
        sendJson(response, status, { error: status === 404 ? 'Specification actions not found' : 'Unable to load specification actions' });
      }
      return true;
    }

    if (method === 'POST') {
      if (request.headers['x-nevo-dashboard-action'] !== '1') {
        sendJson(response, 403, { error: 'Dashboard action header is required.' });
        return true;
      }
      if (runningActions.has(slug)) {
        sendJson(response, 409, { error: 'Another specification action is already running.' });
        return true;
      }
      runningActions.add(slug);
      let hasAsyncOperation = false;
      try {
        const body = await readJsonBody(request);
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          throw new SpecificationActionError('Request body must be a JSON object.', 400);
        }
        const result = executeSpecificationAction({
          slug,
          action: body.action,
          taskId: body.taskId,
          confirmed: body.confirmed === true,
          operationRuntime,
          onFinished: () => {
            runningActions.delete(slug);
          },
        });

        if (result?.operationId && operationRuntime) {
          try {
            const snapshot = operationRuntime.getSnapshot(result.operationId);
            if (snapshot.status === 'running') {
              hasAsyncOperation = true;
            }
          } catch {}
        }

        sendJson(response, 200, result);
      } catch (error) {
        const known = error instanceof SpecificationActionError || error instanceof HttpError;
        sendJson(response, known ? error.status : 500, {
          error: known ? error.message : 'Unable to execute specification action.',
        });
      } finally {
        if (!hasAsyncOperation) {
          runningActions.delete(slug);
        }
      }
      return true;
    }

    sendJson(response, 405, { error: 'Method not allowed' });
    return true;
  }

  const documentRoute = url.pathname.match(/^\/api\/specs\/(active|archive)\/([^/]+)\/content\/([^/]+)$/);
  if (documentRoute) {
    if (method !== 'GET') {
      sendJson(response, 405, { error: 'Method not allowed' });
      return true;
    }
    try {
      const slug = decodeURIComponent(documentRoute[2]);
      const docId = decodeURIComponent(documentRoute[3]);
      if (!/^[a-z0-9][a-z0-9._-]*$/i.test(slug)) {
        sendJson(response, 404, { error: 'Specification document not found' });
        return true;
      }
      const document = await loadSpecificationDocument({ source: documentRoute[1], slug, docId });
      if (!document) {
        sendJson(response, 404, { error: 'Specification document not found' });
        return true;
      }
      sendJson(response, 200, document);
    } catch {
      sendJson(response, 404, { error: 'Specification document not found' });
    }
    return true;
  }

  const contentRoute = url.pathname.match(/^\/api\/specs\/(active|archive)\/([^/]+)\/content$/);
  if (contentRoute) {
    if (method !== 'GET') {
      sendJson(response, 405, { error: 'Method not allowed' });
      return true;
    }
    try {
      const slug = decodeURIComponent(contentRoute[2]);
      if (!/^[a-z0-9][a-z0-9._-]*$/i.test(slug)) {
        sendJson(response, 404, { error: 'Specification content not found' });
        return true;
      }
      const manifest = await loadSpecificationManifest({ source: contentRoute[1], slug });
      if (!manifest) {
        sendJson(response, 404, { error: 'Specification content not found' });
        return true;
      }
      sendJson(response, 200, manifest);
    } catch {
      sendJson(response, 404, { error: 'Specification content not found' });
    }
    return true;
  }

  const taskStatusesRoute = url.pathname.match(/^\/api\/specs\/(active|archive)\/([^/]+)\/task-statuses$/);
  if (taskStatusesRoute) {
    if (method !== 'GET') {
      sendJson(response, 405, { error: 'Method not allowed' });
      return true;
    }
    try {
      const slug = decodeURIComponent(taskStatusesRoute[2]);
      if (!/^[a-z0-9][a-z0-9._-]*$/i.test(slug)) {
        sendJson(response, 404, { error: 'Specification task statuses not found' });
        return true;
      }
      const statuses = await loadTaskStatuses({ source: taskStatusesRoute[1], slug });
      if (!statuses) {
        sendJson(response, 404, { error: 'Specification task statuses not found' });
        return true;
      }
      sendJson(response, 200, statuses);
    } catch {
      sendJson(response, 404, { error: 'Specification task statuses not found' });
    }
    return true;
  }

  return false;
}
