import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { requireChange, requireTask, setTaskStatus, ROOT, ACTIVE_DIR } from '../../store.mjs';
import { resolveWithinBase, readUtf8 } from '../../../lib/fs.mjs';
import { parseFrontMatterFile } from '../../../lib/yaml.mjs';
import { CliError } from '../../../lib/cli-errors.mjs';
import { resolveWorkflowMode } from '../compatibility.mjs';
import { parseOwnerDecisions, parseConstraints } from '../../fingerprint.mjs';
import {
  validateSemanticReferences,
  validateContextExceptions,
  validateConsequentialPaths,
} from '../../validation.mjs';

/**
 * Validates a task's definition files, frontmatter, semantics, and dependencies
 * prior to publication.
 */
function validateTaskDefinitionForPublish(change, task) {
  if (!task.file) {
    throw new CliError(`Task '${task.id}' does not declare a 'file' property in change.yaml`);
  }

  const taskFile = resolveWithinBase(change._dir, task.file);
  if (!existsSync(taskFile)) {
    throw new CliError(`Task '${task.id}' file not found: ${task.file}`);
  }

  let fm;
  try {
    fm = parseFrontMatterFile(taskFile);
  } catch (err) {
    throw new CliError(`Task '${task.id}' has invalid front matter in ${task.file}: ${err.message}`);
  }

  if (fm.id && fm.id !== task.id) {
    throw new CliError(
      `Task file id '${fm.id}' does not match task id '${task.id}' in change.yaml`
    );
  }

  const errors = [];
  const label = `${change._file || change.id}: task '${task.id}'`;
  const ownerDecisionsFile = join(change._dir, 'owner-decisions.md');
  const overviewFile = join(change._dir, 'overview.md');
  const decisionsMap = parseOwnerDecisions(
    existsSync(ownerDecisionsFile) ? readUtf8(ownerDecisionsFile) : ''
  );
  const constraintsMap = parseConstraints(
    existsSync(overviewFile) ? readUtf8(overviewFile) : ''
  );

  validateSemanticReferences(task, fm, decisionsMap, constraintsMap, errors, label);
  validateContextExceptions(fm, decisionsMap, errors, label);
  validateConsequentialPaths(fm, errors, label);

  if (fm.type !== undefined && fm.type !== 'mechanical') {
    errors.push(`${label}: unrecognized type '${fm.type}' (only 'mechanical' is defined)`);
  }

  if (errors.length > 0) {
    throw new CliError(`Task '${task.id}' definition validation failed:\n  ${errors.join('\n  ')}`);
  }
}

/**
 * Independent deterministic operation: marks a draft, valid, dependency-clean,
 * not-yet-started task ready for execution (`task.status: approved`).
 *
 * @param {string} changeSlug
 * @param {string} taskId
 * @param {object} [options]
 * @param {string} [options.activeDir]
 * @param {string} [options.repoRoot]
 * @returns {{ ok: boolean, changeSlug: string, taskId: string, status: string }}
 */
export function publishTask(changeSlug, taskId, options = {}) {
  const { activeDir = ACTIVE_DIR, repoRoot = ROOT } = options;

  // 1. Guard: Spec resolves to deterministic
  const change = requireChange(changeSlug, activeDir);
  const resolvedMode = resolveWorkflowMode(change, options);
  if (resolvedMode.mode !== 'deterministic') {
    throw new CliError(
      `Cannot run deterministic 'workflow task publish' against ${resolvedMode.mode} specification '${changeSlug || change.id}'. ` +
      `Use legacy command surface instead: approve, start, complete, verify.`
    );
  }

  // 2. Task exists
  const task = requireTask(change, taskId);

  // 3. Task status is draft
  if (task.status !== 'draft') {
    throw new CliError(
      `Task '${taskId}' in change '${changeSlug || change.id}' has status '${task.status}'. Only 'draft' tasks can be published.`
    );
  }

  // 4. Task definition validates
  validateTaskDefinitionForPublish(change, task);

  // 5. depends_on entries all resolve to real tasks in the same change
  const changeTaskIds = new Set(change.tasks.map(t => t.id));
  for (const dep of task.depends_on || []) {
    if (!changeTaskIds.has(dep)) {
      throw new CliError(
        `Task '${task.id}' depends_on unknown task '${dep}' in change '${changeSlug || change.id}'`
      );
    }
    if (dep === task.id) {
      throw new CliError(`Task '${task.id}' cannot depend on itself`);
    }
  }

  // 6. No workflow_progress exists yet for this task
  if (task.workflow_progress) {
    throw new CliError(
      `Task '${task.id}' has already started (workflow_progress is present). Cannot publish.`
    );
  }

  // State mutation: write task.status = 'approved'
  setTaskStatus(change, taskId, 'approved');
  task.status = 'approved';

  return {
    ok: true,
    changeSlug: change.id || changeSlug,
    taskId: task.id,
    status: 'approved',
  };
}
