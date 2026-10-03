// Non-mutating context-capacity preflight (Task 03, D34, D38).
// Pure workflow domain logic: zero dashboard/model-catalog imports.

import { WorkflowError } from '../errors.mjs';

/**
 * Normalizes text to standard Unix line endings (LF).
 */
function normalizeLf(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/\r\n/g, '\n');
}

/**
 * Builds the canonical serialized prospective text bootstrap payload across member tasks.
 * Deterministic ordering by task order ascending, then task ID ascending.
 *
 * @param {object} params
 * @param {object} params.change
 * @param {object[]} params.tasks
 * @param {object} [params.definition]
 * @returns {string} Canonical text payload
 */
export function buildCanonicalProspectivePayload({ change, tasks = [] }) {
  const sortedTasks = [...tasks].sort((a, b) => {
    const orderA = a.order ?? 999;
    const orderB = b.order ?? 999;
    if (orderA !== orderB) return orderA - orderB;
    return String(a.id).localeCompare(String(b.id));
  });

  const parts = [];
  parts.push(`=== CHANGE: ${change?.id || change?._slug || 'unknown'} ===`);
  if (change?.title) parts.push(`Title: ${change.title}`);
  if (change?.description) parts.push(`Description: ${change.description}`);

  for (const t of sortedTasks) {
    parts.push(`--- TASK: ${t.id} (order: ${t.order ?? 0}) ---`);
    if (t.title) parts.push(`Title: ${t.title}`);
    if (t.description) parts.push(`Description: ${t.description}`);
    if (Array.isArray(t.allowed_paths)) {
      parts.push(`Allowed Paths:\n${t.allowed_paths.map(p => `  - ${p}`).join('\n')}`);
    }
    if (Array.isArray(t.forbidden_paths)) {
      parts.push(`Forbidden Paths:\n${t.forbidden_paths.map(p => `  - ${p}`).join('\n')}`);
    }
    if (Array.isArray(t.acceptance_criteria)) {
      parts.push(`Acceptance Criteria:\n${t.acceptance_criteria.map(c => `  - ${c}`).join('\n')}`);
    }
    if (t.rawContent) {
      parts.push(`Task Content:\n${t.rawContent}`);
    }
  }

  return normalizeLf(parts.join('\n\n'));
}

/**
 * Runs the non-mutating context-capacity preflight before any member activation (D34, D38).
 * Never accepts a live capacity override from the agent or caller.
 *
 * @param {object} params
 * @param {object} params.change
 * @param {object[]} params.tasks
 * @param {object} params.reservation - Durable group reservation containing frozen executionConfigSnapshot
 * @param {object} [params.definition]
 * @returns {{
 *   passed: boolean,
 *   status: 'known' | 'unknown',
 *   estimatedContextTokensUpperBound: number,
 *   maxContextTokens?: number,
 *   reason?: string,
 *   source?: string
 * }}
 */
export function preflightBatchCapacity(params = {}) {
  const { change, tasks = [], reservation } = params;

  if (!reservation) {
    throw new WorkflowError('preflightBatchCapacity requires reservation', { code: 'RESERVATION_REQUIRED' });
  }

  const snapshot = reservation.executionConfigSnapshot || {};
  const capacity = snapshot.contextCapacity || { status: 'unknown', reason: 'unspecified' };

  const canonicalPayload = buildCanonicalProspectivePayload({ change, tasks });
  const estimatedContextTokensUpperBound = Buffer.byteLength(canonicalPayload, 'utf8');

  if (capacity.status === 'known') {
    const maxContextTokens = Number(capacity.maxContextTokens);
    if (!Number.isFinite(maxContextTokens) || maxContextTokens <= 0) {
      throw new WorkflowError(`Invalid frozen maxContextTokens: ${capacity.maxContextTokens}`, {
        code: 'INVALID_CAPACITY_SNAPSHOT',
      });
    }

    if (estimatedContextTokensUpperBound > maxContextTokens) {
      return {
        passed: false,
        status: 'known',
        estimatedContextTokensUpperBound,
        maxContextTokens,
        source: capacity.source || 'catalog',
        code: 'BATCH_CONTEXT_TOO_LARGE',
        reason: `Prospective batch context size (${estimatedContextTokensUpperBound} estimated tokens upper bound) exceeds model context capacity (${maxContextTokens} tokens)`,
      };
    }

    return {
      passed: true,
      status: 'known',
      estimatedContextTokensUpperBound,
      maxContextTokens,
      source: capacity.source || 'catalog',
    };
  }

  // status: 'unknown' — do not invent a number, proceed without blocking
  return {
    passed: true,
    status: 'unknown',
    estimatedContextTokensUpperBound,
    reason: capacity.reason || 'unspecified',
  };
}
