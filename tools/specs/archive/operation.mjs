import { join } from 'node:path';

import { requireChange, ACTIVE_DIR } from '../store.mjs';
import { archiveSpecificationSync } from '../finalize/operation.mjs';

/**
 * Application operation: move an active change to specs/archive/.
 * Reuses the same archival routine finalize uses, so a standalone `archive`
 * and finalize's own archive step never diverge in behavior.
 */
export function archiveChange(changeSlug) {
  requireChange(changeSlug);
  const changeDir = join(ACTIVE_DIR, changeSlug);
  archiveSpecificationSync(changeSlug, changeDir);
  return { changeSlug };
}
