import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { writeUtf8 } from '../lib/fs.mjs';
import { updateYamlFile } from '../lib/yaml.mjs';
import { CliError } from '../lib/cli-errors.mjs';
import {
  listChanges,
  loadChange,
  ACTIVE_DIR,
  ARCHIVE_DIR,
  ACTIVE_INDEX_MD,
  ARCHIVE_INDEX_MD,
  INDEX_JSON,
} from './store.mjs';
import { refreshSpecsIndexes } from './indexes.mjs';

// ── Stable specification identity (D2, area stable-spec-identity, task 01) ─

const SPEC_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A canonical random UUID string — Node's own `crypto.randomUUID()`, no new dependency. */
export function generateSpecId() {
  return randomUUID();
}

/** Canonical-UUID-string format check — the only shape `spec_id` may ever take. */
export function isValidSpecId(value) {
  return typeof value === 'string' && SPEC_ID_RE.test(value);
}

/**
 * The identity a durable, non-slug-keyed relation (e.g. a future AI session
 * attachment) must resolve to before reading or writing anything.
 */
export function resolveStableSpecId(change) {
  if (isValidSpecId(change.spec_id)) return change.spec_id;
  throw new CliError(
    `Change '${change._slug}' has no persisted spec_id — run 'node tools/specs.mjs backfill-spec-id' ` +
    'before any stable-relation (e.g. AI session) operation.'
  );
}

/**
 * Canonical specification resolver supporting both human-readable slug and immutable UUID spec_id.
 */
export function resolveCanonicalSpec(identifier, { activeDir = ACTIVE_DIR, archiveDir = ARCHIVE_DIR } = {}) {
  if (!identifier || typeof identifier !== 'string') {
    throw new CliError('Specification identifier (slug or spec_id) is required.');
  }
  const trimmed = identifier.trim();
  if (isValidSpecId(trimmed)) {
    const all = [...listChanges(activeDir), ...listChanges(archiveDir)];
    const match = all.find(c => c.spec_id === trimmed);
    if (match) {
      return { specId: match.spec_id, slug: match._slug, change: match };
    }
    return { specId: trimmed, slug: null, change: null };
  }

  const change = loadChange(trimmed, activeDir) || loadChange(trimmed, archiveDir);
  if (!change) {
    throw new CliError(`Specification '${trimmed}' not found.`);
  }
  const specId = resolveStableSpecId(change);
  return { specId, slug: change._slug, change };
}

/**
 * Idempotent backfill (D2, AC3): assigns a fresh, globally unique `spec_id`
 * to every active/archived manifest that doesn't already have a valid one —
 * never rewrites an existing valid value.
 */
export function backfillSpecIds({ activeDir = ACTIVE_DIR, archiveDir = ARCHIVE_DIR } = {}) {
  const changes = [...listChanges(activeDir), ...listChanges(archiveDir)];
  const seen = new Set(changes.filter(c => isValidSpecId(c.spec_id)).map(c => c.spec_id));
  const assigned = [];
  for (const change of changes) {
    if (isValidSpecId(change.spec_id)) continue;
    let id = generateSpecId();
    while (seen.has(id)) id = generateSpecId();
    seen.add(id);
    updateYamlFile(change._file, doc => doc.set('spec_id', id));
    assigned.push({ slug: change._slug, file: change._file, specId: id });
  }
  return assigned;
}

// ── Spec validation & error types ──────────────────────────────────────────

export class SpecValidationError extends CliError {
  constructor(message, { field = null, details = null } = {}) {
    super(message);
    this.name = 'SpecValidationError';
    this.code = 'SPEC_VALIDATION_ERROR';
    this.field = field;
    this.details = details;
  }
}

export class SpecConflictError extends CliError {
  constructor(message, { slug = null } = {}) {
    super(message);
    this.name = 'SpecConflictError';
    this.code = 'SPEC_CONFLICT';
    this.slug = slug;
  }
}

export class SpecRollbackError extends CliError {
  constructor(message, { cause = null, slug = null, failedSteps = [], recoveryErrors = [] } = {}) {
    super(message);
    this.name = 'SpecRollbackError';
    this.code = 'SPEC_ROLLBACK_FAILED';
    this.slug = slug;
    this.failedSteps = failedSteps;
    this.recoveryErrors = recoveryErrors;
    if (cause) {
      this.cause = cause;
    }
  }
}

export const SPEC_SLUG_REGEX = /^[a-z0-9][a-z0-9._-]*$/;
export const SPEC_TYPES = Object.freeze(['standard', 'architectural', 'small', 'exploratory']);

export function validateSpecSlug(slug) {
  if (typeof slug !== 'string' || !slug.trim()) {
    throw new SpecValidationError('Specification slug is required.', { field: 'slug' });
  }
  const trimmed = slug.trim();
  if (!SPEC_SLUG_REGEX.test(trimmed)) {
    throw new SpecValidationError(
      `Invalid specification slug '${trimmed}'. Must match ${SPEC_SLUG_REGEX} (lowercase alphanumeric, dot, underscore, or hyphen).`,
      { field: 'slug' }
    );
  }
  if (trimmed.includes('..') || trimmed.startsWith('/') || trimmed.startsWith('\\')) {
    throw new SpecValidationError(`Invalid specification slug '${trimmed}': path traversal is forbidden.`, { field: 'slug' });
  }
  return trimmed;
}

export function validateSpecType(type) {
  const normalized = (type || 'standard').toString().trim().toLowerCase();
  if (!SPEC_TYPES.includes(normalized)) {
    throw new SpecValidationError(
      `Invalid specification type '${type}'. Must be one of: ${SPEC_TYPES.join(', ')}.`,
      { field: 'type' }
    );
  }
  return normalized;
}

let creationLockPromise = Promise.resolve();

export function withSpecificationCreationLock(fn) {
  const previous = creationLockPromise;
  let release;
  creationLockPromise = new Promise(resolve => { release = resolve; });
  return previous.then(async () => {
    try {
      return await fn();
    } finally {
      release();
    }
  });
}

export async function createSpecification({
  slug,
  title,
  type = 'standard',
  goal = '',
  activeDir = ACTIVE_DIR,
  archiveDir = ARCHIVE_DIR,
  activeIndexMd = ACTIVE_INDEX_MD,
  archiveIndexMd = ARCHIVE_INDEX_MD,
  indexJson = INDEX_JSON,
  fsRm = rmSync,
  refreshIndexes = refreshSpecsIndexes,
} = {}) {
  return withSpecificationCreationLock(async () => {
    const validSlug = validateSpecSlug(slug);
    if (typeof title !== 'string' || !title.trim()) {
      throw new SpecValidationError('Specification title is required.', { field: 'title' });
    }
    const validTitle = title.trim();
    const validType = validateSpecType(type);
    const validGoal = typeof goal === 'string' ? goal.trim() : '';

    const targetDir = join(activeDir, validSlug);
    const archiveTargetDir = join(archiveDir, validSlug);
    if (existsSync(targetDir) || existsSync(archiveTargetDir)) {
      throw new SpecConflictError(`Specification '${validSlug}' already exists.`, { slug: validSlug });
    }

    const specId = randomUUID();
    const today = new Date().toISOString().slice(0, 10);

    const changeYamlContent = `# Specification manifest for ${validSlug}
id: ${validSlug}
title: ${JSON.stringify(validTitle)}
type: ${validType}
status: draft
priority: 10
created: ${today}
tasks: []
spec_id: ${specId}
`;

    const overviewMdContent = `---
id: spec.${validSlug}
type: change
title: ${JSON.stringify(validTitle)}
status: draft
change: ${validSlug}
---

# ${validTitle}

## Context

## Goal

${validGoal || 'Define the goals and expected outcomes of this specification.'}

## Non-goals

## Constraints

## Affected Areas

## Implementation Decomposition

## Acceptance Criteria & Verification
`;

    let createdDirectory = false;
    let attemptedIndexWrite = false;

    try {
      mkdirSync(targetDir, { recursive: false });
      createdDirectory = true;

      writeUtf8(join(targetDir, 'change.yaml'), changeYamlContent);
      writeUtf8(join(targetDir, 'overview.md'), overviewMdContent);

      attemptedIndexWrite = true;
      refreshIndexes({
        activeDir,
        archiveDir,
        activeIndexMd,
        archiveIndexMd,
        indexJson,
      });

      const loadedChange = loadChange(validSlug, activeDir);
      return {
        ok: true,
        slug: validSlug,
        specId,
        change: loadedChange,
      };
    } catch (creationError) {
      const failedSteps = [];
      const recoveryErrors = [];

      if (createdDirectory) {
        try {
          fsRm(targetDir, { recursive: true, force: true });
        } catch (dirError) {
          failedSteps.push('cleanup_directory');
          recoveryErrors.push(dirError);
        }
      }

      if (attemptedIndexWrite) {
        try {
          refreshIndexes({
            activeDir,
            archiveDir,
            activeIndexMd,
            archiveIndexMd,
            indexJson,
          });
        } catch (indexError) {
          failedSteps.push('rebuild_indexes');
          recoveryErrors.push(indexError);
        }
      }

      if (failedSteps.length > 0) {
        const stepNames = failedSteps.join(', ');
        throw new SpecRollbackError(
          `Specification creation failed and rollback was incomplete (failed steps: ${stepNames}): ${creationError?.message || String(creationError)}`,
          {
            cause: creationError,
            slug: validSlug,
            failedSteps,
            recoveryErrors,
          }
        );
      }

      throw creationError;
    }
  });
}
