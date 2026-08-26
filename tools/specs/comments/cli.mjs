import { getPrReviewThreads, resolvePrReviewThread } from './operation.mjs';

// Re-export for existing test compatibility
export { requirePrForChange } from './operation.mjs';

export function handleComments(changeSlug) {
  const result = getPrReviewThreads(changeSlug);
  console.log(JSON.stringify(result, null, 2));
}

export function handleResolveComment(changeSlug, threadId, options = {}) {
  const result = resolvePrReviewThread(changeSlug, threadId, options);
  if (result.replied) {
    console.log(`Replied on thread '${threadId}'.`);
  }
  console.log(`Thread '${threadId}' resolved: ${result.isResolved}`);
}
