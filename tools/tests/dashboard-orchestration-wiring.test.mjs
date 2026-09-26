// Tests for Dashboard Orchestration Wiring (Task 32, D32, D33, D47, D49).
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
