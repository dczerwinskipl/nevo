import { sendJson, readJsonBody, HttpError } from '../http-utils.mjs';
import {
  loadSpecificationPullRequestFileDiffs,
  loadSpecificationPullRequestFiles,
  loadSpecificationPullRequestFullDiff,
  loadSpecificationPullRequests,
} from '../providers/service.mjs';

export async function handlePullRequestRoute({
  request,
  response,
  method,
  url,
}) {
  const pullRequestSubRoute = url.pathname.match(
    /^\/api\/specs\/(active|archive)\/([^/]+)\/pull-requests\/(\d+)\/(files|file-diffs|diff)$/,
  );
  if (pullRequestSubRoute) {
    const [, source, rawSlug, rawNumber, resource] = pullRequestSubRoute;
    let slug;
    try {
      slug = decodeURIComponent(rawSlug);
    } catch {
      sendJson(response, 404, { error: 'Pull request not found' });
      return true;
    }
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(slug)) {
      sendJson(response, 404, { error: 'Pull request not found' });
      return true;
    }
    const number = Number(rawNumber);

    if (resource === 'files') {
      if (method !== 'GET') { sendJson(response, 405, { error: 'Method not allowed' }); return true; }
      try {
        const files = await loadSpecificationPullRequestFiles({ source, slug, number });
        if (!files) { sendJson(response, 404, { error: 'Pull request files not found' }); return true; }
        sendJson(response, 200, files);
      } catch (error) {
        const status = typeof error?.status === 'number' ? error.status : 502;
        sendJson(response, status, { error: error?.message || 'Unable to load pull request files' });
      }
      return true;
    }

    if (resource === 'diff') {
      if (method !== 'GET') { sendJson(response, 405, { error: 'Method not allowed' }); return true; }
      try {
        const diff = await loadSpecificationPullRequestFullDiff({ source, slug, number });
        if (!diff) { sendJson(response, 404, { error: 'Pull request diff not found' }); return true; }
        sendJson(response, 200, diff);
      } catch (error) {
        const status = typeof error?.status === 'number' ? error.status : 502;
        sendJson(response, status, { error: error?.message || 'Unable to load pull request diff' });
      }
      return true;
    }

    // resource === 'file-diffs'
    if (method !== 'POST') { sendJson(response, 405, { error: 'Method not allowed' }); return true; }
    try {
      const body = await readJsonBody(request);
      if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.paths)) {
        sendJson(response, 400, { error: 'Request body must be a JSON object with a paths array.' });
        return true;
      }
      const paths = body.paths.filter(path => typeof path === 'string');
      const headSha = typeof body.headSha === 'string' ? body.headSha : null;
      const diffs = await loadSpecificationPullRequestFileDiffs({ source, slug, number, paths, headSha });
      if (!diffs) { sendJson(response, 404, { error: 'Pull request not found' }); return true; }
      sendJson(response, 200, diffs);
    } catch (error) {
      const status = typeof error?.status === 'number' ? error.status : (typeof error?.statusCode === 'number' ? error.statusCode : 502);
      sendJson(response, status, {
        error: error?.message || 'Unable to load pull request file diffs.',
      });
    }
    return true;
  }

  const pullRequestRoute = url.pathname.match(/^\/api\/specs\/(active|archive)\/([^/]+)\/pull-requests$/);
  if (pullRequestRoute) {
    if (method !== 'GET') {
      sendJson(response, 405, { error: 'Method not allowed' });
      return true;
    }
    try {
      const slug = decodeURIComponent(pullRequestRoute[2]);
      if (!/^[a-z0-9][a-z0-9._-]*$/i.test(slug)) {
        sendJson(response, 404, { error: 'Specification changes not found' });
        return true;
      }
      const changes = await loadSpecificationPullRequests({ source: pullRequestRoute[1], slug });
      if (!changes) {
        sendJson(response, 404, { error: 'Specification changes not found' });
        return true;
      }
      sendJson(response, 200, changes);
    } catch {
      sendJson(response, 500, { error: 'Unable to load specification changes' });
    }
    return true;
  }

  return false;
}
