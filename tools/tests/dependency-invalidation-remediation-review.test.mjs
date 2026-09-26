import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  createRemediationRecord,
  loadRemediationGroup,
} from '../specs/workflow/remediation-record.mjs';
import { projectSuspensions } from '../specs/workflow/suspension-projection.mjs';
import {
  runRemediationReview,
  computeRemediationReviewVerdict,
  selectRemediationReviewPairs,
  reviewGroupMembers,
  inspectCrossTaskConsistency,
  EVALUATION_ORDER,
} from '../specs/workflow/remediation-review/index.mjs';

function createTempRepo() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nevo-remediation-review-test-'));
  fs.mkdirSync(path.join(tmpDir, '.nevo-ai-local'), { recursive: true });
  return tmpDir;
}

test('AC 1: A remediation group {t1, t3} where t1 fix invalidates assumption in t2 flags t2 and adds via addDiscoveredMember (D31, D36)', async () => {
  const tmpRepo = createTempRepo();
  try {
    const changeSlug = 'test-change';
    const group = createRemediationRecord({
      repoRoot: tmpRepo,
      change: changeSlug,
      invalidatedDependency: {
        taskId: 't1',
        releaseEpoch: { step: 'implementation', attempt: 1 },
      },
      members: [
        { taskId: 't1', role: 'releasing-task', terminal: false },
        { taskId: 't3', role: 'consumer', terminal: false },
      ],
    });

    const tasks = [
      {
        id: 't1',
        status: 'implemented',
        allowed_paths: ['src/core.mjs'],
        depends_on: [],
        semantic_references: { decisions: ['D10'] },
      },
      {
        id: 't2',
        status: 'in-implementation',
        allowed_paths: ['src/consumer.mjs'],
        depends_on: ['t1'],
        semantic_references: { decisions: ['D10'] },
      },
      {
        id: 't3',
        status: 'implemented',
        allowed_paths: ['src/t3.mjs'],
        depends_on: ['t1'],
        semantic_references: { decisions: [] },
      },
    ];

    // Cross-task inspector finds that t1's change broke an assumption in t2
    const crossTaskInspector = async ({ taskA, taskB, rootTaskId }) => {
      if ((taskA.id === 't1' && taskB.id === 't2') || (taskA.id === 't2' && taskB.id === 't1')) {
        return {
          flaggedTaskId: 't2',
          citingTaskId: 't1',
          citedChange: 't1 signature changed to require options object',
          reason: 't2 implementation calls t1 with positional argument, incompatible with t1 fix',
        };
      }
      return null;
    };

    const reviewRes = await runRemediationReview({
      repoRoot: tmpRepo,
      changeSlug,
      remediationId: group.remediationId,
      tasks,
      crossTaskInspector,
    });

    // t2 was flagged
    assert.equal(reviewRes.crossTaskFindings.length, 1);
    const finding = reviewRes.crossTaskFindings[0];
    assert.equal(finding.taskId, 't2');
    assert.equal(finding.citingTaskId, 't1');
    assert.equal(finding.citedChange, 't1 signature changed to require options object');
    assert.equal(finding.severity, 'changes-required');

    // t2 was added to durable record via addDiscoveredMember
    assert.ok(reviewRes.discoveredMembers.includes('t2'));
    const reloaded = loadRemediationGroup(tmpRepo, changeSlug, group.remediationId);
    assert.ok(reloaded.discoveredMembers.includes('t2'));

    // Because t2 needs changes, aggregate verdict is changes-required and suspensions NOT cleared
    assert.equal(reviewRes.aggregateVerdict, 'changes-required');
    assert.equal(reviewRes.suspensionsCleared, false);
  } finally {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 2: A remediation group including an already-verified member produces owner-decision-required without reopening/re-executing (D31)', async () => {
  const tmpRepo = createTempRepo();
  try {
    const changeSlug = 'test-change';
    const group = createRemediationRecord({
      repoRoot: tmpRepo,
      change: changeSlug,
      invalidatedDependency: {
        taskId: 't1',
        releaseEpoch: { step: 'implementation', attempt: 1 },
      },
      members: [
        { taskId: 't1', role: 'releasing-task', terminal: false },
        { taskId: 't-verified', role: 'consumer', terminal: true },
      ],
    });

    let verifiedTaskReviewAttempted = false;

    const tasks = [
      {
        id: 't1',
        status: 'implemented',
        depends_on: [],
        semantic_references: { decisions: ['D20'] },
      },
      {
        id: 't-verified',
        status: 'verified',
        depends_on: ['t1'],
        semantic_references: { decisions: ['D20'] },
      },
    ];

    const taskReviewer = async (task) => {
      if (task.id === 't-verified') {
        verifiedTaskReviewAttempted = true;
      }
      return { verdict: 'pass' };
    };

    const crossTaskInspector = async ({ taskA, taskB }) => {
      if ((taskA.id === 't1' && taskB.id === 't-verified') || (taskA.id === 't-verified' && taskB.id === 't1')) {
        return {
          flaggedTaskId: 't-verified',
          citingTaskId: 't1',
          citedChange: 't1 removed deprecated method foo()',
          reason: 't-verified artifact relied on foo() which was removed',
        };
      }
      return null;
    };

    const reviewRes = await runRemediationReview({
      repoRoot: tmpRepo,
      changeSlug,
      remediationId: group.remediationId,
      tasks,
      taskReviewer,
      crossTaskInspector,
    });

    // Verified member was NOT re-executed in per-task review
    assert.equal(verifiedTaskReviewAttempted, false, 'Terminal task must never have per-task review executed');

    // Finding for terminal member is owner-decision-required / NEEDS_CLARIFICATION
    assert.equal(reviewRes.crossTaskFindings.length, 1);
    const finding = reviewRes.crossTaskFindings[0];
    assert.equal(finding.taskId, 't-verified');
    assert.equal(finding.severity, 'owner-decision-required');
    assert.equal(finding.category, 'NEEDS_CLARIFICATION');
    assert.equal(finding.terminal, true);

    // Aggregate verdict is owner-decision-required
    assert.equal(reviewRes.aggregateVerdict, 'owner-decision-required');
    assert.equal(reviewRes.suspensionsCleared, false);
  } finally {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 3: Genuinely consistent remediation group produces zero cross-task findings, pass verdict, and clears suspensions (D31, D37)', async () => {
  const tmpRepo = createTempRepo();
  try {
    const changeSlug = 'test-change';
    const group = createRemediationRecord({
      repoRoot: tmpRepo,
      change: changeSlug,
      invalidatedDependency: {
        taskId: 't1',
        releaseEpoch: { step: 'implementation', attempt: 1 },
      },
      members: [
        { taskId: 't1', role: 'releasing-task', terminal: false },
        { taskId: 't3', role: 'consumer', terminal: false },
      ],
    });

    const tasks = [
      {
        id: 't1',
        status: 'implemented',
        allowed_paths: ['src/t1.mjs'],
        depends_on: [],
      },
      {
        id: 't3',
        status: 'implemented',
        allowed_paths: ['src/t3.mjs'],
        depends_on: ['t1'],
      },
    ];

    const change = { id: changeSlug, tasks };

    // Initially, both tasks have suspensions projected
    const susp1Before = projectSuspensions(tasks[0], change, { repoRoot: tmpRepo });
    const susp3Before = projectSuspensions(tasks[1], change, { repoRoot: tmpRepo });
    assert.equal(susp1Before.length, 1);
    assert.equal(susp3Before.length, 1);

    // Cross-task inspector finds everything consistent
    const crossTaskInspector = async () => null;

    const reviewRes = await runRemediationReview({
      repoRoot: tmpRepo,
      changeSlug,
      remediationId: group.remediationId,
      tasks,
      taskReviewer: async () => ({ verdict: 'pass' }),
      crossTaskInspector,
    });

    assert.equal(reviewRes.crossTaskFindings.length, 0);
    assert.equal(reviewRes.aggregateVerdict, 'pass');
    assert.equal(reviewRes.suspensionsCleared, true);

    // After review pass, suspensions are cleared
    const susp1After = projectSuspensions(tasks[0], change, { repoRoot: tmpRepo });
    const susp3After = projectSuspensions(tasks[1], change, { repoRoot: tmpRepo });
    assert.equal(susp1After.length, 0);
    assert.equal(susp3After.length, 0);
  } finally {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 4: Remediation group with any unresolved per-task or cross-task blocking finding clears no member suspensions (D31)', async () => {
  const tmpRepo = createTempRepo();
  try {
    const changeSlug = 'test-change';
    const group = createRemediationRecord({
      repoRoot: tmpRepo,
      change: changeSlug,
      invalidatedDependency: {
        taskId: 't1',
        releaseEpoch: { step: 'implementation', attempt: 1 },
      },
      members: [
        { taskId: 't1', role: 'releasing-task', terminal: false },
        { taskId: 't3', role: 'consumer', terminal: false },
      ],
    });

    const tasks = [
      { id: 't1', status: 'implemented', depends_on: [] },
      { id: 't3', status: 'implemented', depends_on: ['t1'] },
    ];
    const change = { id: changeSlug, tasks };

    // Case A: per-task review failed for t1
    const reviewResA = await runRemediationReview({
      repoRoot: tmpRepo,
      changeSlug,
      remediationId: group.remediationId,
      tasks,
      taskReviewer: async (task) => {
        if (task.id === 't1') return { verdict: 'changes-required', findings: [{ reason: 'Tests failing' }] };
        return { verdict: 'pass' };
      },
      crossTaskInspector: async () => null,
    });

    assert.equal(reviewResA.aggregateVerdict, 'changes-required');
    assert.equal(reviewResA.suspensionsCleared, false);
    // Suspensions still projected
    assert.equal(projectSuspensions(tasks[0], change, { repoRoot: tmpRepo }).length, 1);
    assert.equal(projectSuspensions(tasks[1], change, { repoRoot: tmpRepo }).length, 1);

    // Case B: per-task passed but cross-task finding is blocked
    const reviewResB = await runRemediationReview({
      repoRoot: tmpRepo,
      changeSlug,
      remediationId: group.remediationId,
      tasks,
      taskReviewer: async () => ({ verdict: 'pass' }),
      crossTaskInspector: async () => ({
        flaggedTaskId: 't3',
        citingTaskId: 't1',
        reason: 'Circular dependency incompatibility',
        severity: 'blocked',
      }),
    });

    assert.equal(reviewResB.aggregateVerdict, 'blocked');
    assert.equal(reviewResB.suspensionsCleared, false);
    assert.equal(projectSuspensions(tasks[0], change, { repoRoot: tmpRepo }).length, 1);
    assert.equal(projectSuspensions(tasks[1], change, { repoRoot: tmpRepo }).length, 1);
  } finally {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 5: Aggregate verdict matches worst individual finding severity in every tested combination (D31)', () => {
  // Test evaluation order: blocked > owner-decision-required > changes-required > pass
  assert.deepEqual(EVALUATION_ORDER, ['blocked', 'owner-decision-required', 'changes-required', 'pass']);

  // All pass -> pass
  assert.equal(
    computeRemediationReviewVerdict({ taskVerdicts: ['pass', 'pass'], findings: [] }),
    'pass'
  );

  // One changes-required -> changes-required
  assert.equal(
    computeRemediationReviewVerdict({ taskVerdicts: ['pass', 'changes-required'], findings: [] }),
    'changes-required'
  );

  // One finding with changes-required -> changes-required
  assert.equal(
    computeRemediationReviewVerdict({
      taskVerdicts: ['pass', 'pass'],
      findings: [{ severity: 'changes-required' }],
    }),
    'changes-required'
  );

  // owner-decision overrides changes-required
  assert.equal(
    computeRemediationReviewVerdict({
      taskVerdicts: ['changes-required', 'pass'],
      ownerDecisionFindings: 1,
    }),
    'owner-decision-required'
  );

  assert.equal(
    computeRemediationReviewVerdict({
      taskVerdicts: ['pass'],
      findings: [
        { severity: 'changes-required' },
        { severity: 'owner-decision-required' },
      ],
    }),
    'owner-decision-required'
  );

  // blocked overrides owner-decision-required and changes-required
  assert.equal(
    computeRemediationReviewVerdict({
      taskVerdicts: ['blocked', 'changes-required'],
      ownerDecisionFindings: 2,
    }),
    'blocked'
  );

  assert.equal(
    computeRemediationReviewVerdict({
      validationFailed: true,
      taskVerdicts: ['pass'],
      ownerDecisionFindings: 1,
    }),
    'blocked'
  );

  assert.equal(
    computeRemediationReviewVerdict({
      taskVerdicts: ['pass'],
      findings: [
        { severity: 'blocked' },
        { severity: 'owner-decision-required' },
        { severity: 'changes-required' },
      ],
    }),
    'blocked'
  );
});

test('Pair selection: selects pairs by dependency contract, shared file, and shared semantic decisions', () => {
  const tasks = [
    {
      id: 't1',
      allowed_paths: ['src/common.mjs', 'src/t1.mjs'],
      depends_on: [],
      semantic_references: { decisions: ['D1', 'D2'] },
    },
    {
      id: 't2',
      allowed_paths: ['src/t2.mjs'],
      depends_on: ['t1'],
      semantic_references: { decisions: ['D3'] },
    },
    {
      id: 't3',
      allowed_paths: ['src/common.mjs', 'src/t3.mjs'],
      depends_on: [],
      semantic_references: { decisions: ['D4'] },
    },
    {
      id: 't4',
      allowed_paths: ['src/t4.mjs'],
      depends_on: [],
      semantic_references: { decisions: ['D2'] },
    },
    {
      id: 't-isolated',
      allowed_paths: ['src/unrelated.mjs'],
      depends_on: [],
      semantic_references: { decisions: ['D99'] },
    },
  ];

  const pairs = selectRemediationReviewPairs({ tasks, rootTaskId: 't1' });

  // t1-t2: dependency contract
  assert.ok(pairs.some(p => (p.taskA.id === 't1' && p.taskB.id === 't2') || (p.taskA.id === 't2' && p.taskB.id === 't1')));

  // t1-t3: shared file (src/common.mjs)
  assert.ok(pairs.some(p => (p.taskA.id === 't1' && p.taskB.id === 't3') || (p.taskA.id === 't3' && p.taskB.id === 't1')));

  // t1-t4: shared decision (D2)
  assert.ok(pairs.some(p => (p.taskA.id === 't1' && p.taskB.id === 't4') || (p.taskA.id === 't4' && p.taskB.id === 't1')));

  // t-isolated has no relationships with t1
  assert.ok(!pairs.some(p => (p.taskA.id === 't1' && p.taskB.id === 't-isolated') || (p.taskA.id === 't-isolated' && p.taskB.id === 't1')));
});
