import { requireChange, writeBulkTransition } from '../store.mjs';
import { resolveReviewScope, validateBulkTransition } from '../lifecycle/reviews.mjs';
import { CliError } from '../../lib/cli-errors.mjs';

export function handleReviewScope(changeSlug, options = {}) {
  const change = requireChange(changeSlug);
  const result = resolveReviewScope(change, { all: Boolean(options.all), tasks: options.tasks });
  if (!result.ok) throw new CliError(result.reason);
  console.log(JSON.stringify({ change: changeSlug, orderedTasks: result.orderedTasks }, null, 2));
}

export function handleBulkTransition(changeSlug, options = {}) {
  const change = requireChange(changeSlug);
  if (!options.tasks) throw new CliError('bulk-transition requires --tasks <id,id,...>.');
  if (!options.outcome) throw new CliError('bulk-transition requires --outcome <self-verified|verified>.');

  const taskIds = options.tasks.split(',').map(s => s.trim()).filter(Boolean);
  const unknown = taskIds.filter(id => !change.tasks.some(t => t.id === id));
  if (unknown.length) throw new CliError(`Unknown task id(s): ${unknown.join(', ')}`);

  const result = validateBulkTransition(change, taskIds, options.outcome);
  if (!result.ok) throw new CliError(result.reason);

  writeBulkTransition(change, result.transitions);

  const changed = result.transitions.filter(t => !t.noop);
  if (!changed.length) {
    console.log('No task needed a status change (every selected task was already at or past the target).');
    return;
  }
  console.log(`Bulk transition applied (outcome: ${options.outcome}):`);
  for (const t of changed) console.log(`  '${t.id}': ${t.from} -> ${t.to}`);
}
