import {
  loadDashboardData,
  loadSpecificationManifest,
  loadSpecificationDocument,
  loadTaskStatuses,
} from './data.mjs';
import { createSpecActionsCapability } from './actions.mjs';
import { createSpecification } from '../../../specs/identity.mjs';

/**
 * The specs capability: everything the dashboard's specification routes
 * need, behind one coherent API. Routes call these methods; they never
 * import `data.mjs`, `actions.mjs`, or `specs/identity.mjs` directly, so the
 * HTTP layer has no idea these are backed by the filesystem/store at all.
 *
 * `paths` (see paths.mjs's `resolveSpecsPaths`) is bound once, here, into
 * `dataContext` — every read operation uses that exact same context, so a
 * capability configured with custom directories can't silently read from
 * the real repository's specs/ tree for some operations while using the
 * configured one for others. `dataContext` is always spread *after* a
 * caller's own input in every call below, so caller-supplied fields (e.g.
 * a request body) can never shadow the capability-bound filesystem
 * context.
 */
export function createSpecsCapability({
  operationRuntime,
  actionExecutor,
  root,
  activeDir,
  archiveDir,
  activeIndexMd,
  archiveIndexMd,
  indexJson,
} = {}) {
  const dataContext = { activeDir, archiveDir, repoRoot: root };
  const actionsCapability = createSpecActionsCapability({ operationRuntime, actionExecutor, activeDir, root });

  return {
    getDashboardData: () => loadDashboardData(dataContext),
    createSpecification: (input) => createSpecification({
      ...input,
      activeDir,
      archiveDir,
      activeIndexMd,
      archiveIndexMd,
      indexJson,
    }),
    getManifest: ({ source, slug }) => loadSpecificationManifest({ source, slug, ...dataContext }),
    getDocument: ({ source, slug, docId }) => loadSpecificationDocument({ source, slug, docId, ...dataContext }),
    getTaskStatuses: ({ source, slug }) => loadTaskStatuses({ source, slug, ...dataContext }),
    loadActions: (slug) => actionsCapability.loadActions(slug),
    startAction: (input) => actionsCapability.startAction(input),
    shutdown: () => actionsCapability.shutdown(),
  };
}
