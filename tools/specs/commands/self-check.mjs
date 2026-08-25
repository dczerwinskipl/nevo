import { createHash } from 'node:crypto';
import { join } from 'node:path';

import {
  requireChange,
  requireTask,
  writeSelfCheck,
  writeImplementationProvenance,
  ACTIVE_DIR,
  ROOT,
} from '../store.mjs';
import {
  loadTaskFileParts,
  parseVerificationCommands,
  computeTaskFingerprint,
} from '../fingerprint.mjs';
import { buildContextPacket } from '../context.mjs';
import { buildSelfCheckResult } from '../lifecycle/batch.mjs';
import {
  computeTaskAttributedChangedPaths,
  detectProvenanceOverlap,
} from '../lifecycle/provenance.mjs';
import {
  buildSpecsIndexes,
  writeSpecsIndexes,
} from '../indexes.mjs';
import { runVerificationCommand } from './verify.mjs';
import { createProgressEmitter } from '../../lib/operation-progress.mjs';
import * as git from '../../lib/git.mjs';
import { CliError } from '../../lib/cli-errors.mjs';

export function handleSelfCheck(changeSlug, taskId, { activeDir = ACTIVE_DIR, gitRoot = ROOT } = {}) {
  const change = requireChange(changeSlug, activeDir);
  const task = requireTask(change, taskId);
  const { body } = loadTaskFileParts(change, task);
  const commands = parseVerificationCommands(body);
  if (!commands.length) throw new CliError(`Task '${taskId}' has no "## Verification" commands to run.`);

  const emitter = createProgressEmitter();
  emitter.operationStarted({
    type: 'task-verification',
    totalSteps: commands.length,
    steps: commands.map((cmd, idx) => ({ id: `cmd-${idx + 1}`, label: cmd })),
  });

  const commandResults = [];
  for (let idx = 0; idx < commands.length; idx++) {
    const cmd = commands[idx];
    const stepId = `cmd-${idx + 1}`;
    emitter.stepStarted({ id: stepId, label: cmd, total: commands.length });
    const result = runVerificationCommand(cmd);
    commandResults.push(result);
    if (result.exit_code === 0) {
      emitter.stepCompleted({ id: stepId, detail: 'Passed' });
    } else {
      emitter.stepFailed({ id: stepId, error: { message: `Exit code ${result.exit_code}`, code: String(result.exit_code) } });
    }
  }

  const currentRevision = git.getCurrentRevision(gitRoot);
  const selfCheck = buildSelfCheckResult({
    commandResults,
    fingerprint: computeTaskFingerprint(change, taskId),
    revision: currentRevision,
  });
  writeSelfCheck(change, taskId, selfCheck);

  if (task.implementation?.baseline_revision) {
    const packet = buildContextPacket(change, task);
    const changedSinceBaseline = git.getChangedFiles(gitRoot, task.implementation.baseline_revision);
    const attributedPaths = computeTaskAttributedChangedPaths(changedSinceBaseline, packet.allowed_paths);
    const worktreeDiff = git.getWorktreeDiff(gitRoot, attributedPaths);
    writeImplementationProvenance(change, taskId, {
      baseline_revision: task.implementation.baseline_revision,
      review_revision: currentRevision,
      changed_paths: attributedPaths,
      worktree_patch_fingerprint: worktreeDiff ? createHash('sha256').update(worktreeDiff).digest('hex') : null,
    });

    const overlaps = detectProvenanceOverlap(change.tasks, taskId, attributedPaths);
    for (const overlap of overlaps) {
      console.log(`Note: '${taskId}' and '${overlap.taskId}' both attribute changed_paths: ${overlap.paths.join(', ')} — verify this overlap is expected before trusting either task's evidence in isolation.`);
    }
  }

  const built = buildSpecsIndexes({ activeDir });
  writeSpecsIndexes(built, {
    activeIndexMd: join(gitRoot, 'specs', 'active.generated.md'),
    archiveIndexMd: join(gitRoot, 'specs', 'archive.generated.md'),
    indexJson: join(gitRoot, 'specs', 'index.generated.json'),
  });

  if (selfCheck.status === 'failed') {
    emitter.operationFailed({ error: { message: `Self-check FAILED: ${selfCheck.failed_criteria.join(', ')}` }, summary: 'Self-check failed' });
    console.log(`Self-check FAILED for '${taskId}': ${selfCheck.failed_criteria.join(', ')}`);
    process.exitCode = 1;
  } else {
    emitter.operationCompleted({ result: selfCheck, summary: `Self-check passed for '${taskId}'.` });
    console.log(`Self-check passed for '${taskId}'.`);
  }
}
