// tools/specs/derived/registry.mjs — Static registry of derived repository artifacts
// D1-D5, Area A: derived-artifact ownership and deterministic synchronization.

import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSpecs } from '../validation.mjs';
import { WorkflowError } from '../workflow/errors.mjs';

import {
  buildSpecsIndexes,
  writeSpecsIndexes,
  checkSpecsIndexes,
} from '../indexes.mjs';
import {
  ACTIVE_DIR,
  ARCHIVE_DIR,
  ACTIVE_INDEX_MD,
  ARCHIVE_INDEX_MD,
  INDEX_JSON as SPECS_INDEX_JSON,
} from '../store.mjs';
import {
  scanDocs,
  validateDocs,
  buildDocsIndexes,
  writeDocsIndexes,
  checkDocsIndexes,
  readRoutingSources,
  validateRoutingTables,
  buildRoutingIndex,
  writeRoutingIndex,
  checkRoutingIndex,
  pathMatchesRule,
  DOCS_DIR,
  INDEX_JSON as DOCS_INDEX_JSON,
  INDEX_MD as DOCS_INDEX_MD,
  ROUTING_INDEX_FILE,
} from '../../docs/service.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export const specsIndexes = {
  id: 'specs-indexes',
  inputs: [
    'specs/active/*/change.yaml',
    'specs/archive/*/change.yaml',
  ],
  outputs: [
    'specs/index.generated.json',
    'specs/active.generated.md',
    'specs/archive.generated.md',
  ],
  sync(ctx = {}) {
    const repoRoot = ctx.repoRoot || ROOT;
    const activeDir = ctx.activeDir || (ctx.repoRoot ? join(repoRoot, 'specs', 'active') : ACTIVE_DIR);
    const archiveDir = ctx.archiveDir || (ctx.repoRoot ? join(repoRoot, 'specs', 'archive') : ARCHIVE_DIR);
    const activeIndexMd = ctx.activeIndexMd || (ctx.repoRoot ? join(repoRoot, 'specs', 'active.generated.md') : ACTIVE_INDEX_MD);
    const archiveIndexMd = ctx.archiveIndexMd || (ctx.repoRoot ? join(repoRoot, 'specs', 'archive.generated.md') : ARCHIVE_INDEX_MD);
    const indexJson = ctx.indexJson || (ctx.repoRoot ? join(repoRoot, 'specs', 'index.generated.json') : SPECS_INDEX_JSON);

    const built = buildSpecsIndexes({ activeDir, archiveDir });
    writeSpecsIndexes(built, { activeIndexMd, archiveIndexMd, indexJson });
    return {
      written: [
        'specs/index.generated.json',
        'specs/active.generated.md',
        'specs/archive.generated.md',
      ],
    };
  },
  check(ctx = {}) {
    const repoRoot = ctx.repoRoot || ROOT;
    const activeDir = ctx.activeDir || (ctx.repoRoot ? join(repoRoot, 'specs', 'active') : ACTIVE_DIR);
    const archiveDir = ctx.archiveDir || (ctx.repoRoot ? join(repoRoot, 'specs', 'archive') : ARCHIVE_DIR);
    const activeIndexMd = ctx.activeIndexMd || (ctx.repoRoot ? join(repoRoot, 'specs', 'active.generated.md') : ACTIVE_INDEX_MD);
    const archiveIndexMd = ctx.archiveIndexMd || (ctx.repoRoot ? join(repoRoot, 'specs', 'archive.generated.md') : ARCHIVE_INDEX_MD);
    const indexJson = ctx.indexJson || (ctx.repoRoot ? join(repoRoot, 'specs', 'index.generated.json') : SPECS_INDEX_JSON);

    return checkSpecsIndexes({ activeDir, archiveDir, activeIndexMd, archiveIndexMd, indexJson });
  },
};

export const docsIndexes = {
  id: 'docs-indexes',
  inputs: [
    'docs/**/*.md',
  ],
  outputs: [
    'docs/index.generated.json',
    'docs/index.generated.md',
    'docs/routing.generated.json',
  ],
  sync(ctx = {}) {
    const repoRoot = ctx.repoRoot || ROOT;
    const docsDir = ctx.docsDir || (ctx.repoRoot ? join(repoRoot, 'docs') : DOCS_DIR);
    const indexJson = ctx.indexJson || (ctx.repoRoot ? join(repoRoot, 'docs', 'index.generated.json') : DOCS_INDEX_JSON);
    const indexMd = ctx.indexMd || (ctx.repoRoot ? join(repoRoot, 'docs', 'index.generated.md') : DOCS_INDEX_MD);
    const routingJson = ctx.routingJson || (ctx.repoRoot ? join(repoRoot, 'docs', 'routing.generated.json') : ROUTING_INDEX_FILE);

    const docs = scanDocs({ docsDir, repoRoot });
    const validationErrors = validateDocs(docs);
    if (validationErrors.length > 0) {
      throw new Error(`Documentation validation failed: ${validationErrors.join(', ')}`);
    }
    const builtDocs = buildDocsIndexes(docs);
    writeDocsIndexes(builtDocs, { indexJson, indexMd });

    const sources = readRoutingSources(repoRoot);
    const { rules, errors: routingErrors } = validateRoutingTables(sources, repoRoot);
    if (routingErrors.length > 0) {
      throw new Error(`Routing tables validation failed: ${routingErrors.join(', ')}`);
    }
    const builtRouting = buildRoutingIndex(rules);
    writeRoutingIndex(builtRouting, routingJson);

    return {
      written: [
        'docs/index.generated.json',
        'docs/index.generated.md',
        'docs/routing.generated.json',
      ],
    };
  },
  check(ctx = {}) {
    const repoRoot = ctx.repoRoot || ROOT;
    const docsDir = ctx.docsDir || (ctx.repoRoot ? join(repoRoot, 'docs') : DOCS_DIR);
    const indexJson = ctx.indexJson || (ctx.repoRoot ? join(repoRoot, 'docs', 'index.generated.json') : DOCS_INDEX_JSON);
    const indexMd = ctx.indexMd || (ctx.repoRoot ? join(repoRoot, 'docs', 'index.generated.md') : DOCS_INDEX_MD);
    const routingJson = ctx.routingJson || (ctx.repoRoot ? join(repoRoot, 'docs', 'routing.generated.json') : ROUTING_INDEX_FILE);

    const docs = scanDocs({ docsDir, repoRoot });
    const problems = checkDocsIndexes(docs, { indexJson, indexMd });

    const sources = readRoutingSources(repoRoot);
    const { rules } = validateRoutingTables(sources, repoRoot);
    const builtRouting = buildRoutingIndex(rules);
    const routingProblems = checkRoutingIndex(builtRouting, routingJson);

    return [...problems, ...routingProblems];
  },
};

export const DERIVED_GENERATORS = [specsIndexes, docsIndexes];

/**
 * Test whether a normalized relative path matches an input pattern.
 */
function pathMatchesInput(path, pattern) {
  const normPath = path.replace(/\\/g, '/').replace(/^\.\//, '');
  const normPattern = pattern.replace(/\\/g, '/').replace(/^\.\//, '');

  if (normPath === normPattern) return true;
  return pathMatchesRule(normPath, normPattern);
}

/**
 * Select generators whose inputs match any of the given paths.
 * Selective: change.yaml => specs only, docs/**\/*.md => docs only, unrelated => none.
 */
export function planDerivedSync(paths = [], generators = DERIVED_GENERATORS) {
  if (!paths || (typeof paths !== 'object' && typeof paths[Symbol.iterator] !== 'function')) {
    return [];
  }
  const pathList = Array.from(paths);
  const planned = [];

  for (const gen of generators) {
    const matched = pathList.some(p => {
      if (!p || typeof p !== 'string') return false;
      return (gen.inputs || []).some(pattern => pathMatchesInput(p, pattern));
    });
    if (matched) {
      planned.push(gen);
    }
  }

  return planned;
}

/**
 * Return exact output paths of planned generators only.
 */
export function resolveDerivedOwnedPaths(plan) {
  if (!plan) return [];
  let generators = [];

  if (Array.isArray(plan)) {
    generators = plan.map(item => {
      if (typeof item === 'string') {
        return DERIVED_GENERATORS.find(g => g.id === item || g.id === `${item}-indexes`);
      }
      return item;
    }).filter(Boolean);
  } else if (plan && typeof plan === 'object' && Array.isArray(plan.generators)) {
    generators = plan.generators;
  } else if (plan && typeof plan === 'object' && Array.isArray(plan.outputs)) {
    generators = [plan];
  }

  const paths = new Set();
  for (const gen of generators) {
    for (const out of (gen.outputs || [])) {
      paths.add(out.replace(/\\/g, '/'));
    }
  }
  return Array.from(paths);
}

/**
 * Return all output paths across all registered generators.
 */
export function listDerivedOutputs(generators = DERIVED_GENERATORS) {
  const paths = new Set();
  for (const gen of generators) {
    for (const out of (gen.outputs || [])) {
      paths.add(out.replace(/\\/g, '/'));
    }
  }
  return Array.from(paths);
}

/**
 * Execute derived artifact sync for planned generators.
 */
export function syncDerivedArtifacts(options = {}) {
  const {
    repoRoot = ROOT,
    changedPaths = [],
    generators = DERIVED_GENERATORS,
    dryRun = false,
  } = options;

  const plan = planDerivedSync(changedPaths, generators);
  const written = [];

  for (const gen of plan) {
    if (!dryRun && typeof gen.sync === 'function') {
      const res = gen.sync({ repoRoot, ...options });
      if (res && Array.isArray(res.written)) {
        written.push(...res.written);
      }
    }
  }

  return {
    plan,
    written: Array.from(new Set(written)),
  };
}

/**
 * Executes planning, precondition validation, synchronization, and integrity checks
 * across all derived generators affected by dirtyPaths (D1-D5, Area A).
 * Single unified entry point used across finishStep, publish, and batchFinish.
 *
 * @param {object} options
 * @param {string} [options.repoRoot]
 * @param {string[]} [options.dirtyPaths]
 * @param {object} [options.context]
 * @param {boolean} [options.validateRepo=false]
 * @param {string} [options.activeDir]
 * @param {string} [options.archiveDir]
 * @returns {{ plan: Array<object>, derivedOwnedPaths: string[] }}
 */
export function syncAndValidateDerivedArtifacts(options = {}) {
  const repoRoot = options.repoRoot || ROOT;
  const dirtyPaths = options.dirtyPaths || [];
  const context = options.context || {};
  const validateRepo = Boolean(options.validateRepo);
  const activeDir = options.activeDir || join(repoRoot, 'specs', 'active');
  const archiveDir = options.archiveDir || join(repoRoot, 'specs', 'archive');

  let derivedPlan = planDerivedSync(dirtyPaths);
  if (derivedPlan.length === 0) {
    return { plan: [], derivedOwnedPaths: [] };
  }

  // 1. Precondition: Every dirty path matching a triggered generator's inputs
  // must belong to the operation's commit set (taskAllowedPaths ∪ workflowOwnedPaths).
  const operationAllowedPatterns = [
    ...(context.taskAllowedPaths || context.allowedPaths || []),
    ...(context.workflowOwnedPaths || []),
  ];
  if (operationAllowedPatterns.length > 0) {
    for (const dirtyPath of dirtyPaths) {
      const matchesTriggeredInput = derivedPlan.some(gen =>
        (gen.inputs || []).some(pattern => pathMatchesRule(dirtyPath, pattern) || pathMatchesInput(dirtyPath, pattern))
      );
      if (matchesTriggeredInput) {
        const isAllowed = operationAllowedPatterns.some(pattern =>
          pathMatchesRule(dirtyPath, pattern) || pathMatchesInput(dirtyPath, pattern)
        );
        if (!isAllowed) {
          throw new WorkflowError(
            `Dirty path '${dirtyPath}' matches derived generator inputs but is outside operation scope`,
            { code: 'DERIVED_INPUT_DIRTY_OUTSIDE_OPERATION', dirtyPath }
          );
        }
      }
    }
  }

  // 2. Execute sync
  try {
    for (const gen of derivedPlan) {
      if (typeof gen.sync === 'function') {
        gen.sync({ repoRoot, activeDir, archiveDir, ...context });
      }
    }
  } catch (err) {
    throw new WorkflowError(`Derived artifact sync failed: ${err.message}`, {
      code: 'DERIVED_ARTIFACT_SYNC_FAILED',
      cause: err,
    });
  }

  // 3. Generator integrity self-check
  for (const gen of derivedPlan) {
    if (typeof gen.check === 'function') {
      const problems = gen.check({ repoRoot, activeDir, archiveDir, ...context });
      if (Array.isArray(problems) && problems.length > 0) {
        throw new WorkflowError(`Derived artifact integrity check failed for ${gen.id}: ${problems.join(', ')}`, {
          code: 'DERIVED_INTEGRITY_FAILED',
          generatorId: gen.id,
          problems,
        });
      }
    }
  }

  // 4. Repo-wide validate for specs and docs (D5)
  if (validateRepo) {
    const specErrors = validateSpecs({ activeDir, archiveDir });
    const docs = scanDocs({ repoRoot, docsDir: join(repoRoot, 'docs') });
    const docErrors = validateDocs(docs);
    const repoErrors = [...(specErrors || []), ...(docErrors || [])];
    if (repoErrors.length > 0) {
      throw new WorkflowError(
        `Repository-wide validation failed after derived sync: ${repoErrors.join('; ')}`,
        { code: 'REPO_INTEGRITY_FAILED', errors: repoErrors }
      );
    }
  }

  const derivedOwnedPaths = resolveDerivedOwnedPaths(derivedPlan);
  return { plan: derivedPlan, derivedOwnedPaths };
}

