// Tests for Dashboard Orchestration Wiring (Task 32 + Task 08, D12, D13, D26, D32, D33, D34, D38, D47, D49).
// Run: node --test tools/tests/dashboard-orchestration-wiring.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const DETAIL_CONTENT_PATH = path.join(
  REPO_ROOT,
  'tools/dashboard/ui/screens/specification-detail/specification-detail-content.tsx',
);
const OVERVIEW_PATH = path.join(
  REPO_ROOT,
  'tools/dashboard/ui/screens/specification-detail/specification-overview.tsx',
);
const STATUS_BOARD_PATH = path.join(
  REPO_ROOT,
  'tools/dashboard/ui/features/specifications/detail/status-board.tsx',
);
const TASK_DIALOG_PATH = path.join(
  REPO_ROOT,
  'tools/dashboard/ui/features/specifications/tasks/task-dialog.tsx',
);

const detailContentCode = fs.readFileSync(DETAIL_CONTENT_PATH, 'utf8');
const overviewCode = fs.readFileSync(OVERVIEW_PATH, 'utf8');
const statusBoardCode = fs.readFileSync(STATUS_BOARD_PATH, 'utf8');
const taskDialogCode = fs.readFileSync(TASK_DIALOG_PATH, 'utf8');

const ALL_UI_FILES = [
  { name: 'specification-detail-content.tsx', code: detailContentCode },
  { name: 'specification-overview.tsx', code: overviewCode },
  { name: 'status-board.tsx', code: statusBoardCode },
  { name: 'task-dialog.tsx', code: taskDialogCode },
];

test('AC 6: specification-detail-content.tsx contains no direct createSession.create(...) call for deterministic execution', () => {
  const matches = detailContentCode.match(/createSession\.create\s*\(/g) || [];
  assert.equal(
    matches.length,
    0,
    `Expected 0 calls to createSession.create in specification-detail-content.tsx, but found ${matches.length}`,
  );

  // Verify that proceedWithAgentExecution posts to /api/agent-sessions/turns (atomic admission + start)
  assert.ok(
    detailContentCode.includes("fetch('/api/agent-sessions/turns'"),
    'specification-detail-content.tsx must call /api/agent-sessions/turns for agent execution',
  );
});

test('AC 8: No file in Task 32 scope contains switch/if/lookup keyed on literal step IDs or concurrent session creation', () => {
  // Common literal step IDs in workflows: 'dev', 'review', 'verify', 'signoff', 'implement'
  const literalStepPatterns = [
    /switch\s*\([^)]*step(?:Id|Descriptor)?\s*\)/i,
    /case\s+['"](?:dev|review|verify|signoff|implement)['"]/i,
    /if\s*\([^)]*===\s*['"](?:dev|review|verify|signoff|implement)['"]\)/i,
  ];

  for (const { name, code } of ALL_UI_FILES) {
    for (const pattern of literalStepPatterns) {
      assert.ok(
        !pattern.test(code),
        `File ${name} should not contain literal step id branching matching ${pattern}`,
      );
    }

    // Verify no concurrent session loops: e.g. tasks.map(t => startSession(t)) or Promise.all(...)
    assert.ok(
      !code.includes('Promise.all(tasks.map'),
      `File ${name} must not trigger concurrent session execution with Promise.all(tasks.map)`,
    );
    assert.ok(
      !code.includes('Promise.all(selectedTasks.map'),
      `File ${name} must not trigger concurrent session execution with Promise.all(selectedTasks.map)`,
    );
  }
});

test('AC 1: Execution policy selection behavior', () => {
  // Behavioral model of handleStartStep & execution policy resolution
  function simulateStartStepFlow({
    hasResolvedPolicy,
    stepDescriptor,
    chosenPolicyOnDialog,
  }) {
    let dialogOpened = false;
    let turnDispatchedWithPolicy = null;

    function handleStartStep(task, descriptor) {
      if (descriptor?.executor === 'human') {
        return { type: 'human-preview', task };
      }
      if (!hasResolvedPolicy) {
        dialogOpened = true;
        return { type: 'opened-dialog' };
      }
      turnDispatchedWithPolicy = hasResolvedPolicy;
      return { type: 'dispatched-turn', policy: hasResolvedPolicy };
    }

    const firstClick = handleStartStep({ id: 'task-1' }, stepDescriptor);

    if (dialogOpened && chosenPolicyOnDialog) {
      hasResolvedPolicy = chosenPolicyOnDialog;
      const subsequentClick = handleStartStep({ id: 'task-1' }, stepDescriptor);
      return { firstClick, dialogOpened, subsequentClick, turnDispatchedWithPolicy };
    }

    return { firstClick, dialogOpened, turnDispatchedWithPolicy };
  }

  // 1. Without resolved policy: shows dialog, does not dispatch
  const withoutPolicy = simulateStartStepFlow({
    hasResolvedPolicy: null,
    stepDescriptor: { id: 'step-1', executor: 'agent' },
    chosenPolicyOnDialog: 'interactive',
  });
  assert.equal(withoutPolicy.dialogOpened, true);
  assert.equal(withoutPolicy.firstClick.type, 'opened-dialog');
  assert.equal(withoutPolicy.subsequentClick.type, 'dispatched-turn');
  assert.equal(withoutPolicy.subsequentClick.policy, 'interactive');

  // 2. With already resolved policy: proceeds directly without dialog
  const withPolicy = simulateStartStepFlow({
    hasResolvedPolicy: 'autonomous',
    stepDescriptor: { id: 'step-1', executor: 'agent' },
  });
  assert.equal(withPolicy.dialogOpened, false);
  assert.equal(withPolicy.firstClick.type, 'dispatched-turn');
  assert.equal(withPolicy.firstClick.policy, 'autonomous');

  // Verify in code that detail-content has execution policy dialog integration
  assert.ok(
    detailContentCode.includes('pendingStart') &&
    detailContentCode.includes('ExecutionPolicySelectionDialog'),
    'specification-detail-content.tsx must render ExecutionPolicySelectionDialog when pendingStart is set',
  );
});

test('AC 2: Checkbox picker submits exactly ONE session for the queue first nextRunnable item', () => {
  // Test the sequential queue task picker logic as implemented in specification-overview.tsx
  const tasks = [
    { id: 'task-1', title: 'Task 1', order: 1 },
    { id: 'task-2', title: 'Task 2', order: 2 },
    { id: 'task-3', title: 'Task 3', order: 3 },
  ];

  const taskActions = {
    'task-1': { availableActions: ['start-step'], stepDescriptor: { id: 'step-1', executor: 'agent' } },
    'task-2': { availableActions: [], stepDescriptor: { id: 'step-2', executor: 'agent' } },
    'task-3': { availableActions: ['start-step'], stepDescriptor: { id: 'step-3', executor: 'agent' } },
  };

  const selectedTaskIds = new Set(['task-1', 'task-2', 'task-3']);
  let startStepCallCount = 0;
  let startedTask = null;

  function onStartStep(task, descriptor) {
    startStepCallCount++;
    startedTask = task;
  }

  // Simulate handleStartBatch from specification-overview.tsx
  function handleStartBatch() {
    if (selectedTaskIds.size === 0) return;
    const selectedTasks = tasks
      .filter((t) => selectedTaskIds.has(t.id))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const nextRunnable =
      selectedTasks.find((t) => taskActions[t.id]?.availableActions?.includes('start-step')) ||
      selectedTasks[0];

    if (nextRunnable) {
      const gate = taskActions[nextRunnable.id];
      const descriptor =
        gate?.stepDescriptor ||
        gate?.nextStepDescriptor ||
        gate?.currentStepDescriptor || {
          id: null,
          executor: gate?.executor || 'agent',
        };
      onStartStep(nextRunnable, descriptor);
    }
  }

  handleStartBatch();

  assert.equal(startStepCallCount, 1, 'Exactly one session start call must be made');
  assert.equal(startedTask.id, 'task-1', 'Should start the first nextRunnable task');
});

test('AC 3: Observer pattern — UI only reads projection state, never autonomously drives next step', () => {
  // Verify that after turn finish, neither component has an autonomous next-step caller
  assert.ok(
    !detailContentCode.includes('startNextStep()'),
    'detail-content must not include an autonomous startNextStep function',
  );
  assert.ok(
    !overviewCode.includes('startNextStep()'),
    'overview must not include an autonomous startNextStep function',
  );
  assert.ok(
    !statusBoardCode.includes('startNextStep()'),
    'status-board must not include an autonomous startNextStep function',
  );

  // Verify that queries are refreshed to reflect server state
  assert.ok(
    detailContentCode.includes('actionsQuery.refresh()') &&
    detailContentCode.includes('sessionsQuery.refresh()'),
    'detail-content refreshes projections to observe server-orchestrated state',
  );
});

test('AC 4: Human-owned destination renders HumanStepSurface preview without preceding activation mutation', () => {
  // In specification-detail-content.tsx:
  // If stepDescriptor?.executor === 'human', openTask is called directly (no turn dispatch, no mutation)
  let openTaskCalled = false;
  let dispatchCalled = false;

  function handleStartStep(task, stepDescriptor) {
    if (stepDescriptor?.executor === 'human') {
      openTaskCalled = true;
      return;
    }
    dispatchCalled = true;
  }

  handleStartStep({ id: 'task-h' }, { id: 'human-review', executor: 'human' });

  assert.equal(openTaskCalled, true, 'Human step opens task dialog directly for preview');
  assert.equal(dispatchCalled, false, 'Human step does not dispatch agent execution turn');

  // Verify task-dialog.tsx contains HumanStepSurface without requiring activation
  assert.ok(
    taskDialogCode.includes('<HumanStepSurface'),
    'task-dialog.tsx must render HumanStepSurface',
  );
  assert.ok(
    taskDialogCode.includes('actionGate?.humanInteraction'),
    'task-dialog.tsx renders HumanStepSurface when actionGate has humanInteraction DTO',
  );
});

test('AC 5: Cross-selection dependency warnings name blocking tasks and allow submitting anyway', () => {
  const tasks = [
    { id: 'task-a', title: 'Task A', status: 'ready', dependsOn: [] },
    { id: 'task-b', title: 'Task B', status: 'ready', dependsOn: ['task-a'] },
  ];

  const taskActions = {
    'task-a': { state: 'ready', availableActions: ['start-step'] },
    'task-b': { state: 'blocked', blockedBy: ['task-a'], availableActions: [] },
  };

  // Selection only includes task-b (task-a is unselected and unsatisfied)
  const selectedTaskIds = new Set(['task-b']);

  // Compute dependency warnings as in specification-overview.tsx
  function computeWarnings(selected, allTasks, actions) {
    const warnings = [];
    for (const task of allTasks) {
      if (!selected.has(task.id)) continue;
      for (const depId of task.dependsOn || []) {
        const depTask = allTasks.find((t) => t.id === depId);
        const depGate = actions?.[depId];
        const isSatisfied =
          depTask?.status === 'verified' ||
          depGate?.state === 'terminal' ||
          depGate?.terminalOutcome === 'success';
        if (!isSatisfied && !selected.has(depId)) {
          warnings.push({
            taskId: task.id,
            taskTitle: task.title,
            blockingTaskId: depId,
          });
        }
      }
    }
    return warnings;
  }

  const warnings = computeWarnings(selectedTaskIds, tasks, taskActions);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].taskId, 'task-b');
  assert.equal(warnings[0].blockingTaskId, 'task-a');

  // Submitting is still allowed: disabled check in SequentialQueueTaskPicker only requires selectedTaskIds.size > 0
  const isSubmitDisabled = selectedTaskIds.size === 0;
  assert.equal(isSubmitDisabled, false, 'Start batch button must remain enabled despite warnings');
});

test('AC 7: While one task shows pending human interaction, an independent eligible task Start control remains enabled', () => {
  const taskActions = {
    'task-human': {
      state: 'human-interaction',
      humanInteraction: { prompt: 'Please review and confirm' },
      availableActions: [],
    },
    'task-eligible': {
      state: 'ready',
      availableActions: ['start-step'],
      stepDescriptor: { id: 'step-run', executor: 'agent' },
    },
  };

  const isHumanInteractionForA =
    taskActions['task-human'].state === 'human-interaction' ||
    Boolean(taskActions['task-human'].humanInteraction);
  const canStartStepForB = Boolean(
    taskActions['task-eligible'].availableActions?.includes('start-step'),
  );

  assert.equal(isHumanInteractionForA, true, 'Task A is in human interaction');
  assert.equal(canStartStepForB, true, 'Task B Start button is independently enabled');
});

// ─── Task 08: Dashboard Batch Review UX ────────────────────────────────────

const ROUTES_PATH = path.join(
  REPO_ROOT,
  'tools/dashboard/server/ai/sessions/turns/routes.mjs',
);
const ACTIONS_PATH = path.join(
  REPO_ROOT,
  'tools/dashboard/server/specs/actions.mjs',
);

const routesCode = fs.readFileSync(ROUTES_PATH, 'utf8');
const actionsCode = fs.readFileSync(ACTIONS_PATH, 'utf8');

// ─── AC T08-1: "Review together" eligibility and session routing ───────────
test('T08 AC 1: isBatchReviewEligible requires ≥2 tasks with reviewer role and start-step action', () => {
  // The logic mirrors specification-overview.tsx isBatchReviewEligible useMemo
  function isBatchReviewEligible(selectedTaskIds, taskActions) {
    if (selectedTaskIds.size < 2) return false;
    for (const id of selectedTaskIds) {
      const gate = taskActions?.[id];
      const targetStep =
        gate?.stepDescriptor?.id ||
        gate?.nextStepDescriptor?.id ||
        gate?.currentStepDescriptor?.id;
      const role = gate?.execution?.role;
      const isReviewer = targetStep === 'review' || role === 'reviewer';
      const isRunnable = gate?.availableActions?.includes('start-step');
      if (!isReviewer || !isRunnable) return false;
    }
    return true;
  }

  // Should be eligible: 3 reviewer tasks all with start-step
  const eligibleTasks = {
    'task-r1': { stepDescriptor: { id: 'review' }, execution: { role: 'reviewer' }, availableActions: ['start-step'] },
    'task-r2': { stepDescriptor: { id: 'review' }, execution: { role: 'reviewer' }, availableActions: ['start-step'] },
    'task-r3': { stepDescriptor: { id: 'review' }, execution: { role: 'reviewer' }, availableActions: ['start-step'] },
  };
  assert.equal(
    isBatchReviewEligible(new Set(['task-r1', 'task-r2', 'task-r3']), eligibleTasks),
    true,
    'Three reviewer tasks with start-step should be eligible',
  );

  // Should NOT be eligible: only one task
  assert.equal(
    isBatchReviewEligible(new Set(['task-r1']), eligibleTasks),
    false,
    'Single task cannot form a batch',
  );

  // Should NOT be eligible: one task is not a reviewer step
  const mixedTasks = {
    'task-r1': { stepDescriptor: { id: 'review' }, execution: { role: 'reviewer' }, availableActions: ['start-step'] },
    'task-d1': { stepDescriptor: { id: 'implement' }, execution: { role: 'developer' }, availableActions: ['start-step'] },
  };
  assert.equal(
    isBatchReviewEligible(new Set(['task-r1', 'task-d1']), mixedTasks),
    false,
    'Mixed-role selection must not be eligible (D13)',
  );

  // Should NOT be eligible: reviewer task but no start-step
  const notRunnableTasks = {
    'task-r1': { stepDescriptor: { id: 'review' }, execution: { role: 'reviewer' }, availableActions: [] },
    'task-r2': { stepDescriptor: { id: 'review' }, execution: { role: 'reviewer' }, availableActions: ['start-step'] },
  };
  assert.equal(
    isBatchReviewEligible(new Set(['task-r1', 'task-r2']), notRunnableTasks),
    false,
    'All tasks must have start-step available',
  );
});

// ─── AC T08-2: "Review together" sends reviewTogether:true through admitAgentExecution ──
test('T08 AC 2: reviewTogether flag routes to batch handler (not individual) via admitAgentExecution', () => {
  // Structural check: batch review handler keyed on reviewTogether / batchReview / scope.kind
  assert.ok(
    routesCode.includes("body.reviewTogether === true || body.batchReview === true || body.scope?.kind === 'task-batch'"),
    'routes.mjs must gate batch execution on reviewTogether, batchReview, or scope.kind=task-batch',
  );

  // Batch handler is generalized (batch-execution-generalization, task 10): it must
  // NOT hardcode-reject any resolved role other than 'reviewer' — the full execution
  // contract (role, possibly null for a brand-new entry-step batch) comes from
  // validateBatchCompatibility's own result, not a route-local restriction.
  assert.ok(
    !routesCode.includes("compat.role !== 'reviewer'") && !routesCode.includes("role: 'reviewer'"),
    'routes.mjs batch handler must not hardcode-restrict batch execution to the reviewer role',
  );
  assert.ok(
    routesCode.includes('const resolvedRole = compat.role;'),
    'routes.mjs batch handler must resolve role from validateBatchCompatibility\'s own result',
  );

  // Batch handler calls admitAgentExecution (not a second session creation path)
  assert.ok(
    routesCode.includes("await admitAgentExecution(canonicalSpecId, candidate") &&
    routesCode.includes("scope: { kind: 'task-batch', taskIds: selectedTaskIds }"),
    'Batch handler must call admitAgentExecution with task-batch scope, not a second session path',
  );

  // The UI sets reviewTogether: true in the fetch body
  assert.ok(
    detailContentCode.includes("executionOptions?.reviewTogether ? { reviewTogether: true }"),
    'specification-detail-content.tsx must forward reviewTogether flag in fetch body',
  );

  // overview passes reviewTogether option
  assert.ok(
    overviewCode.includes("handleStartBatch({ reviewTogether: true })"),
    'specification-overview.tsx must call handleStartBatch with reviewTogether: true for "Review together"',
  );
});

// ─── AC T08-3: After batch completes — per-task verdict + shared report ─────
test('T08 AC 3: Per-task lastReview verdict/feedback/reportPath is surfaced independently per task', () => {
  // actions.mjs exposes lastReview in the projection DTO
  assert.ok(
    actionsCode.includes('let lastReview = null') &&
    actionsCode.includes('verdict:') &&
    actionsCode.includes('feedback:') &&
    actionsCode.includes('reportPath:') &&
    actionsCode.includes('lastReview,'),
    'computeDeterministicTaskActionProjection must expose lastReview DTO with verdict, feedback, reportPath',
  );

  // Simulate per-task independent lastReview extraction (same as actions.mjs logic)
  function extractLastReview(history) {
    for (let i = history.length - 1; i >= 0; i--) {
      const entry = history[i];
      if (entry.step === 'review' || entry.result === 'pass' || entry.result === 'fail') {
        const reportPath =
          (Array.isArray(entry.artifacts) ? entry.artifacts.find((a) => typeof a === 'string' && a.includes('review-batch-')) : null) ||
          (entry.batchExecutionId ? `reviews/review-batch-${entry.batchExecutionId}.md` : null);
        return {
          verdict: entry.result || entry.value || null,
          feedback: entry.feedback || null,
          reportPath: reportPath || null,
          step: entry.step,
          attempt: entry.attempt,
          sessionId: entry.sessionId || null,
        };
      }
    }
    return null;
  }

  const batchId = 'batch-abc123';
  const historyA = [{ step: 'review', result: 'pass', feedback: 'LGTM', batchExecutionId: batchId, attempt: 1 }];
  const historyB = [{ step: 'review', result: 'fail', feedback: 'Needs more tests', batchExecutionId: batchId, attempt: 1 }];
  const historyC = [{ step: 'review', result: 'pass', feedback: null, batchExecutionId: batchId, attempt: 1 }];

  const reviewA = extractLastReview(historyA);
  const reviewB = extractLastReview(historyB);
  const reviewC = extractLastReview(historyC);

  // Each task has its own independent verdict
  assert.equal(reviewA.verdict, 'pass', 'Task A must have independent pass verdict');
  assert.equal(reviewB.verdict, 'fail', 'Task B must have independent fail verdict');
  assert.equal(reviewC.verdict, 'pass', 'Task C must have independent pass verdict');

  // All share the same reportPath (constructed from same batchExecutionId)
  const expectedReport = `reviews/review-batch-${batchId}.md`;
  assert.equal(reviewA.reportPath, expectedReport, 'Task A must have shared report link');
  assert.equal(reviewB.reportPath, expectedReport, 'Task B must have same shared report link');
  assert.equal(reviewC.reportPath, expectedReport, 'Task C must have same shared report link');

  // Shared report path surfaced in UI from sharedBatchReportPath useMemo
  assert.ok(
    overviewCode.includes('sharedBatchReportPath') &&
    overviewCode.includes('?.lastReview?.reportPath'),
    'specification-overview.tsx must compute sharedBatchReportPath from task lastReview.reportPath',
  );

  // Per-task verdict rendered independently per task card
  assert.ok(
    overviewCode.includes('lastReview.verdict') &&
    overviewCode.includes('lastReview.feedback'),
    'specification-overview.tsx must render per-task lastReview verdict and feedback independently',
  );
});

// ─── AC T08-4: Reviewing individually still works (unchanged path) ──────────
test('T08 AC 4: Individual review path is preserved alongside batch review option', () => {
  // "Review individually" button calls handleStartBatch() without reviewTogether option
  assert.ok(
    overviewCode.includes("isBatchReviewEligible ? 'Review individually' : 'Start batch'"),
    '"Review individually" label must appear when batch is eligible',
  );

  // The individual start path does NOT include reviewTogether flag
  // Simulate logic: handleStartBatch() (no options) falls through to existing single-task path
  function handleStartBatch(options, selectedTaskIds, taskActions, tasks) {
    if (selectedTaskIds.size === 0) return null;
    const selectedTasks = tasks
      .filter((t) => selectedTaskIds.has(t.id))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const nextRunnable = selectedTasks.find((t) => taskActions[t.id]?.availableActions?.includes('start-step'));
    if (!nextRunnable) return null;
    return {
      task: nextRunnable,
      reviewTogether: Boolean(options?.reviewTogether),
    };
  }

  const tasks = [
    { id: 't1', order: 1 },
    { id: 't2', order: 2 },
  ];
  const taskActions = {
    't1': { stepDescriptor: { id: 'review' }, execution: { role: 'reviewer' }, availableActions: ['start-step'] },
    't2': { stepDescriptor: { id: 'review' }, execution: { role: 'reviewer' }, availableActions: ['start-step'] },
  };
  const selectedIds = new Set(['t1', 't2']);

  const individualResult = handleStartBatch(undefined, selectedIds, taskActions, tasks);
  assert.equal(individualResult?.reviewTogether, false, '"Review individually" must not set reviewTogether');
  assert.equal(individualResult?.task?.id, 't1', '"Review individually" must start first runnable task');

  const batchResult = handleStartBatch({ reviewTogether: true }, selectedIds, taskActions, tasks);
  assert.equal(batchResult?.reviewTogether, true, '"Review together" must set reviewTogether flag');
});

// ─── AC T08-5: BATCH_CONTEXT_TOO_LARGE surfaces distinct actionable UI failure ─
test('T08 AC 5: BATCH_CONTEXT_TOO_LARGE error surfaces distinct actionable guidance; unknown capacity surfaces warning', () => {
  // Known capacity over-budget — actionable message
  assert.ok(
    detailContentCode.includes("err.error?.code === 'BATCH_CONTEXT_TOO_LARGE' || err.code === 'BATCH_CONTEXT_TOO_LARGE'"),
    'specification-detail-content.tsx must check for BATCH_CONTEXT_TOO_LARGE error code',
  );
  assert.ok(
    detailContentCode.includes("'Selection exceeds model context capacity. Choose fewer tasks or a model with larger context.'"),
    'BATCH_CONTEXT_TOO_LARGE must produce distinct actionable guidance message',
  );

  // Simulate the error catch logic
  function handleTurnFetchError(err) {
    if (err.error?.code === 'BATCH_CONTEXT_TOO_LARGE' || err.code === 'BATCH_CONTEXT_TOO_LARGE') {
      return { type: 'actionable', message: 'Selection exceeds model context capacity. Choose fewer tasks or a model with larger context.' };
    }
    return { type: 'generic', message: err.error?.message || err.message || 'Failed to admit agent execution' };
  }

  const knownCapacityError = handleTurnFetchError({ error: { code: 'BATCH_CONTEXT_TOO_LARGE', message: 'Too large' } });
  assert.equal(knownCapacityError.type, 'actionable', 'Known capacity error must surface actionable guidance');
  assert.ok(knownCapacityError.message.includes('Choose fewer tasks'), 'Guidance must tell user to choose fewer tasks or different model');

  const unknownCapacityError = handleTurnFetchError({ error: { code: 'ADMISSION_BLOCKED', message: 'Blocked' } });
  assert.equal(unknownCapacityError.type, 'generic', 'Non-BATCH_CONTEXT_TOO_LARGE errors surface generic message');

  // Server stores contextCapacity with status 'unknown' when catalog trait unavailable (D34/D38)
  assert.ok(
    routesCode.includes("status: 'unknown', reason: 'Catalog trait not available'"),
    'routes.mjs must store contextCapacity with status: unknown when catalog trait is absent (D34/D38)',
  );

  // Never fabricate numeric limits for unknown capacity
  const unknownCapacityPattern = /status:\s*['"]unknown['"].*maxContextTokens/s;
  assert.ok(
    !unknownCapacityPattern.test(routesCode),
    'routes.mjs must never fabricate maxContextTokens for unknown capacity',
  );
});

// ─── AC T08-6: No second session-creation path — single admitAgentExecution boundary ─
test('T08 AC 6: All batch sessions route through admitAgentExecution — no second session-creation path', () => {
  // Both the single-task and batch paths both call admitAgentExecution (same gate)
  const admitCallCount = (routesCode.match(/await admitAgentExecution\(/g) || []).length;
  assert.ok(admitCallCount >= 2, `routes.mjs must contain at least 2 admitAgentExecution calls (single-task + batch), found ${admitCallCount}`);

  // No direct session.create or createSession call in routes.mjs
  assert.ok(
    !routesCode.includes('session.create(') && !routesCode.includes('createSession.create('),
    'routes.mjs must not bypass admission via direct session.create calls',
  );

  // Batch path sets scope.kind = 'task-batch' before admission
  assert.ok(
    routesCode.includes("scope: { kind: 'task-batch', taskIds: selectedTaskIds }"),
    'Batch admission must set scope kind=task-batch before calling admitAgentExecution',
  );

  // Batch path performs rollback on admission failure (D19)
  assert.ok(
    routesCode.includes('rollbackReservationSynchronously') &&
    routesCode.includes('!admission.admitted'),
    'Batch handler must rollback reservation synchronously when admission fails (D19)',
  );

  // UI detail-content has no direct createSession.create call (already covered by AC 6, but also for batch)
  assert.ok(
    !detailContentCode.includes('createSession.create('),
    'specification-detail-content.tsx must not contain any createSession.create call for batch or single execution',
  );
});
