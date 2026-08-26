import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  finalizeChange,
  gatherFinalizeFactsAsync,
} from '../specs/finalize/operation.mjs';
import { getChangeStatusAsync } from '../specs/status/operation.mjs';
import { startTask } from '../specs/start/operation.mjs';
import { executeSelfCheck } from '../specs/self-check/operation.mjs';
import { getReviewScope, applyBulkTransition } from '../specs/reviews/operation.mjs';
import {
  normalizePullRequestReference,
  pullRequestReferenceKey,
  addPullRequestReference,
} from '../specs/pull-requests.mjs';
import {
  setTaskSuspension,
  clearTaskSuspension,
  guardAgainstUnsafeManual,
} from '../specs/lifecycle/recovery.mjs';
import {
  loadBatchIntent,
  writeBatchIntent,
  clearBatchIntent,
} from '../specs/lifecycle/batch.mjs';
import {
  writeImplementationProvenance,
  writeSelfCheck,
} from '../specs/lifecycle/provenance.mjs';
import { loadReview } from '../specs/lifecycle/reviews.mjs';
import { loadChange, requireChange } from '../specs/store.mjs';
import { validateFinalize } from '../specs/lifecycle/stage.mjs';

function createChangeFixture({ status = 'verified', followUps = [] } = {}) {
  const root = join(tmpdir(), `nevo-findings-test-${process.pid}-${Date.now()}-${Math.random()}`);
  const activeDir = join(root, 'specs', 'active');
  const changeDir = join(activeDir, 'sample-change');
  mkdirSync(join(changeDir, 'tasks'), { recursive: true });
  mkdirSync(join(changeDir, 'reviews'), { recursive: true });

  execFileSync('git', ['init', root], { encoding: 'utf8' });
  execFileSync('git', ['-C', root, 'config', 'user.name', 'test'], { encoding: 'utf8' });
  execFileSync('git', ['-C', root, 'config', 'user.email', 'test@example.com'], { encoding: 'utf8' });

  writeFileSync(join(changeDir, 'change.yaml'), [
    'id: sample-change',
    'title: Sample change',
    'status: in-implementation',
    'tasks:',
    '  - id: t1',
    '    order: 1',
    '    file: tasks/01-t1.md',
    `    status: ${status}`,
    '    implementation:',
    '      baseline_revision: 0000000000000000000000000000000000000000',
    '      review_revision: 0000000000000000000000000000000000000000',
    '      changed_paths:',
    '        - foo.txt',
  ].join('\n'));

  writeFileSync(join(changeDir, 'tasks', '01-t1.md'), [
    '---',
    'id: sample-change.t1',
    `status: ${status}`,
    'change: sample-change',
    'context:',
    '  required: []',
    '  optional: []',
    'allowed_paths:',
    '  - foo.txt',
    'forbidden_paths: []',
    '---',
    '# Task: t1',
    '## Verification',
    '```text',
    'echo ok',
    '```',
  ].join('\n'));

  if (followUps.length) {
    writeFileSync(join(changeDir, 'follow-ups.yaml'), [
      'follow_ups:',
      ...followUps.map(f => [
        `  - id: ${f.id}`,
        `    source_task: ${f.source_task || 't1'}`,
        `    kind: ${f.kind || 'MAINTAINABILITY'}`,
        `    severity: ${f.severity || 'non-blocking'}`,
        `    reason: "${f.reason || 'reason'}"`,
        `    status: ${f.status || 'open'}`,
      ].join('\n')),
    ].join('\n'));
  }

  execFileSync('git', ['-C', root, 'add', '.'], { encoding: 'utf8' });
  execFileSync('git', ['-C', root, 'commit', '-m', 'initial'], { encoding: 'utf8' });
  execFileSync('git', ['-C', root, 'checkout', '-b', 'feature/sample'], { encoding: 'utf8' });

  return {
    root,
    activeDir,
    changeDir,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test('Finding 1: finalizeChange loads real change object and explicit location', async () => {
  const fixture = createChangeFixture({ status: 'verified' });
  try {
    const report = await finalizeChange({
      changeSlug: 'sample-change',
      check: true,
      gitRoot: fixture.root,
      directories: { activeDir: fixture.activeDir, archiveDir: join(fixture.root, 'specs', 'archive') },
    });

    assert.equal(report.change, 'sample-change');
    assert.equal(report.location, 'active');
    assert.ok(report.facts, 'facts must be present');
    assert.ok(report.result, 'gate result must be present');
  } finally {
    fixture.cleanup();
  }
});

test('Finding 2: complete finalize fact model gathered and checked by gates', async () => {
  const fixture = createChangeFixture({
    status: 'verified',
    followUps: [
      { id: 'FU-1', severity: 'blocking', status: 'open', reason: 'Unresolved blocker' },
    ],
  });
  try {
    const change = requireChange('sample-change', fixture.activeDir);
    const facts = await gatherFinalizeFactsAsync('feature/sample', change, null, fixture.root);

    assert.equal(typeof facts.gitClean, 'boolean', 'gitClean must be boolean');
    assert.ok(facts.branch !== undefined, 'branch info must be present');
    assert.equal(typeof facts.ghAvailable, 'boolean', 'ghAvailable must be boolean');
    assert.ok(Array.isArray(facts.verification), 'verification must be array');
    assert.ok(Array.isArray(facts.openBlockingFollowUps), 'openBlockingFollowUps must be array');
    assert.equal(facts.openBlockingFollowUps.length, 1);
    assert.equal(facts.openBlockingFollowUps[0].id, 'FU-1');

    const gateResult = validateFinalize(change, facts);
    assert.equal(gateResult.ok, false);
    assert.match(gateResult.reason, /blocking follow-up/i);
  } finally {
    fixture.cleanup();
  }
});

test('Finding 3: status and finalize share single application fact-gathering boundary', async () => {
  const fixture = createChangeFixture({ status: 'verified' });
  try {
    const statusReport = await getChangeStatusAsync('sample-change', {
      gitRoot: fixture.root,
      directories: { activeDir: fixture.activeDir, archiveDir: join(fixture.root, 'specs', 'archive') },
    });

    assert.equal(statusReport.change, 'sample-change');
    assert.equal(statusReport.location, 'active');
    assert.ok(statusReport.facts);
    assert.ok(statusReport.stage);
    assert.equal(typeof statusReport.facts.ghAvailable, 'boolean');
    assert.ok(Array.isArray(statusReport.facts.verification));
  } finally {
    fixture.cleanup();
  }
});

test('Finding 4: application operations return structured results without console/process globals', () => {
  const fixture = createChangeFixture({ status: 'approved' });
  try {
    const startResult = startTask('sample-change', 't1', {
      activeDir: fixture.activeDir,
      gitRoot: fixture.root,
    });
    assert.equal(startResult.task.id, 't1');
    assert.equal(startResult.statusChanged, true);

    const selfCheckResult = executeSelfCheck('sample-change', 't1', {
      activeDir: fixture.activeDir,
      gitRoot: fixture.root,
      runCommand: () => ({ exit_code: 0 }),
    });
    assert.equal(selfCheckResult.passed, true);
    assert.equal(selfCheckResult.selfCheck.status, 'passed');

    const scopeResult = getReviewScope('sample-change', { all: true, activeDir: fixture.activeDir });
    assert.ok(Array.isArray(scopeResult.orderedTasks));

    const bulkResult = applyBulkTransition('sample-change', {
      tasks: 't1',
      outcome: 'self-verified',
      activeDir: fixture.activeDir,
    });
    assert.equal(bulkResult.outcome, 'self-verified');
  } finally {
    fixture.cleanup();
  }
});

test('Finding 5: capability-specific persistence extraction out of generic store.mjs', () => {
  const fixture = createChangeFixture({ status: 'in-implementation' });
  try {
    const change = requireChange('sample-change', fixture.activeDir);

    // Pull request reference capability
    const ref = { provider: 'github', repository: 'org/repo', number: 123 };
    const added = addPullRequestReference(change, ref);
    assert.equal(added.added, true);
    assert.equal(pullRequestReferenceKey(ref), 'github|https://github.com|org/repo|123');

    // Suspension management capability in recovery.mjs
    setTaskSuspension(change, 't1', { kind: 'owner-decision', code: 'D1' });
    const changeWithSuspension = loadChange('sample-change', fixture.activeDir);
    assert.equal(changeWithSuspension.tasks[0].execution?.suspension?.code, 'D1');
    assert.throws(() => guardAgainstUnsafeManual({ execution: { suspension: { kind: 'unsafe-manual', code: 'UM1' } } }, 't1', 'start'));
    clearTaskSuspension(change, 't1');

    // Batch intent capability in batch.mjs
    writeBatchIntent(change, { mode: 'currently-ready', orderedTasks: ['t1'] });
    const intent = loadBatchIntent(change);
    assert.equal(intent.mode, 'currently-ready');
    clearBatchIntent(change);
    assert.equal(loadBatchIntent(change), null);

    // Provenance & self-check capability in provenance.mjs
    writeSelfCheck(change, 't1', { status: 'passed', fingerprint: 'abc' });
    writeImplementationProvenance(change, 't1', { baseline_revision: '111', changed_paths: ['foo.txt'] });
    const reloaded = loadChange('sample-change', fixture.activeDir);
    assert.equal(reloaded.tasks[0].self_check?.status, 'passed');
    assert.equal(reloaded.tasks[0].implementation?.baseline_revision, '111');

    // Review loading in reviews.mjs
    assert.equal(loadReview(change), null);
  } finally {
    fixture.cleanup();
  }
});
