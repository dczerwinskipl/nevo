import { backfillSpecIds } from '../identity.mjs';
import { buildSpecsIndexes, writeSpecsIndexes } from '../indexes.mjs';

/**
 * Application operation: idempotently assign a fresh canonical UUID spec_id
 * to any manifest missing one (D2), rebuilding generated indexes only when
 * at least one manifest was actually changed.
 */
export function backfillSpecIdsCommand() {
  const assigned = backfillSpecIds();
  if (assigned.length) {
    const built = buildSpecsIndexes();
    writeSpecsIndexes(built);
  }
  return { assigned };
}
