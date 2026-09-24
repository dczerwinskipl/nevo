// Durable remediation group records (D31, D36).
// Persisted at `.nevo-ai-local/remediation-groups/<change>/<remediationId>.json`.

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { WorkflowError } from './errors.mjs';

function getRemediationDir(repoRoot, change) {
  return path.join(repoRoot, '.nevo-ai-local', 'remediation-groups', change);
}

function getRemediationFilePath(repoRoot, change, remediationId) {
  return path.join(getRemediationDir(repoRoot, change), `${remediationId}.json`);
}

/**
 * Creates and persists a durable remediation record.
 *
 * @param {object} params
 * @param {string} params.repoRoot
 * @param {string} params.change
 * @param {string} [params.remediationId]
 * @param {{ taskId: string, releaseEpoch: { step: string, attempt: number } }} params.invalidatedDependency
 * @param {Array<{ taskId: string, role: 'releasing-task'|'consumer', terminal?: boolean }>} params.members
 * @returns {object} The created remediation record
 */
export function createRemediationRecord(params = {}) {
  const {
    repoRoot,
    change,
    remediationId = randomUUID(),
    invalidatedDependency,
    members = [],
  } = params;

  if (!repoRoot || !change || !invalidatedDependency) {
    throw new WorkflowError('createRemediationRecord requires repoRoot, change, and invalidatedDependency');
  }

  const dir = getRemediationDir(repoRoot, change);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const record = {
    remediationId,
    change,
    invalidatedDependency,
    invalidatedAt: new Date().toISOString(),
    members: members.map(m => ({
      taskId: m.taskId,
      role: m.role || 'consumer',
      terminal: Boolean(m.terminal),
    })),
    status: 'active',
    createdAt: new Date().toISOString(),
  };

  const filePath = getRemediationFilePath(repoRoot, change, remediationId);
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf8');
  return record;
}

/**
 * Loads a remediation record by id.
 *
 * @param {string} repoRoot
 * @param {string} change
 * @param {string} remediationId
 * @returns {object|null}
 */
export function loadRemediationRecord(repoRoot, change, remediationId) {
  const filePath = getRemediationFilePath(repoRoot, change, remediationId);
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Lists remediation records for a change.
 *
 * @param {string} repoRoot
 * @param {string} change
 * @param {object} [filter]
 * @param {'active'|'resolved'} [filter.status]
 * @returns {Array<object>}
 */
export function listRemediationRecords(repoRoot, change, filter = {}) {
  const dir = getRemediationDir(repoRoot, change);
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  const records = [];
  for (const file of files) {
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      if (filter.status && rec.status !== filter.status) {
        continue;
      }
      records.push(rec);
    } catch {}
  }

  return records;
}

/**
 * Finds all currently active remediation groups for a change.
 *
 * @param {string} repoRoot
 * @param {string} change
 * @returns {Array<object>}
 */
export function findActiveRemediationGroups(repoRoot, change) {
  return listRemediationRecords(repoRoot, change, { status: 'active' });
}

/**
 * Marks a remediation group as resolved.
 *
 * @param {string} repoRoot
 * @param {string} change
 * @param {string} remediationId
 * @returns {object|null}
 */
export function resolveRemediationGroup(repoRoot, change, remediationId) {
  const record = loadRemediationRecord(repoRoot, change, remediationId);
  if (!record) return null;

  record.status = 'resolved';
  record.resolvedAt = new Date().toISOString();
  record.updatedAt = new Date().toISOString();

  const filePath = getRemediationFilePath(repoRoot, change, remediationId);
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf8');
  return record;
}
