// Post-bootstrap workspace baseline recorder (Task 03, D29, D39).
// Pure workflow domain logic: zero dashboard imports.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as git from '../../../lib/git.mjs';

function computeFileHash(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const st = fs.statSync(filePath);
      if (st.isFile()) {
        const content = fs.readFileSync(filePath);
        return crypto.createHash('sha256').update(content).digest('hex');
      }
    }
  } catch {}
  return null;
}

function getFileMode(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return (fs.statSync(filePath).mode & 0o777).toString(8);
    }
  } catch {}
  return null;
}

/**
 * Computes a deterministic workspace delta fingerprint relative to HEAD,
 * excluding `.nevo-ai-local/**` (D29, D39).
 *
 * @param {string} repoRoot
 * @returns {Array<{ path: string, status: string, mode: string|null, hash: string|null }>}
 */
export function computeWorkspaceDeltaFingerprint(repoRoot) {
  if (!repoRoot || !fs.existsSync(path.join(repoRoot, '.git'))) {
    return [];
  }

  let rawStatus = '';
  try {
    rawStatus = git.getWorkingTreeStatus(repoRoot);
  } catch {
    return [];
  }

  if (!rawStatus) return [];

  const lines = rawStatus.split(/\r?\n/).filter(line => line.trim().length > 0);
  const entries = [];

  for (const line of lines) {
    const status = line.slice(0, 2);
    let filePath = line.slice(3).trim();
    if (filePath.includes(' -> ')) {
      filePath = filePath.split(' -> ')[1].trim();
    }
    filePath = filePath.replace(/^"|"$/g, '').replace(/\\/g, '/');

    if (filePath === '.nevo-ai-local' || filePath.startsWith('.nevo-ai-local/')) {
      continue;
    }

    const fullPath = path.join(repoRoot, filePath);
    const hash = computeFileHash(fullPath);
    const mode = getFileMode(fullPath);

    entries.push({
      path: filePath,
      status: status.trim(),
      mode,
      hash,
    });
  }

  entries.sort((a, b) => a.path.localeCompare(b.path));
  return entries;
}

/**
 * Captures the complete post-bootstrap workspace baseline (D29, D39).
 * Captured AFTER member activation is completed.
 *
 * @param {string} repoRoot
 * @returns {{ baseRevision: string|null, fingerprint: Array<{ path: string, status: string, mode: string|null, hash: string|null }> }}
 */
export function recordWorkspaceBaseline(repoRoot) {
  let baseRevision = null;
  if (repoRoot && fs.existsSync(path.join(repoRoot, '.git'))) {
    try {
      baseRevision = git.getCurrentRevision(repoRoot);
    } catch {
      baseRevision = null;
    }
  }

  const fingerprint = computeWorkspaceDeltaFingerprint(repoRoot);

  return {
    baseRevision,
    fingerprint,
  };
}
