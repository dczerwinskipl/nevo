import { requireChangeAnywhere, ROOT } from '../store.mjs';
import { TERMINAL_STATUSES } from '../lifecycle-primitives.mjs';
import { deriveStage } from '../lifecycle/stage.mjs';
import { computeTaskFingerprint } from '../fingerprint.mjs';
import { gatherFinalizeFacts } from './finalize.mjs';
import * as git from '../../lib/git.mjs';

export function handleStatus(changeSlug) {
  const { change, location } = requireChangeAnywhere(changeSlug);
  const branch = git.getCurrentBranch(ROOT);
  const allTerminal = change.tasks.every(t => TERMINAL_STATUSES.has(t.status));
  const facts = allTerminal ? gatherFinalizeFacts(branch, change) : { pr: null, ghAvailable: true, verification: [] };

  const inProgress = change.tasks.find(t => t.status === 'in-implementation');
  if (inProgress) {
    facts.currentTaskState = {
      fingerprint: computeTaskFingerprint(change, inProgress.id),
      revision: git.getCurrentRevision(ROOT),
    };
  }

  const result = deriveStage(change, facts);
  console.log(JSON.stringify({ change: changeSlug, branch, location, ...result }, null, 2));
}
