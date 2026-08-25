import { startTask } from '../operations/start.mjs';

// Re-export pure helpers for existing tests
export { startNeedsDirtyTreeCheck } from '../operations/start.mjs';

export function handleStart(changeSlug, taskId, options = {}) {
  const result = startTask(changeSlug, taskId, options);

  if (result.alreadyStarted) {
    console.log(`Task '${taskId}' is already in-implementation on branch '${result.branch}'.`);
    return;
  }

  if (result.branchAction === 'switched') {
    console.log(`Switched to branch: ${result.branch}`);
  } else if (result.branchAction === 'tracking') {
    console.log(`Checked out existing remote branch: ${result.branch} (REC-02)`);
  } else if (result.branchAction === 'created') {
    console.log(`Created branch: ${result.branch}`);
  }

  if (result.statusChanged) {
    console.log(`Task '${taskId}' set to in-implementation.`);
  }

  console.log('\nContext packet:');
  console.log(JSON.stringify(result.packet, null, 2));
}
