import { backfillSpecIdsCommand } from './operation.mjs';

export function handleBackfillSpecId() {
  const { assigned } = backfillSpecIdsCommand();
  if (!assigned.length) {
    console.log('All active and archived specifications already have a valid spec_id.');
    return;
  }
  console.log(`Assigned spec_id to ${assigned.length} specification(s):`);
  for (const entry of assigned) {
    console.log(`  - ${entry.slug}: ${entry.specId}`);
  }
  console.log('Rebuilt generated indexes.');
}
