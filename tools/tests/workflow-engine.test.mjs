// Tests for ActionRegistry, aggregated step checking, duplicate action prevention, and WorkflowEngine.
// Run: node --test tools/tests/workflow-engine.test.mjs

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  ActionContract,
  ActionCheckResult,
  ActionExecuteResult,
  ActionRegistry,
  GateRegistry,
  WorkflowEngine,
  WorkflowError,
  PreconditionError,
} from '../specs/workflow/index.mjs';

// Mock test actions
class VerifyArtifactsAction extends ActionContract {
  get id() { return 'verify-task-output'; }
  get description() { return 'Verifies generated task artifacts'; }

  async check(context) {
    return new ActionCheckResult({
      actionId: this.id,
      requiredInputs: [],
      context: { verifiedArtifacts: context.artifacts || ['dist/bundle.js'] },
      ready: true,
      summary: 'Artifacts verified',
    });
  }

  async executeValidated(inputs, context) {
    return new ActionExecuteResult({
      actionId: this.id,
      success: true,
      outputs: { verified: true },
      summary: 'Task output verified successfully',
    });
  }
}

class CommitAndPushAction extends ActionContract {
  constructor(options = {}) {
    super();
    this.readyFlag = options.ready !== undefined ? options.ready : true;
    this.shouldFailExecution = options.shouldFailExecution || false;
    this.executionCount = 0;
  }

  get id() { return 'commit-and-push'; }
  get description() { return 'Commits changes and pushes branch'; }

  async check(context) {
    return new ActionCheckResult({
      actionId: this.id,
      requiredInputs: [
        { name: 'commitMessage', type: 'string', required: true, description: 'Commit message' },
        { name: 'include', type: 'array', required: true, description: 'Explicit file list', constraints: { itemType: 'string' } },
      ],
      context: {
        changedFiles: context.changedFiles || ['src/index.js'],
        branch: context.branch || 'feature/workflow',
      },
      ready: this.readyFlag,
      summary: this.readyFlag ? 'Changes ready to commit' : 'Working tree has conflicts',
    });
  }

  async executeValidated(inputs, context) {
    this.executionCount += 1;

    if (this.shouldFailExecution) {
      return new ActionExecuteResult({
        actionId: this.id,
        success: false,
        summary: 'Git push rejected by remote',
        error: { code: 'GIT_PUSH_REJECTED' },
      });
    }

    return new ActionExecuteResult({
      actionId: this.id,
      success: true,
      outputs: {
        commitSha: 'a1b2c3d4e5f6',
        pushedBranch: context.branch || 'feature/workflow',
      },
      summary: `Committed ${inputs.include.length} files and pushed`,
    });
  }
}

describe('ActionRegistry (AC1)', () => {
  let registry;

  beforeEach(() => {
    registry = new ActionRegistry();
  });

  test('registers and retrieves action instances by ID', () => {
    const action = new VerifyArtifactsAction();
    registry.register(action);

    assert.equal(registry.has('verify-task-output'), true);
    assert.equal(registry.get('verify-task-output'), action);
    assert.equal(registry.require('verify-task-output'), action);
    assert.deepEqual(registry.list(), ['verify-task-output']);
    assert.deepEqual(registry.getAll(), [action]);
  });

  test('unregisters an action by ID', () => {
    const action = new VerifyArtifactsAction();
    registry.register(action);
    assert.equal(registry.has('verify-task-output'), true);

    const removed = registry.unregister('verify-task-output');
    assert.equal(removed, true);
    assert.equal(registry.has('verify-task-output'), false);
    assert.equal(registry.get('verify-task-output'), undefined);
    assert.equal(registry.unregister('non-existent'), false);
  });

  test('rejects non-ActionContract registrations', () => {
    assert.throws(
      () => registry.register({ id: 'fake', check: () => {}, execute: () => {} }),
      /requires an ActionContract instance/
    );
  });

  test('rejects duplicate action registration with descriptive error', () => {
    const action1 = new VerifyArtifactsAction();
    const action2 = new VerifyArtifactsAction();

    registry.register(action1);
    assert.throws(
      () => registry.register(action2),
      (err) => {
        assert.ok(err instanceof WorkflowError);
        assert.match(err.message, /Action 'verify-task-output' is already registered/);
        return true;
      }
    );
  });

  test('require() throws descriptive WorkflowError for unregistered action', () => {
    assert.throws(
      () => registry.require('unknown-action'),
      (err) => {
        assert.ok(err instanceof WorkflowError);
        assert.match(err.message, /Unknown action 'unknown-action'/);
        return true;
      }
    );
  });
});

describe('WorkflowEngine aggregated step checks (AC2, AC4, AC5)', () => {
  let registry;
  let engine;

  beforeEach(() => {
    registry = new ActionRegistry();
    engine = new WorkflowEngine({ actionRegistry: registry });
  });

  test('checkStep aggregates multiple actions without losing action boundaries (AC4 schema)', async () => {
    registry.register(new VerifyArtifactsAction());
    registry.register(new CommitAndPushAction());

    const stepDef = {
      name: 'finalize',
      actions: [
        { id: 'verify-task-output' },
        { id: 'commit-and-push' },
      ],
    };

    const context = {
      artifacts: ['dist/bundle.js'],
      changedFiles: ['src/index.js'],
      branch: 'feature/workflow-foundation',
    };

    const result = await engine.checkStep(stepDef, context);

    assert.equal(result.step, 'finalize');
    assert.equal(result.ready, true);
    assert.ok(result.actions['verify-task-output']);
    assert.ok(result.actions['commit-and-push']);

    // Action 1 boundary preserved
    assert.equal(result.actions['verify-task-output'].actionId, 'verify-task-output');
    assert.deepEqual(result.actions['verify-task-output'].requiredInputs, []);
    assert.deepEqual(result.actions['verify-task-output'].context, { verifiedArtifacts: ['dist/bundle.js'] });

    // Action 2 boundary preserved
    assert.equal(result.actions['commit-and-push'].actionId, 'commit-and-push');
    assert.equal(result.actions['commit-and-push'].requiredInputs.length, 2);
    assert.equal(result.actions['commit-and-push'].requiredInputs[0].name, 'commitMessage');
    assert.deepEqual(result.actions['commit-and-push'].context, {
      changedFiles: ['src/index.js'],
      branch: 'feature/workflow-foundation',
    });
  });

  test('checkStep reflects overall ready: false when any action is not ready', async () => {
    registry.register(new VerifyArtifactsAction());
    registry.register(new CommitAndPushAction({ ready: false }));

    const stepDef = {
      name: 'finalize',
      actions: [{ id: 'verify-task-output' }, { id: 'commit-and-push' }],
    };

    const result = await engine.checkStep(stepDef, {});
    assert.equal(result.ready, false);
    assert.equal(result.actions['verify-task-output'].ready, true);
    assert.equal(result.actions['commit-and-push'].ready, false);
  });

  test('checkStep throws action-attributed error when an action is not registered', async () => {
    registry.register(new VerifyArtifactsAction());

    const stepDef = {
      name: 'finalize',
      actions: [{ id: 'verify-task-output' }, { id: 'unregistered-action' }],
    };

    await assert.rejects(
      async () => await engine.checkStep(stepDef, {}),
      (err) => {
        assert.ok(err instanceof WorkflowError);
        assert.match(err.message, /Unknown action 'unregistered-action'/);
        return true;
      }
    );
  });

  test('checkStep fails closed on duplicate action references in programmatic step (Finding 1)', async () => {
    registry.register(new CommitAndPushAction());

    const duplicateStep = {
      name: 'bad-step',
      actions: [{ id: 'commit-and-push' }, { id: 'commit-and-push' }],
    };

    await assert.rejects(
      async () => await engine.checkStep(duplicateStep, {}),
      (err) => {
        assert.ok(err instanceof WorkflowError);
        assert.equal(err.details?.code, 'DUPLICATE_ACTION_REFERENCE');
        assert.match(err.message, /Duplicate action reference 'commit-and-push'/);
        return true;
      }
    );
  });
});

describe('WorkflowEngine sequential step execution (AC3, AC5, Finding 1)', () => {
  let registry;
  let engine;

  beforeEach(() => {
    registry = new ActionRegistry();
    engine = new WorkflowEngine({ actionRegistry: registry });
  });

  test('executeStep executes actions in sequence with scoped inputs', async () => {
    registry.register(new VerifyArtifactsAction());
    registry.register(new CommitAndPushAction());

    const stepDef = {
      name: 'finalize',
      actions: [{ id: 'verify-task-output' }, { id: 'commit-and-push' }],
    };

    const stepInputs = {
      'verify-task-output': {},
      'commit-and-push': {
        commitMessage: 'feat: add engine',
        include: ['src/index.js'],
      },
    };

    const context = { branch: 'feature/workflow' };

    const result = await engine.executeStep(stepDef, stepInputs, context);
    assert.equal(result.success, true);
    assert.equal(result.step, 'finalize');
    assert.ok(result.actions['verify-task-output']);
    assert.ok(result.actions['commit-and-push']);
    assert.equal(result.actions['verify-task-output'].success, true);
    assert.equal(result.actions['commit-and-push'].success, true);
    assert.equal(result.actions['commit-and-push'].outputs.commitSha, 'a1b2c3d4e5f6');
  });

  test('executeStep aborts sequence immediately when an action fails execution', async () => {
    let secondActionRan = false;

    class FailingAction extends ActionContract {
      get id() { return 'failing-action'; }
      get description() { return 'Always fails'; }
      async check() { return new ActionCheckResult({ actionId: this.id, ready: true }); }
      async executeValidated() {
        return new ActionExecuteResult({
          actionId: this.id,
          success: false,
          summary: 'Simulated failure',
        });
      }
    }

    class SecondAction extends ActionContract {
      get id() { return 'second-action'; }
      get description() { return 'Second in sequence'; }
      async check() { return new ActionCheckResult({ actionId: this.id, ready: true }); }
      async executeValidated() {
        secondActionRan = true;
        return new ActionExecuteResult({ actionId: this.id, success: true });
      }
    }

    registry.register(new FailingAction());
    registry.register(new SecondAction());

    const stepDef = {
      name: 'multi-step',
      actions: [{ id: 'failing-action' }, { id: 'second-action' }],
    };

    const result = await engine.executeStep(stepDef, {}, {});
    assert.equal(result.success, false);
    assert.equal(result.failedAction, 'failing-action');
    assert.equal(secondActionRan, false, 'Second action must NEVER run after first action fails');
  });

  test('executeStep aborts sequence immediately when input precondition validation fails', async () => {
    registry.register(new CommitAndPushAction());
    registry.register(new VerifyArtifactsAction());

    const stepDef = {
      name: 'finalize',
      actions: [{ id: 'commit-and-push' }, { id: 'verify-task-output' }],
    };

    // Missing required inputs for commit-and-push
    const result = await engine.executeStep(stepDef, { 'commit-and-push': {} }, {});
    assert.equal(result.success, false);
    assert.equal(result.failedAction, 'commit-and-push');
    assert.match(result.error, /Precondition validation failed/);
    assert.equal(result.actions['verify-task-output'], undefined);
  });

  test('executeStep fails closed on duplicate action references before any mutation (Finding 1)', async () => {
    const commitAction = new CommitAndPushAction();
    registry.register(commitAction);

    const duplicateStep = {
      name: 'finalize',
      actions: [{ id: 'commit-and-push' }, { id: 'commit-and-push' }],
    };

    await assert.rejects(
      async () => await engine.executeStep(duplicateStep, { 'commit-and-push': { commitMessage: 'm', include: ['a.js'] } }, {}),
      (err) => {
        assert.ok(err instanceof WorkflowError);
        assert.equal(err.details?.code, 'DUPLICATE_ACTION_REFERENCE');
        return true;
      }
    );

    assert.equal(commitAction.executionCount, 0, 'Action must never be executed if duplicate exists in step');
  });

  test('same action can be used in two different steps independently (Finding 1)', async () => {
    const commitAction = new CommitAndPushAction();
    registry.register(commitAction);

    const step1 = { name: 'step1', actions: [{ id: 'commit-and-push' }] };
    const step2 = { name: 'step2', actions: [{ id: 'commit-and-push' }] };

    const res1 = await engine.executeStep(step1, { 'commit-and-push': { commitMessage: 'm1', include: ['a.js'] } }, {});
    assert.equal(res1.success, true);
    assert.equal(commitAction.executionCount, 1);

    const res2 = await engine.executeStep(step2, { 'commit-and-push': { commitMessage: 'm2', include: ['b.js'] } }, {});
    assert.equal(res2.success, true);
    assert.equal(commitAction.executionCount, 2);
  });
});
