import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  resolveWorkflowPosition,
} from '../specs/workflow/step-runner.mjs';
import {
  ensureStepActivated,
} from '../specs/workflow/step-context.mjs';
import {
  validateWorkflowProgress,
} from '../specs/validation.mjs';
import {
  PreconditionError,
} from '../specs/workflow/errors.mjs';
import {
  requireChange,
  requireTask,
} from '../specs/store.mjs';
import '../specs/workflow/actions/index.mjs';

const DEMO_DEFINITION = {
  id: 'standard-v1',
  entryStep: 'implementation',
  steps: {
    implementation: {
      status: { active: 'in-implementation', completed: 'implemented' },
      transitions: [{ target: 'review' }],
    },
    review: {
      status: { active: 'in-review', completed: 'verified' },
      transitions: [{ target: 'implementation' }, { target: 'verified' }],
    },
  },
};

function makeGitFixture(prefix) {
  const base = mkdtempSync(join(tmpdir(), `${prefix}-`));
  const repo = join(base, 'repo');
  mkdirSync(repo, { recursive: true });
  const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  git(['init', '-b', 'main']);
  git(['config', 'user.name', 'Test User']);
  git(['config', 'user.email', 'test@example.com']);

  const activeDir = join(repo, 'specs', 'active');
  const changeDir = join(activeDir, 'demo-change');
  const tasksDir = join(changeDir, 'tasks');
  mkdirSync(tasksDir, { recursive: true });

  const rootTxt = join(repo, 'root.txt');
  writeFileSync(rootTxt, 'initial\n');
  git(['add', '-A']);
  git(['commit', '-m', 'initial commit']);

  return {
    base,
    repo,
    activeDir,
    changeDir,
    tasksDir,
    git,
  };
}

function cleanupFixture(fx) {
  try {
    rmSync(fx.base, { recursive: true, force: true });
  } catch {}
}

describe('resolveWorkflowPosition (AC1)', () => {
  test('resolves initial position for pending task without workflow_progress', () => {
    const task = { id: 'demo-task', status: 'draft' };
    const pos = resolveWorkflowPosition(DEMO_DEFINITION, task);
    assert.deepEqual(pos, {
      phase: 'new',
    });
  });

  test('resolves active step on first attempt', () => {
    const task = {
      id: 'demo-task',
      status: 'in-implementation',
      workflow_progress: {
        current_step: 'implementation',
        current_attempt: 1,
        state: 'active',
        history: [],
      },
    };
    const pos = resolveWorkflowPosition(DEMO_DEFINITION, task);
    assert.deepEqual(pos, {
      phase: 'active',
      step: 'implementation',
      attempt: 1,
    });
  });

  test('resolves active step on re-entry (loop cycle)', () => {
    const task = {
      id: 'demo-task',
      status: 'in-implementation',
      workflow_progress: {
        current_step: 'implementation',
        current_attempt: 2,
        state: 'active',
        history: [
          { step: 'implementation', attempt: 1, completed_at: '2026-01-01T00:00:00.000Z', transitioned_to: 'review' },
          { step: 'review', attempt: 1, completed_at: '2026-01-01T01:00:00.000Z', transitioned_to: 'implementation' },
        ],
      },
    };
    const pos = resolveWorkflowPosition(DEMO_DEFINITION, task);
    assert.deepEqual(pos, {
      phase: 'active',
      step: 'implementation',
      attempt: 2,
    });
  });

  test('throws WorkflowError when current_attempt is missing or invalid (fail-closed)', () => {
    // Missing current_attempt
    const missingAttemptTask = {
      id: 'demo-task',
      status: 'in-implementation',
      workflow_progress: {
        current_step: 'implementation',
        state: 'active',
        history: [],
      },
    };
    assert.throws(
      () => resolveWorkflowPosition(DEMO_DEFINITION, missingAttemptTask),
      (err) => err.code === 'INVALID_WORKFLOW_PROGRESS_ATTEMPT'
    );

    // Invalid current_attempt (< 1 or non-integer)
    const invalidAttemptTask = {
      id: 'demo-task',
      status: 'in-implementation',
      workflow_progress: {
        current_step: 'implementation',
        current_attempt: 0,
        state: 'active',
        history: [],
      },
    };
    assert.throws(
      () => resolveWorkflowPosition(DEMO_DEFINITION, invalidAttemptTask),
      (err) => err.code === 'INVALID_WORKFLOW_PROGRESS_ATTEMPT'
    );
  });

  test('resolves completed step and attempt from latest history record', () => {
    const task = {
      id: 'demo-task',
      status: 'verified',
      workflow_progress: {
        current_step: 'review',
        current_attempt: 2,
        state: 'completed',
        history: [
          { step: 'implementation', attempt: 1 },
          { step: 'review', attempt: 1 },
          { step: 'implementation', attempt: 2 },
          { step: 'review', attempt: 2, transitioned_to: 'verified' },
        ],
      },
    };
    const pos = resolveWorkflowPosition(DEMO_DEFINITION, task);
    assert.deepEqual(pos, {
      phase: 'terminal',
      step: 'review',
      attempt: 2,
    });
  });

  test('throws WorkflowError when state is invalid or incoherent', () => {
    const invalidStateTask = {
      id: 'demo-task',
      status: 'in-implementation',
      workflow_progress: {
        current_step: 'implementation',
        current_attempt: 1,
        state: 'invalid-state',
      },
    };
    assert.throws(
      () => resolveWorkflowPosition(DEMO_DEFINITION, invalidStateTask),
      (err) => err.code === 'INVALID_WORKFLOW_PROGRESS_STATE'
    );

    const incoherentTask = {
      id: 'demo-task',
      status: 'verified',
      workflow_progress: {
        current_step: 'implementation',
        current_attempt: 2,
        state: 'completed',
        history: [
          { step: 'implementation', attempt: 1, transitioned_to: 'review' },
        ],
      },
    };
    assert.throws(
      () => resolveWorkflowPosition(DEMO_DEFINITION, incoherentTask),
      (err) => err.code === 'INCOHERENT_WORKFLOW_PROGRESS'
    );

    const emptyHistoryTask = {
      id: 'demo-task',
      status: 'verified',
      workflow_progress: {
        current_step: 'implementation',
        current_attempt: 1,
        state: 'completed',
        history: [],
      },
    };
    assert.throws(
      () => resolveWorkflowPosition(DEMO_DEFINITION, emptyHistoryTask),
      (err) => err.code === 'INCOHERENT_WORKFLOW_PROGRESS'
    );

    const mismatchedStepTask = {
      id: 'demo-task',
      status: 'verified',
      workflow_progress: {
        current_step: 'implementation',
        current_attempt: 1,
        state: 'completed',
        history: [
          { step: 'review', attempt: 1, transitioned_to: 'verified' },
        ],
      },
    };
    assert.throws(
      () => resolveWorkflowPosition(DEMO_DEFINITION, mismatchedStepTask),
      (err) => err.code === 'INCOHERENT_WORKFLOW_PROGRESS'
    );
  });
});

describe('ensureStepActivated (AC2)', () => {
  let fx;
  before(() => { fx = makeGitFixture('nevo-step-runner-activate'); });
  after(() => cleanupFixture(fx));

  function writeChangeYaml(tasks) {
    const lines = [
      'id: demo-change',
      'title: Demo Change',
      'workflow:',
      '  mode: deterministic',
      '  definition: standard-v1',
      'tasks:',
    ];
    for (const t of tasks) {
      lines.push(`  - id: ${t.id}`);
      lines.push(`    status: ${t.status}`);
      if (t.workflow_progress) {
        lines.push('    workflow_progress:');
        if (t.workflow_progress.current_step) {
          lines.push(`      current_step: ${t.workflow_progress.current_step}`);
        }
        if (t.workflow_progress.current_attempt !== undefined) {
          lines.push(`      current_attempt: ${t.workflow_progress.current_attempt}`);
        }
        lines.push(`      state: ${t.workflow_progress.state}`);
        if (t.workflow_progress.history) {
          lines.push('      history:');
          for (const h of t.workflow_progress.history) {
            lines.push(`        - step: ${h.step}`);
            lines.push(`          attempt: ${h.attempt}`);
            if (h.completed_at) lines.push(`          completed_at: "${h.completed_at}"`);
            if (h.transitioned_to) lines.push(`          transitioned_to: "${h.transitioned_to}"`);
          }
        }
      }
    }
    writeFileSync(join(fx.changeDir, 'change.yaml'), lines.join('\n') + '\n');
  }

  test('fresh task starts on entryStep attempt 1', () => {
    writeChangeYaml([{ id: 'demo-task', status: 'draft' }]);
    const taskPath = join(fx.tasksDir, '01-demo-task.md');
    writeFileSync(taskPath, '---\nid: demo-task\nstatus: draft\n---\n# Demo Task\n');
    fx.git(['add', '-A']);
    fx.git(['commit', '-m', 'setup task']);

    const change = requireChange('demo-change', fx.activeDir);
    const task = requireTask(change, 'demo-task');

    const { task: effectiveTask, position } = ensureStepActivated(change, task, DEMO_DEFINITION, { repoRoot: fx.repo });
    assert.equal(position.step, 'implementation');
    assert.equal(position.attempt, 1);
    assert.equal(effectiveTask.workflow_progress.current_step, 'implementation');
    assert.equal(effectiveTask.workflow_progress.current_attempt, 1);
    assert.equal(effectiveTask.workflow_progress.state, 'active');

    // Resuming preserves current_attempt without increment
    const reloadedChange = requireChange('demo-change', fx.activeDir);
    const reloadedTask = requireTask(reloadedChange, 'demo-task');
    const { position: resumedPos } = ensureStepActivated(reloadedChange, reloadedTask, DEMO_DEFINITION, { repoRoot: fx.repo });
    assert.equal(resumedPos.step, 'implementation');
    assert.equal(resumedPos.attempt, 1);
  });

  test('increments current_attempt when re-entering a previously visited step', () => {
    writeChangeYaml([{
      id: 'loop-task',
      status: 'in-review',
      workflow_progress: {
        current_step: 'review',
        current_attempt: 1,
        state: 'completed',
        history: [
          { step: 'implementation', attempt: 1, completed_at: '2026-01-01T00:00:00.000Z', transitioned_to: 'review' },
          { step: 'review', attempt: 1, completed_at: '2026-01-01T01:00:00.000Z', transitioned_to: 'implementation' },
        ],
      },
    }]);
    const taskPath = join(fx.tasksDir, '02-loop-task.md');
    writeFileSync(taskPath, '---\nid: loop-task\nstatus: in-review\n---\n# Loop Task\n');
    fx.git(['add', '-A']);
    fx.git(['commit', '-m', 'setup loop task']);

    const change = requireChange('demo-change', fx.activeDir);
    const task = requireTask(change, 'loop-task');

    // Re-entering 'implementation' should allocate attempt 2
    const { task: activatedTask, position } = ensureStepActivated(change, task, DEMO_DEFINITION, { repoRoot: fx.repo });
    assert.equal(position.step, 'implementation');
    assert.equal(position.attempt, 2);
    assert.equal(activatedTask.workflow_progress.current_step, 'implementation');
    assert.equal(activatedTask.workflow_progress.current_attempt, 2);
    assert.equal(activatedTask.workflow_progress.state, 'active');

    // Resuming again preserves attempt 2
    const reloadedChange = requireChange('demo-change', fx.activeDir);
    const reloadedTask = requireTask(reloadedChange, 'loop-task');
    const { position: resumedPos } = ensureStepActivated(reloadedChange, reloadedTask, DEMO_DEFINITION, { repoRoot: fx.repo });
    assert.equal(resumedPos.step, 'implementation');
    assert.equal(resumedPos.attempt, 2);
  });
});

describe('validateWorkflowProgress (AC3)', () => {
  const dummyChange = {
    id: 'demo-change',
    workflow: { mode: 'deterministic', definition: 'standard' },
  };

  test('accepts valid workflow progress', () => {
    const task = {
      id: 'task1',
      workflow_progress: {
        current_step: 'review',
        current_attempt: 1,
        state: 'active',
        history: [
          {
            step: 'implementation',
            attempt: 1,
            completed_at: '2026-01-01T00:00:00.000Z',
            transitioned_to: 'review',
            artifacts: ['foo.txt'],
          },
        ],
      },
    };
    const errors = [];
    validateWorkflowProgress(dummyChange, task, errors, 'task1');
    assert.deepEqual(errors, []);
  });

  test('rejects duplicate (step, attempt) pairs in history', () => {
    const task = {
      id: 'task1',
      workflow_progress: {
        current_step: 'review',
        current_attempt: 1,
        state: 'active',
        history: [
          { step: 'implementation', attempt: 1, completed_at: '2026-01-01T00:00:00.000Z', transitioned_to: 'review' },
          { step: 'implementation', attempt: 1, completed_at: '2026-01-01T02:00:00.000Z', transitioned_to: 'review' },
        ],
      },
    };
    const errors = [];
    validateWorkflowProgress(dummyChange, task, errors, 'task1');
    assert.ok(errors.some(e => e.includes("duplicate attempt 1 for step 'implementation'")));
  });

  test('rejects non-contiguous attempt sequence in history', () => {
    const task = {
      id: 'task1',
      workflow_progress: {
        current_step: 'review',
        current_attempt: 1,
        state: 'active',
        history: [
          { step: 'implementation', attempt: 1, completed_at: '2026-01-01T00:00:00.000Z', transitioned_to: 'review' },
          { step: 'implementation', attempt: 3, completed_at: '2026-01-01T02:00:00.000Z', transitioned_to: 'review' },
        ],
      },
    };
    const errors = [];
    validateWorkflowProgress(dummyChange, task, errors, 'task1');
    assert.ok(errors.some(e => e.includes("non-contiguous attempt sequence for step 'implementation'")));
  });

  test('rejects incoherent active attempt count', () => {
    // 1 implementation entry in history, active step is implementation, but current_attempt is 1 (should be 2)
    const task1 = {
      id: 'task1',
      workflow_progress: {
        current_step: 'implementation',
        current_attempt: 1,
        state: 'active',
        history: [
          { step: 'implementation', attempt: 1, completed_at: '2026-01-01T00:00:00.000Z', transitioned_to: 'review' },
        ],
      },
    };
    const errors1 = [];
    validateWorkflowProgress(dummyChange, task1, errors1, 'task1');
    assert.ok(errors1.some(e => e.includes("active step 'implementation' has current_attempt 1, expected 2")));

    // current_attempt is 3 (should be 2)
    const task2 = {
      id: 'task1',
      workflow_progress: {
        current_step: 'implementation',
        current_attempt: 3,
        state: 'active',
        history: [
          { step: 'implementation', attempt: 1, completed_at: '2026-01-01T00:00:00.000Z', transitioned_to: 'review' },
        ],
      },
    };
    const errors2 = [];
    validateWorkflowProgress(dummyChange, task2, errors2, 'task1');
    assert.ok(errors2.some(e => e.includes("active step 'implementation' has current_attempt 3, expected 2")));
  });

  test('rejects incoherent completed attempt count and step coherence', () => {
    // state is completed, but current_attempt does not match count
    const taskCount = {
      id: 'task1',
      workflow_progress: {
        current_step: 'review',
        current_attempt: 2,
        state: 'completed',
        history: [
          { step: 'implementation', attempt: 1, completed_at: '2026-01-01T00:00:00.000Z', transitioned_to: 'review' },
          { step: 'review', attempt: 1, completed_at: '2026-01-01T01:00:00.000Z', transitioned_to: 'human-verification' },
        ],
      },
    };
    const errorsCount = [];
    validateWorkflowProgress(dummyChange, taskCount, errorsCount, 'task1');
    assert.ok(errorsCount.some(e => e.includes("completed step 'review' has current_attempt 2, expected 1")));

    // state is completed, but current_step does not match latest history step
    const taskStep = {
      id: 'task1',
      workflow_progress: {
        current_step: 'implementation',
        current_attempt: 1,
        state: 'completed',
        history: [
          { step: 'implementation', attempt: 1, completed_at: '2026-01-01T00:00:00.000Z', transitioned_to: 'review' },
          { step: 'review', attempt: 1, completed_at: '2026-01-01T01:00:00.000Z', transitioned_to: 'human-verification' },
        ],
      },
    };
    const errorsStep = [];
    validateWorkflowProgress(dummyChange, taskStep, errorsStep, 'task1');
    assert.ok(errorsStep.some(e => e.includes("latest history record step 'review' does not match current_step 'implementation'")));
  });

  test('rejects history entries with invalid artifacts format', () => {
    const taskNotArray = {
      id: 'task1',
      workflow_progress: {
        current_step: 'review',
        current_attempt: 1,
        state: 'active',
        history: [
          {
            step: 'implementation',
            attempt: 1,
            completed_at: '2026-01-01T00:00:00.000Z',
            transitioned_to: 'review',
            artifacts: 'not-an-array',
          },
        ],
      },
    };
    const errors1 = [];
    validateWorkflowProgress(dummyChange, taskNotArray, errors1, 'task1');
    assert.ok(errors1.some(e => e.includes('artifacts must be an array of non-empty strings')));

    const taskNonString = {
      id: 'task1',
      workflow_progress: {
        current_step: 'review',
        current_attempt: 1,
        state: 'active',
        history: [
          {
            step: 'implementation',
            attempt: 1,
            completed_at: '2026-01-01T00:00:00.000Z',
            transitioned_to: 'review',
            artifacts: [123],
          },
        ],
      },
    };
    const errors2 = [];
    validateWorkflowProgress(dummyChange, taskNonString, errors2, 'task1');
    assert.ok(errors2.some(e => e.includes('artifacts must be an array of non-empty strings')));
  });
});
