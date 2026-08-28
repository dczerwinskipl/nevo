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
 */
export function createSpecsCapability({ operationRuntime, actionExecutor, activeDir, root } = {}) {
  const actionsCapability = createSpecActionsCapability({ operationRuntime, actionExecutor, activeDir, root });

  return {
    getDashboardData: () => loadDashboardData(),
    createSpecification: (input) => createSpecification(input),
    getManifest: ({ source, slug }) => loadSpecificationManifest({ source, slug }),
    getDocument: ({ source, slug, docId }) => loadSpecificationDocument({ source, slug, docId }),
    getTaskStatuses: ({ source, slug }) => loadTaskStatuses({ source, slug }),
    loadActions: (slug) => actionsCapability.loadActions(slug),
    startAction: (input) => actionsCapability.startAction(input),
    shutdown: () => actionsCapability.shutdown(),
  };
}
