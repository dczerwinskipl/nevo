// Deterministic workflow mutations (Task 17, D1, D4).
// Handles deterministic human-decision operations.
// Never calls into legacy mutation operations.

import { handleWorkflowVerifyHuman } from '../../../../specs/workflow/cli.mjs';
import { resolveWorkflowMode } from '../../../../specs/workflow/compatibility.mjs';
import { ACTIVE_DIR } from '../../../../specs/store.mjs';
import { REPOSITORY_ROOT } from '../../infrastructure/paths.mjs';
import { SpecificationActionError } from '../actions.mjs';

/**
 * Executes a deterministic human decision (approve, request-changes).
 */
export async function executeDeterministicHumanDecision({
  change,
  slug,
  taskId,
  decision,
  feedback,
  activeDir = ACTIVE_DIR,
  root = REPOSITORY_ROOT,
} = {}) {
  const workflowMode = resolveWorkflowMode(change, { activeDir, repoRoot: root });
  if (workflowMode.mode === 'legacy') {
    throw new SpecificationActionError(
      `Cannot run deterministic human decision against legacy specification '${slug || change?.id}'. ` +
      `Use legacy command surface instead: approve, start, complete, verify.`,
      400,
    );
  }

  if (decision !== 'approve' && decision !== 'request-changes') {
    throw new SpecificationActionError("Decision must be 'approve' or 'request-changes'.", 400);
  }
  if (decision === 'request-changes' && (!feedback || typeof feedback !== 'string' || feedback.trim() === '')) {
    throw new SpecificationActionError('Feedback is required when requesting changes.', 400);
  }

  const opts = {
    approve: decision === 'approve',
    requestChanges: decision === 'request-changes',
    feedback: feedback ? feedback.trim() : undefined,
    activeDir,
    repoRoot: root,
    silent: true,
  };

  try {
    const result = await handleWorkflowVerifyHuman(slug, taskId, opts);
    return {
      ok: true,
      decision,
      taskId,
      result,
    };
  } catch (err) {
    if (err instanceof SpecificationActionError) throw err;
    const status = err.status || (err.message && err.message.includes('not found') ? 404 : 400);
    throw new SpecificationActionError(err.message, status);
  }
}
