// Durable physical-worktree-scoped workspace-request queue (D72, D74, D75, D76, D77, D78, D81, D82, D83).
// RequestSequence allocated atomically under workspace-control lock.
// Status transitions use compare-and-set semantics under workspace-control lock.

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { WorkflowError } from './errors.mjs';
import { withWorkspaceControlLock } from './workspace-writer.mjs';

function getRequestsDir(repoRoot) {
  return path.join(repoRoot, '.nevo-ai-local', 'workspace-requests');
}

function getRequestPath(repoRoot, requestId) {
  return path.join(getRequestsDir(repoRoot), `${requestId}.json`);
}

/**
 * Creates a durable workspace request in 'queued' status.
 * Allocation of requestSequence and persistence are atomic under workspace-control lock (D81).
 *
 * @param {object} params
 * @param {string} params.repoRoot
 * @param {string} [params.requestId]
 * @param {'human-submit'|'publish'|'batch-publish'} params.kind
 * @param {string} params.specId
 * @param {string} [params.taskId]
 * @param {any} [params.operationRef]
 * @returns {Promise<object>} Created or existing workspace request
 */
export async function createWorkspaceRequest(params = {}) {
  const {
    repoRoot,
    requestId: givenId,
    kind,
    specId,
    taskId,
    operationRef,
  } = params;

  if (!repoRoot || !kind || !specId) {
    throw new WorkflowError('createWorkspaceRequest requires repoRoot, kind, and specId');
  }

  const requestsDir = getRequestsDir(repoRoot);
  if (!fs.existsSync(requestsDir)) {
    fs.mkdirSync(requestsDir, { recursive: true });
  }

  const requestId = givenId || randomUUID();
  const requestFile = getRequestPath(repoRoot, requestId);

  return await withWorkspaceControlLock(async () => {
    // If request already exists, reuse it (retry after crash preserves allocated sequence, D81)
    if (fs.existsSync(requestFile)) {
      try {
        return JSON.parse(fs.readFileSync(requestFile, 'utf8'));
      } catch {}
    }

    // Atomic scan-max-plus-one under control lock
    const files = fs.readdirSync(requestsDir).filter(f => f.endsWith('.json'));
    let maxSeq = 0;
    for (const file of files) {
      try {
        const item = JSON.parse(fs.readFileSync(path.join(requestsDir, file), 'utf8'));
        if (typeof item.requestSequence === 'number' && item.requestSequence > maxSeq) {
          maxSeq = item.requestSequence;
        }
      } catch {}
    }

    const requestSequence = maxSeq + 1;
    const request = {
      requestId,
      requestSequence,
      kind,
      specId,
      ...(taskId ? { taskId } : {}),
      createdAt: new Date().toISOString(),
      status: 'queued',
      ...(operationRef !== undefined ? { operationRef } : {}),
    };

    fs.writeFileSync(requestFile, JSON.stringify(request, null, 2), 'utf8');
    return request;
  }, { repoRoot });
}

/**
 * Loads a workspace request by id.
 *
 * @param {string} repoRoot
 * @param {string} requestId
 * @returns {object|null}
 */
export function loadWorkspaceRequest(repoRoot, requestId) {
  if (!repoRoot || !requestId) return null;
  const filePath = getRequestPath(repoRoot, requestId);
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Lists workspace requests across the entire physical worktree (D74).
 *
 * @param {object} params
 * @param {string} params.repoRoot
 * @param {string|string[]} [params.status]
 * @returns {Array<object>}
 */
export function listWorkspaceRequests({ repoRoot, status } = {}) {
  if (!repoRoot) return [];
  const requestsDir = getRequestsDir(repoRoot);
  if (!fs.existsSync(requestsDir)) return [];

  const files = fs.readdirSync(requestsDir).filter(f => f.endsWith('.json'));
  const requests = [];

  const expectedStatuses = status
    ? (Array.isArray(status) ? status : [status])
    : null;

  for (const file of files) {
    try {
      const item = JSON.parse(fs.readFileSync(path.join(requestsDir, file), 'utf8'));
      if (expectedStatuses && !expectedStatuses.includes(item.status)) {
        continue;
      }
      requests.push(item);
    } catch {}
  }

  requests.sort((a, b) => (a.requestSequence || 0) - (b.requestSequence || 0));
  return requests;
}

/**
 * Finds an in-flight workspace request matching criteria.
 *
 * @param {string} repoRoot
 * @param {object} [filter]
 * @returns {object|null}
 */
export function findInFlightWorkspaceRequest(repoRoot, filter = {}) {
  const inFlightStatuses = ['queued', 'waiting-for-workspace', 'running'];
  const all = listWorkspaceRequests({ repoRoot, status: inFlightStatuses });
  return all.find(r => {
    if (filter.kind && r.kind !== filter.kind) return false;
    if (filter.specId && r.specId !== filter.specId) return false;
    if (filter.taskId && r.taskId !== filter.taskId) return false;
    return true;
  }) || null;
}

/**
 * Compare-and-set transition for workspace requests under workspace-control lock (D83).
 *
 * @param {object} params
 * @param {string} params.repoRoot
 * @param {string} params.requestId
 * @param {string|string[]} params.expectedStatus
 * @param {string} params.to
 * @param {string} [params.workspaceOwnerId]
 * @returns {Promise<{ transitioned: boolean, reason?: string, currentStatus?: string, request?: object }>}
 */
export async function transitionWorkspaceRequest(params = {}) {
  const {
    repoRoot,
    requestId,
    expectedStatus,
    to,
    workspaceOwnerId,
    ...fields
  } = params;

  if (!repoRoot || !requestId || !expectedStatus || !to) {
    throw new WorkflowError('transitionWorkspaceRequest requires repoRoot, requestId, expectedStatus, and to');
  }

  const expected = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
  const filePath = getRequestPath(repoRoot, requestId);

  return await withWorkspaceControlLock(async () => {
    if (!fs.existsSync(filePath)) {
      return { transitioned: false, reason: 'not-found' };
    }

    let current;
    try {
      current = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return { transitioned: false, reason: 'corrupt-record' };
    }

    if (!expected.includes(current.status)) {
      return { transitioned: false, reason: 'state-conflict', currentStatus: current.status };
    }

    current.status = to;
    if (workspaceOwnerId !== undefined) {
      current.workspaceOwnerId = workspaceOwnerId;
    }
    Object.assign(current, fields);
    current.updatedAt = new Date().toISOString();

    fs.writeFileSync(filePath, JSON.stringify(current, null, 2), 'utf8');
    return { transitioned: true, request: current };
  }, { repoRoot });
}
