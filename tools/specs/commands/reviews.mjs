import { getReviewScope, applyBulkTransition } from '../operations/reviews.mjs';

export function handleReviewScope(changeSlug, options = {}) {
  const result = getReviewScope(changeSlug, options);
  console.log(JSON.stringify(result, null, 2));
}

export function handleBulkTransition(changeSlug, options = {}) {
  const result = applyBulkTransition(changeSlug, options);
  if (!result.changed.length) {
    console.log('No task needed a status change (every selected task was already at or past the target).');
    return;
  }
  console.log(`Bulk transition applied (outcome: ${result.outcome}):`);
  for (const t of result.changed) {
    console.log(`  '${t.id}': ${t.from} -> ${t.to}`);
  }
}
