// Tests for ActionContract, input schema validation, PreconditionError, and context models.
// Run: node --test tools/tests/workflow-contracts.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  ActionContract,
  GateContract,
  ActionCheckResult,
  ActionExecuteResult,
  validateActionInputs,
  assertActionInputs,
} from '../specs/workflow/contracts.mjs';

import { PreconditionError, WorkflowError } from '../specs/workflow/errors.mjs';

describe('ActionContract and GateContract interfaces (AC1)', () => {
  class MockAction extends ActionContract {
    get id() { return 'mock-action'; }
    get description() { return 'A mock action for testing'; }
    async check(context) {
      return new ActionCheckResult({
        actionId: this.id,
        requiredInputs: [
          { name: 'message', type: 'string', required: true, description: 'Message' },
        ],
        context: { repoRoot: context.repoRoot },
      });
    }
    async execute(inputs, context) {
      assertActionInputs(
        [{ name: 'message', type: 'string', required: true, description: 'Message' }],
        inputs,
        this.id
      );
      return new ActionExecuteResult({
        actionId: this.id,
        success: true,
        outputs: { message: inputs.message },
        summary: `Executed with message: ${inputs.message}`,
      });
    }
  }

  test('ActionContract base class throws when methods are unimplemented', async () => {
    class UnimplementedAction extends ActionContract {}
    const action = new UnimplementedAction();

    assert.throws(() => action.id, /must implement get id\(\)/);
    assert.throws(() => action.description, /must implement get description\(\)/);
    await assert.rejects(async () => await action.check({}), /must implement check\(context\)/);
    await assert.rejects(async () => await action.execute({}, {}), /must implement execute\(inputs, context\)/);
  });

  test('GateContract base class throws when methods are unimplemented', async () => {
    class UnimplementedGate extends GateContract {}
    const gate = new UnimplementedGate();

    assert.throws(() => gate.type, /must implement get type\(\)/);
    await assert.rejects(async () => await gate.inspect({}, {}), /must implement inspect\(config, context\)/);
    await assert.rejects(async () => await gate.verify({}, {}), /must implement verify\(config, context\)/);
  });

  test('MockAction implements contract and executes successfully with valid inputs', async () => {
    const action = new MockAction();
    assert.equal(action.id, 'mock-action');
    assert.equal(action.description, 'A mock action for testing');

    const checkResult = await action.check({ repoRoot: '/repo' });
    assert.ok(checkResult instanceof ActionCheckResult);
    assert.equal(checkResult.actionId, 'mock-action');
    assert.deepEqual(checkResult.context, { repoRoot: '/repo' });
    assert.equal(checkResult.requiredInputs.length, 1);

    const execResult = await action.execute({ message: 'Hello' }, { repoRoot: '/repo' });
    assert.ok(execResult instanceof ActionExecuteResult);
    assert.equal(execResult.success, true);
    assert.equal(execResult.outputs.message, 'Hello');
  });
});

describe('validateActionInputs parameter schema validation (AC2, AC5)', () => {
  const schemas = [
    {
      name: 'commitMessage',
      type: 'string',
      required: true,
      description: 'Commit message',
      constraints: { minLength: 5, maxLength: 50 },
    },
    {
      name: 'include',
      type: 'array',
      required: true,
      description: 'Files to include',
      constraints: { minLength: 1, itemType: 'string' },
    },
    {
      name: 'retryCount',
      type: 'number',
      required: false,
      description: 'Optional retry count',
      constraints: { minValue: 1, maxValue: 5 },
    },
    {
      name: 'mode',
      type: 'string',
      required: false,
      description: 'Operation mode',
      constraints: { allowedValues: ['fast', 'thorough'] },
    },
    {
      name: 'dryRun',
      type: 'boolean',
      required: false,
      description: 'Dry run flag',
    },
    {
      name: 'options',
      type: 'object',
      required: false,
      description: 'Additional options object',
    },
  ];

  test('passes with valid required and optional inputs', () => {
    const result = validateActionInputs(schemas, {
      commitMessage: 'feat: add contracts',
      include: ['src/index.js'],
      retryCount: 3,
      mode: 'fast',
      dryRun: true,
      options: { verbose: true },
    });
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  test('passes with only valid required inputs', () => {
    const result = validateActionInputs(schemas, {
      commitMessage: 'feat: add contracts',
      include: ['src/index.js'],
    });
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  test('fails when required input is missing', () => {
    const result = validateActionInputs(schemas, {
      include: ['src/index.js'],
    });
    assert.equal(result.valid, false);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].field, 'commitMessage');
    assert.equal(result.errors[0].code, 'REQUIRED_FIELD_MISSING');
  });

  test('fails when required string input is empty string', () => {
    const result = validateActionInputs(schemas, {
      commitMessage: '   ',
      include: ['src/index.js'],
    });
    assert.equal(result.valid, false);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].field, 'commitMessage');
    assert.equal(result.errors[0].code, 'REQUIRED_FIELD_EMPTY');
  });

  test('fails when type constraint is violated', () => {
    const result = validateActionInputs(schemas, {
      commitMessage: 12345, // should be string
      include: 'src/index.js', // should be array
      retryCount: 'three', // should be number
      dryRun: 'yes', // should be boolean
      options: ['not', 'an', 'object'], // should be plain object
    });
    assert.equal(result.valid, false);
    assert.equal(result.errors.length, 5);
    assert.ok(result.errors.some(e => e.field === 'commitMessage' && e.code === 'INVALID_TYPE'));
    assert.ok(result.errors.some(e => e.field === 'include' && e.code === 'INVALID_TYPE'));
    assert.ok(result.errors.some(e => e.field === 'retryCount' && e.code === 'INVALID_TYPE'));
    assert.ok(result.errors.some(e => e.field === 'dryRun' && e.code === 'INVALID_TYPE'));
    assert.ok(result.errors.some(e => e.field === 'options' && e.code === 'INVALID_TYPE'));
  });

  test('fails when string minLength / maxLength constraints are violated', () => {
    const shortResult = validateActionInputs(schemas, {
      commitMessage: 'hi',
      include: ['src/index.js'],
    });
    assert.equal(shortResult.valid, false);
    assert.ok(shortResult.errors.some(e => e.field === 'commitMessage' && e.code === 'CONSTRAINT_VIOLATION'));

    const longResult = validateActionInputs(schemas, {
      commitMessage: 'a'.repeat(55),
      include: ['src/index.js'],
    });
    assert.equal(longResult.valid, false);
    assert.ok(longResult.errors.some(e => e.field === 'commitMessage' && e.code === 'CONSTRAINT_VIOLATION'));
  });

  test('fails when array minLength or itemType constraint is violated', () => {
    const emptyArrayResult = validateActionInputs(schemas, {
      commitMessage: 'valid commit',
      include: [],
    });
    assert.equal(emptyArrayResult.valid, false);
    assert.ok(emptyArrayResult.errors.some(e => e.field === 'include' && e.code === 'CONSTRAINT_VIOLATION'));

    const badItemResult = validateActionInputs(schemas, {
      commitMessage: 'valid commit',
      include: [123],
    });
    assert.equal(badItemResult.valid, false);
    assert.ok(badItemResult.errors.some(e => e.field === 'include[0]' && e.code === 'INVALID_ITEM_TYPE'));
  });

  test('fails when allowedValues constraint is violated', () => {
    const result = validateActionInputs(schemas, {
      commitMessage: 'valid commit',
      include: ['src/index.js'],
      mode: 'invalid-mode',
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.field === 'mode' && e.code === 'CONSTRAINT_VIOLATION'));
  });

  test('validates regex pattern constraints on string inputs', () => {
    const patternSchema = [
      {
        name: 'branch',
        type: 'string',
        required: true,
        constraints: { pattern: '^feature/[a-z-]+$' },
      },
    ];

    const valid = validateActionInputs(patternSchema, { branch: 'feature/workflow-foundation' });
    assert.equal(valid.valid, true);

    const invalid = validateActionInputs(patternSchema, { branch: 'BUGFIX/123' });
    assert.equal(invalid.valid, false);
    assert.ok(invalid.errors.some(e => e.field === 'branch' && e.code === 'CONSTRAINT_VIOLATION'));
  });
});

describe('PreconditionError and fail-closed assertion (AC3)', () => {
  const schemas = [
    { name: 'include', type: 'array', required: true, description: 'File list' },
  ];

  test('assertActionInputs throws structured PreconditionError when inputs are invalid', () => {
    assert.throws(
      () => assertActionInputs(schemas, {}, 'commit-and-push'),
      (err) => {
        assert.ok(err instanceof PreconditionError);
        assert.ok(err instanceof WorkflowError);
        assert.equal(err.actionId, 'commit-and-push');
        assert.equal(err.errors.length, 1);
        assert.equal(err.errors[0].field, 'include');
        assert.equal(err.errors[0].code, 'REQUIRED_FIELD_MISSING');
        assert.match(err.message, /Precondition validation failed for action 'commit-and-push'/);
        return true;
      }
    );
  });

  test('assertActionInputs passes without throwing when inputs are valid', () => {
    assert.doesNotThrow(() => {
      assertActionInputs(schemas, { include: ['file.txt'] }, 'commit-and-push');
    });
  });
});

describe('ActionCheckResult and ActionExecuteResult separation (AC4)', () => {
  test('ActionCheckResult strictly separates requiredInputs (schema) from context (facts)', () => {
    const check = new ActionCheckResult({
      actionId: 'commit-and-push',
      requiredInputs: [
        { name: 'commitMessage', type: 'string', required: true, description: 'Message' },
      ],
      context: {
        changedFiles: ['src/a.js', 'src/b.js'],
        stagedFiles: [],
        branch: 'feature/test',
      },
      ready: true,
      summary: '2 files modified',
    });

    const json = check.toJSON();
    assert.equal(json.actionId, 'commit-and-push');
    assert.deepEqual(json.requiredInputs, [
      { name: 'commitMessage', type: 'string', required: true, description: 'Message' },
    ]);
    assert.deepEqual(json.context, {
      changedFiles: ['src/a.js', 'src/b.js'],
      stagedFiles: [],
      branch: 'feature/test',
    });
    assert.equal(json.ready, true);
    assert.equal(json.summary, '2 files modified');
  });

  test('ActionExecuteResult structure formats outputs and summary cleanly', () => {
    const exec = new ActionExecuteResult({
      actionId: 'commit-and-push',
      success: true,
      outputs: { commitSha: 'a1b2c3d' },
      summary: 'Committed 1 file',
    });

    const json = exec.toJSON();
    assert.equal(json.actionId, 'commit-and-push');
    assert.equal(json.success, true);
    assert.deepEqual(json.outputs, { commitSha: 'a1b2c3d' });
    assert.equal(json.summary, 'Committed 1 file');
  });
});
