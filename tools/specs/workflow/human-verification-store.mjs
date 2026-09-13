// File-backed HumanVerificationReader (D9's terminal-only operator confirmation path).
// `workflow step start`/`workflow step finish` run as separate CLI invocations from the
// operator's `workflow verify-human --confirm` call, so the recorded sign-off must
// survive across process invocations — an in-memory reader (fine for tests within one
// process) cannot serve the real CLI. Persisted under the same git-ignored
// `.nevo-ai-local/` runtime-storage convention as the finish-operation record
// (`finish-operation.mjs`), never inside `change.yaml` — this is operator confirmation
// state, not Git-tracked domain/specification state.
//
// D24/D29: scoped by the full configured identity — change, task, step, and gate — so
// confirming one human-verification gate can never silently satisfy a different,
// independently-configured one (a real hole once a workflow can have more than one
// human gate, across steps or within the same step). `stepId`/`gateId` are per-call
// (from the query the extended `HumanVerificationGate` now builds, D29), not fixed at
// construction — only `repoRoot`/`change`/`task` are constant for one CLI invocation.

import { mkdirSync, writeFileSync, renameSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { HumanVerificationReader } from './gates/human-gate.mjs';

// Matches `step-runner.mjs`'s `gateDisplayId` default for a human gate with no explicit
// `id` — duplicated as a small literal rather than importing across modules for one
// constant; D30 requires an explicit, unique `id` only once a step has more than one
// human gate, so a single default gate never needs to disambiguate against this value.
const DEFAULT_GATE_SEGMENT = 'human-review';

export function verificationFilePath(repoRoot, changeSlug, taskId, stepId, attempt, gateId) {
  const step = stepId || 'unscoped';
  const att = attempt ? `attempt-${attempt}` : 'attempt-1';
  const gate = gateId || DEFAULT_GATE_SEGMENT;
  return join(repoRoot, '.nevo-ai-local', 'human-verifications', changeSlug, taskId, step, att, `${gate}.json`);
}

export class FileHumanVerificationStore extends HumanVerificationReader {
  /**
   * @param {object} params
   * @param {string} params.repoRoot - Absolute repository root
   * @param {string} params.change - Change slug
   * @param {string|object} params.task - Task id or task record
   * @param {number} [params.attempt] - Step attempt number
   */
  constructor({ repoRoot, change, task, attempt }) {
    super();
    this._repoRoot = repoRoot;
    this._change = typeof change === 'object' ? (change.id || change._slug) : change;
    this._task = typeof task === 'object' ? task.id : task;
    this._attempt = attempt ?? (typeof task === 'object' ? task.workflow_progress?.current_attempt : undefined);
  }

  #file(stepId, attempt, gateId) {
    const att = attempt ?? this._attempt ?? 1;
    return verificationFilePath(this._repoRoot, this._change, this._task, stepId, att, gateId);
  }

  getSignoff({ scope, targetId, requiredRole, stepId, attempt, gateId }) {
    const effectiveAttempt = attempt ?? this._attempt ?? 1;
    const file = this.#file(stepId, effectiveAttempt, gateId);
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
      (record.role || record.confirmedBy) === requiredRole &&
      (record.attempt === undefined || record.attempt === effectiveAttempt)
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
   * @param {string} [params.stepId] - The exact configured step this confirmation is for
   * @param {number} [params.attempt] - The attempt number this confirmation is for
   * @param {string|null} [params.gateId] - The gate's own explicit `id`, when configured
   * @returns {object} The persisted signoff record
   */
  confirm({ scope, targetId, role = 'owner', stepId, attempt, gateId }) {
    const effectiveAttempt = attempt ?? this._attempt ?? 1;
    const record = {
      scope,
      targetId,
      role,
      confirmedBy: role,
      confirmed: true,
      stepId: stepId || null,
      attempt: effectiveAttempt,
      gateId: gateId || null,
      timestamp: new Date().toISOString(),
    };
    const file = this.#file(stepId, effectiveAttempt, gateId);
    mkdirSync(dirname(file), { recursive: true });
    const tempFile = `${file}.${randomUUID()}.tmp`;
    writeFileSync(tempFile, JSON.stringify(record, null, 2), 'utf8');
    renameSync(tempFile, file);
    return record;
  }
}
