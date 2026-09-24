// Shared, generic reconciler for dead request-backed workspace claims (D79, D88, D92, D95).
// Two-phase, lock-safe, kind-agnostic dispatch to registered per-kind settlement checkers.

import { loadWorkspaceRequest, transitionWorkspaceRequest } from './workspace-request.mjs';
import { releaseWorkspaceWriterIfOwned, markWorkspaceWriterRecoveryRequiredIfOwned } from './workspace-writer.mjs';

const reconcilerRegistry = new Map();

/**
 * Registers an operation-state checker for a request-backed kind (D88).
 *
 * @param {'human-submit'|'publish'|'batch-publish'} kind
 * @param {Function} checkOperationStateFn - ({ repoRoot, operationRef }) => Promise<{ settled: boolean, terminalStatus?: 'completed'|'failed', reason?: string }>
 */
export function registerRequestKindReconciler(kind, checkOperationStateFn) {
  if (typeof checkOperationStateFn !== 'function') {
    throw new TypeError(`Checker for kind '${kind}' must be a function`);
  }
  reconcilerRegistry.set(kind, checkOperationStateFn);
}

/**
 * Reconciles a dead request-backed workspace-writer claim (D79, D88, D92, D95).
 * Called in Phase B (outside the workspace-control lock).
 *
 * @param {object} params
 * @param {string} params.repoRoot
 * @param {object} params.claimSnapshot - Snapshot taken in Phase A
 * @returns {Promise<{ reconciled: boolean, outcome?: string, reason?: string }>}
 */
export async function reconcileRequestBackedWorkspaceClaim({ repoRoot, claimSnapshot }) {
  if (!repoRoot || !claimSnapshot?.requestId) {
    return { reconciled: false, reason: 'missing-snapshot-or-repo' };
  }

  // 1. Load workspace request
  const request = loadWorkspaceRequest(repoRoot, claimSnapshot.requestId);
  if (!request) {
    return { reconciled: false, reason: 'request-not-found' };
  }

  // 2. Verify identity
  if (request.requestId !== claimSnapshot.requestId) {
    return { reconciled: false, reason: 'request-id-mismatch' };
  }

  // 3. Lookup registered checker for kind
  const checker = reconcilerRegistry.get(claimSnapshot.kind);
  if (!checker) {
    return { reconciled: false, reason: 'unregistered-kind' };
  }

  // 4. Run checker (outside lock)
  let checkResult;
  try {
    checkResult = await checker({ repoRoot, operationRef: claimSnapshot.operationRef });
  } catch (err) {
    checkResult = { settled: false, reason: `Checker threw error: ${err.message}` };
  }

  const expectedStatus = ['queued', 'waiting-for-workspace', 'running'];

  // 5. Settled completed
  if (checkResult.settled && checkResult.terminalStatus === 'completed') {
    await transitionWorkspaceRequest({
      repoRoot,
      requestId: claimSnapshot.requestId,
      expectedStatus,
      to: 'completed',
    });
    await releaseWorkspaceWriterIfOwned({
      repoRoot,
      expectedOwnerId: claimSnapshot.ownerId,
      expectedRequestId: claimSnapshot.requestId,
    });
    return { reconciled: true, outcome: 'completed' };
  }

  // 6. Settled failed
  if (checkResult.settled && checkResult.terminalStatus === 'failed') {
    await transitionWorkspaceRequest({
      repoRoot,
      requestId: claimSnapshot.requestId,
      expectedStatus,
      to: 'failed',
    });
    await releaseWorkspaceWriterIfOwned({
      repoRoot,
      expectedOwnerId: claimSnapshot.ownerId,
      expectedRequestId: claimSnapshot.requestId,
    });
    return { reconciled: true, outcome: 'failed' };
  }

  // 7. Unsettled / ambiguous -> mark reconciliation-required and recovery-required
  await transitionWorkspaceRequest({
    repoRoot,
    requestId: claimSnapshot.requestId,
    expectedStatus,
    to: 'reconciliation-required',
  });
  await markWorkspaceWriterRecoveryRequiredIfOwned({
    repoRoot,
    expectedOwnerId: claimSnapshot.ownerId,
    expectedRequestId: claimSnapshot.requestId,
  });

  return {
    reconciled: false,
    outcome: 'reconciliation-required',
    reason: checkResult.reason || 'unsettled-operation',
  };
}
