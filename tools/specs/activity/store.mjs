// Local, append-only, per-spec NDJSON store for Activity records.
//
// D1 / D3 / D10: Pure append-only store with leading-newline framing.
// Unlike binding-service.mjs, which performs a read-modify-write cycle on mutable session JSON,
// Activity recording is strictly append-only with each record written in a single write call.
// Because the operating system guarantees append writes and framing uses a leading newline,
// no cross-process advisory lock file is needed here. Interrupted writes leave isolated partial
// lines that are skipped safely on read, and idempotency is guaranteed by read-side deduplication.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { ACTIVITY_SCHEMA_VERSION, validateActivityEnvelope } from './model.mjs';
import { isValidSpecId, resolveCanonicalSpec } from '../identity.mjs';

/**
 * Resolves an identifier (UUID, change slug, or change object) to a stable spec UUID.
 * Falls back to the trimmed string identifier when manifest lookup is unavailable (e.g. in tests).
 *
 * @param {string|object} identifier
 * @param {object} [options]
 * @returns {string}
 */
export function resolveSpecId(identifier, options = {}) {
  if (!identifier) {
    throw new Error('Specification identifier (specId or slug) is required');
  }
  if (typeof identifier === 'object') {
    if (identifier.spec_id) return identifier.spec_id;
    if (identifier.specId) return identifier.specId;
    if (identifier.scope?.specId) return identifier.scope.specId;
  }
  if (typeof identifier === 'string') {
    const trimmed = identifier.trim();
    if (isValidSpecId(trimmed)) {
      return trimmed;
    }
    try {
      const resolveOpts = { ...options };
      if (options.repoRoot) {
        if (!resolveOpts.activeDir) resolveOpts.activeDir = join(options.repoRoot, 'specs', 'active');
        if (!resolveOpts.archiveDir) resolveOpts.archiveDir = join(options.repoRoot, 'specs', 'archive');
      }
      const canonical = resolveCanonicalSpec(trimmed, resolveOpts);
      if (canonical?.specId) {
        return canonical.specId;
      }
    } catch {
      // Not a known manifest slug (e.g. test fixture or mock id); use identifier string directly
    }
    return trimmed;
  }
  return String(identifier);
}

/**
 * Resolves the directory where Activity NDJSON files are stored.
 *
 * @param {object} [options]
 * @param {string} [options.repoRoot]
 * @param {string} [options.activityDir]
 * @param {string} [options.baseDir]
 * @returns {string}
 */
export function activityDir({ repoRoot, activityDir: customDir, baseDir } = {}) {
  if (customDir) return customDir;
  if (baseDir) return baseDir;
  return join(repoRoot || process.cwd(), '.nevo-ai-local', 'activity');
}

/**
 * Resolves the file path for a spec's Activity NDJSON store.
 *
 * @param {string|object} specIdentifier
 * @param {object} [options]
 * @returns {string}
 */
export function activityFilePath(specIdentifier, options = {}) {
  if (options.filePath) return options.filePath;
  const specId = resolveSpecId(specIdentifier, options);
  return join(activityDir(options), `${specId}.ndjson`);
}

/**
 * Normalizes, validates, and appends an Activity envelope to the per-spec NDJSON store.
 *
 * Construction order is fixed (Major 4):
 * (1) normalize/default full envelope: caller-supplied id ?? randomUUID(),
 *     occurredAt ?? now, schemaVersion ?? ACTIVITY_SCHEMA_VERSION,
 *     and canonicalize scope.specId UUID if given as slug.
 * (2) validate the now-complete envelope via validateActivityEnvelope.
 * (3) append to file using leading-newline framing ("\n" + JSON.stringify(record)).
 *
 * @param {object} fields
 * @param {object} [options]
 * @returns {object} The complete, validated, and appended Activity record
 */
export function recordActivity(fields, options = {}) {
  // 1. Normalize/default full envelope
  const envelope = {
    ...(fields && typeof fields === 'object' ? fields : {}),
    id: fields?.id ?? randomUUID(),
    occurredAt: fields?.occurredAt ?? new Date().toISOString(),
    schemaVersion: fields?.schemaVersion ?? ACTIVITY_SCHEMA_VERSION,
  };

  if (envelope.scope && typeof envelope.scope === 'object' && typeof envelope.scope.specId === 'string' && envelope.scope.specId.trim()) {
    envelope.scope = {
      ...envelope.scope,
      specId: resolveSpecId(envelope.scope.specId, options),
    };
  }

  // 2. Validate now-complete envelope
  const validation = validateActivityEnvelope(envelope);
  if (!validation.valid) {
    const message = `Invalid activity record: ${validation.errors.map(e => e.message).join('; ')}`;
    const error = new Error(message);
    error.code = 'INVALID_ACTIVITY_RECORD';
    error.errors = validation.errors;
    throw error;
  }

  // 3. Append to store
  const specId = envelope.scope.specId;
  const filePath = activityFilePath(specId, options);
  mkdirSync(dirname(filePath), { recursive: true });

  // Framing: leading newline "\n" + JSON.stringify(record) ensures interrupted/partial
  // writes are isolated on read without corrupting subsequent valid records (Major 5).
  appendFileSync(filePath, '\n' + JSON.stringify(envelope), 'utf8');

  return envelope;
}

/**
 * Reads all Activity records for a specification from its NDJSON store.
 *
 * Framing & Recovery:
 * Splits on "\n", discards empty strings (including leading blank from first record's leading "\n"),
 * and skips any malformed line that fails JSON.parse (isolating crashed writes).
 *
 * Deduplication (D10 / Blocking 2):
 * Keeps the first occurrence in file order of each `id` and discards subsequent duplicates.
 * Physical duplicate lines remain untouched on disk.
 *
 * @param {string|object} specIdentifier
 * @param {object} [options]
 * @returns {Array<object>}
 */
export function readActivities(specIdentifier, options = {}) {
  const filePath = activityFilePath(specIdentifier, options);
  if (!existsSync(filePath)) {
    return [];
  }

  const content = readFileSync(filePath, 'utf8');
  if (!content) {
    return [];
  }

  const lines = content.split('\n');
  const records = [];
  const seenIds = new Set();

  for (const line of lines) {
    const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (trimmed.trim() === '') {
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Interrupted write / malformed line — skip safely
      continue;
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || typeof parsed.id !== 'string' || !parsed.id.trim()) {
      continue;
    }

    // Keep first occurrence of each id; discard later occurrences
    if (seenIds.has(parsed.id)) {
      continue;
    }

    seenIds.add(parsed.id);
    records.push(parsed);
  }

  return records;
}
