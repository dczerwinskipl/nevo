// File-backed HumanVerificationReader (D9's terminal-only operator confirmation path).
// `workflow step start`/`workflow step finish` run as separate CLI invocations from the
// operator's `workflow verify-human --confirm` call, so the recorded sign-off must
// survive across process invocations — an in-memory reader (fine for tests within one
// process) cannot serve the real CLI. Persisted under the same git-ignored
// `.nevo-ai-local/` runtime-storage convention as the finish-operation record
// (`finish-operation.mjs`), never inside `change.yaml` — this is operator confirmation
// state, not Git-tracked domain/specification state.

import { mkdirSync, writeFileSync, renameSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { HumanVerificationReader } from './gates/human-gate.mjs';

function verificationFilePath(repoRoot, changeSlug, taskId) {
  return join(repoRoot, '.nevo-ai-local', 'human-verifications', changeSlug, `${taskId}.json`);
}

export class FileHumanVerificationStore extends HumanVerificationReader {
  /**
   * @param {object} params
   * @param {string} params.repoRoot - Absolute repository root
   * @param {string} params.change - Change slug
   * @param {string} params.task - Task id
   */
  constructor({ repoRoot, change, task }) {
    super();
    this._repoRoot = repoRoot;
    this._change = change;
    this._task = task;
  }

  #file() {
    return verificationFilePath(this._repoRoot, this._change, this._task);
  }

  getSignoff({ scope, targetId, requiredRole }) {
    const file = this.#file();
    if (!existsSync(file)) return null;
    let record;
    try {
      record = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
    if (
      record &&
      record.confirmed === true &&
      record.scope === scope &&
      record.targetId === targetId &&
      (record.role || record.confirmedBy) === requiredRole
    ) {
      return record;
    }
    return null;
  }

  /**
   * Records an explicit operator confirmation — the only way this gate can be satisfied
   * (C8); never reachable from the agent-facing `step start`/`step finish` calls.
   *
   * @param {object} params
   * @param {string} params.scope
   * @param {string} params.targetId
   * @param {string} [params.role='owner']
   * @returns {object} The persisted signoff record
   */
  confirm({ scope, targetId, role = 'owner' }) {
    const record = {
      scope,
      targetId,
      role,
      confirmedBy: role,
      confirmed: true,
      timestamp: new Date().toISOString(),
    };
    const file = this.#file();
    mkdirSync(dirname(file), { recursive: true });
    const tempFile = `${file}.${randomUUID()}.tmp`;
    writeFileSync(tempFile, JSON.stringify(record, null, 2), 'utf8');
    renameSync(tempFile, file);
    return record;
  }
}
