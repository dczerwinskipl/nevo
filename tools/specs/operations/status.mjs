import { requireChangeAnywhere, ROOT } from '../store.mjs';
import { TERMINAL_STATUSES } from '../lifecycle-primitives.mjs';
import { deriveStage } from '../lifecycle/stage.mjs';
import { computeTaskFingerprint } from '../fingerprint.mjs';
import { loadFollowUps } from '../follow-ups.mjs';
import { gatherFinalizeFactsAsync } from './finalize.mjs';
import { getCurrentBranchAsync, getCurrentRevisionAsync } from '../../lib/git.mjs';
import { isGhAvailable } from '../../lib/github.mjs';

/**
 * Single source of truth for change lifecycle status across spec → task → PR → merge chain.
 */
export async function getChangeStatusAsync(changeSlug, { gitRoot = ROOT, directories = {}, signal = null } = {}) {
  const { change, location } = requireChangeAnywhere(changeSlug, directories);
  const branch = await getCurrentBranchAsync(gitRoot, { signal });
  const allTerminal = change.tasks.every(t => TERMINAL_STATUSES.has(t.status));

  const facts = allTerminal
    ? await gatherFinalizeFactsAsync(branch, change, null, gitRoot, { signal })
    : {
        gitClean: true,
        branch: null,
        pr: null,
        ghAvailable: isGhAvailable(),
        verification: [],
        openBlockingFollowUps: (loadFollowUps(change).follow_ups || [])
          .filter(f => f.status === 'open' && f.severity === 'blocking')
          .map(f => ({ id: f.id, reason: f.reason })),
      };

  const inProgress = change.tasks.find(t => t.status === 'in-implementation');
  if (inProgress) {
    facts.currentTaskState = {
      fingerprint: computeTaskFingerprint(change, inProgress.id),
      revision: await getCurrentRevisionAsync(gitRoot, { signal }),
    };
  }

  const stage = deriveStage(change, facts);
  return { change: changeSlug, branch, location, facts, stage };
}
