import { suggestProvenance, applyProvenance } from '../operations/provenance.mjs';

export function handleSuggestProvenance(changeSlug, taskId) {
  const result = suggestProvenance(changeSlug, taskId);
  console.log(JSON.stringify(result, null, 2));
}

export function handleApplyProvenance(changeSlug, taskIdOrList, options = {}) {
  const result = applyProvenance(changeSlug, taskIdOrList, options);
  console.log(`Implementation provenance written for: ${result.summary}.`);
}
