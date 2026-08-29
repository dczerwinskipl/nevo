import {
  ACTIVE_DIR,
  ARCHIVE_DIR,
  ACTIVE_INDEX_MD,
  ARCHIVE_INDEX_MD,
  INDEX_JSON,
} from '../../../specs/store.mjs';
import { REPOSITORY_ROOT } from '../infrastructure/paths.mjs';

/**
 * Resolves the Specs vertical slice's filesystem configuration exactly
 * once, at its own outer boundary (specs/routes.mjs). Every Specs
 * operation that touches storage — dashboard/manifest/document/task-status
 * reads, spec creation and its indexes, actions, and the change watcher —
 * derives its paths from this same resolved, immutable object, so one
 * configured Specs capability cannot end up operating on different
 * physical directories depending on which operation is called.
 *
 * The global `ACTIVE_DIR`/`ARCHIVE_DIR`/index constants are used only as
 * defaults, here, once — nothing deeper in the Specs slice re-reads them.
 */
export function resolveSpecsPaths({
  root,
  activeDir,
  archiveDir,
  activeIndexMd,
  archiveIndexMd,
  indexJson,
} = {}) {
  return Object.freeze({
    root: root ?? REPOSITORY_ROOT,
    activeDir: activeDir ?? ACTIVE_DIR,
    archiveDir: archiveDir ?? ARCHIVE_DIR,
    activeIndexMd: activeIndexMd ?? ACTIVE_INDEX_MD,
    archiveIndexMd: archiveIndexMd ?? ARCHIVE_INDEX_MD,
    indexJson: indexJson ?? INDEX_JSON,
  });
}
