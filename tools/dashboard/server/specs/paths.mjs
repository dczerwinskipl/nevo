import { resolve } from 'node:path';

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
 * One coherent base determines every default: a custom `root` implies a
 * `specsDir` of `<root>/specs`, and every child path (`activeDir`,
 * `archiveDir`, the generated indexes) defaults from that same `specsDir` —
 * never independently from the real repository's own `specs/` tree. Only
 * `REPOSITORY_ROOT` is a module-level default (the top of the chain); a
 * leaf may still be overridden individually (a local test seam, or a
 * genuinely relocated single file), but overriding `root` alone is enough
 * to relocate the whole Specs capability, exactly as `resolveSpecsPaths`'s
 * own callers expect.
 */
export function resolveSpecsPaths({
  root,
  specsDir,
  activeDir,
  archiveDir,
  activeIndexMd,
  archiveIndexMd,
  indexJson,
} = {}) {
  const resolvedRoot = root ?? REPOSITORY_ROOT;
  const resolvedSpecsDir = specsDir ?? resolve(resolvedRoot, 'specs');

  return Object.freeze({
    root: resolvedRoot,
    specsDir: resolvedSpecsDir,
    activeDir: activeDir ?? resolve(resolvedSpecsDir, 'active'),
    archiveDir: archiveDir ?? resolve(resolvedSpecsDir, 'archive'),
    activeIndexMd: activeIndexMd ?? resolve(resolvedSpecsDir, 'active.generated.md'),
    archiveIndexMd: archiveIndexMd ?? resolve(resolvedSpecsDir, 'archive.generated.md'),
    indexJson: indexJson ?? resolve(resolvedSpecsDir, 'index.generated.json'),
  });
}
