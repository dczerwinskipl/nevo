import { requireChange, writeBulkTransition } from '../store.mjs';
import { resolveReviewScope, validateBulkTransition } from '../lifecycle/reviews.mjs';
import { CliError } from '../../lib/cli-errors.mjs';

/**
 * Application operation: resolve review scope for a specification.
 */
export function getReviewScope(changeSlug, options = {}) {
  const activeDir = options.activeDir || options.directories?.activeDir;
  const change = requireChange(changeSlug, activeDir);
  const result = resolveReviewScope(change, { all: Boolean(options.all), tasks: options.tasks });
  if (!result.ok) throw new CliError(result.reason);
  return { change: changeSlug, orderedTasks: result.orderedTasks };
}

/**
 * Application operation: validate and apply a bulk transition across multiple tasks in a single change.yaml write.
 */
export function applyBulkTransition(changeSlug, options = {}) {
  const activeDir = options.activeDir || options.directories?.activeDir;
  const change = requireChange(changeSlug, activeDir);
  if (!options.tasks) throw new CliError('bulk-transition requires --tasks <id,id,...>.');
  if (!options.outcome) throw new CliError('bulk-transition requires --outcome <self-verified|verified>.');

  const taskIds = options.tasks.split(',').map(s => s.trim()).filter(Boolean);
  const unknown = taskIds.filter(id => !change.tasks.some(t => t.id === id));
  if (unknown.length) throw new CliError(`Unknown task id(s): ${unknown.join(', ')}`);

  const result = validateBulkTransition(change, taskIds, options.outcome);
  if (!result.ok) throw new CliError(result.reason);

  writeBulkTransition(change, result.transitions);

  const changed = result.transitions.filter(t => !t.noop);
  return {
    change,
    outcome: options.outcome,
    transitions: result.transitions,
    changed,
  };
}
