import { completeTask } from './operation.mjs';

export function handleComplete(changeSlug, taskId, options = {}) {
  const result = completeTask(changeSlug, taskId, options);
  if (result.alreadyImplemented) {
    console.log(`Task '${taskId}' is already implemented.`);
    return;
  }
  console.log(`Task '${taskId}' marked as implemented. Present results to owner for verification.`);
}
