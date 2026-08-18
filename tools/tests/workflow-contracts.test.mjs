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

describe('ActionContract authoritative fail-closed execution boundary (AC1, Review Finding 1)', () => {
  let executedValidatedCount = 0;

  class SafeAction extends ActionContract {
    get id() { return 'safe-action'; }
    get description() { return 'A safe action'; }

    async check(context) {
      return new ActionCheckResult({
        actionId: this.id,
        requiredInputs: [
          { name: 'message', type: 'string', required: true, description: 'Commit message' },
        ],
        context: { repoRoot: context.repoRoot },
      });
    }

    async executeValidated(inputs, context) {
      executedValidatedCount++;
      return new ActionExecuteResult({
        actionId: this.id,
        success: true,
        outputs: { echoed: inputs.message },
        summary: `Echoed: ${inputs.message}`,
      });
    }
  }

  test('ActionContract base class throws when methods are unimplemented', async () => {
    class UnimplementedAction extends ActionContract {}
    const action = new UnimplementedAction();

    assert.throws(() => action.id, /must implement get id\(\)/);
    assert.throws(() => action.description, /must implement get description\(\)/);
    await assert.rejects(async () => await action.check({}), /must implement check\(context\)/);
    await assert.rejects(async () => await action.executeValidated({}, {}), /must implement executeValidated\(inputs, context\)/);
  });

  test('GateContract base class throws when methods are unimplemented', async () => {
    class UnimplementedGate extends GateContract {}
    const gate = new UnimplementedGate();

    assert.throws(() => gate.type, /must implement get type\(\)/);
    await assert.rejects(async () => await gate.inspect({}, {}), /must implement inspect\(config, context\)/);
    await assert.rejects(async () => await gate.verify({}, {}), /must implement verify\(config, context\)/);
  });

  test('execute(inputs, context) automatically validates inputs and delegates to executeValidated', async () => {
    executedValidatedCount = 0;
    const action = new SafeAction();

    const execResult = await action.execute({ message: 'Hello deterministic' }, { repoRoot: '/repo' });
    assert.ok(execResult instanceof ActionExecuteResult);
    assert.equal(execResult.success, true);
    assert.equal(execResult.outputs.echoed, 'Hello deterministic');
    assert.equal(executedValidatedCount, 1);
  });

  test('execute(inputs, context) rejects missing required inputs BEFORE executeValidated runs', async () => {
    executedValidatedCount = 0;
    const action = new SafeAction();

    await assert.rejects(
      async () => await action.execute({}, { repoRoot: '/repo' }),
      (err) => {
        assert.ok(err instanceof PreconditionError);
        assert.equal(err.actionId, 'safe-action');
        assert.ok(err.errors.some(e => e.field === 'message' && e.code === 'REQUIRED_FIELD_MISSING'));
        return true;
      }
    );

    assert.equal(executedValidatedCount, 0, 'executeValidated must NEVER be invoked when inputs are invalid');
  });

  test('execute(inputs, context) rejects unexpected undeclared inputs BEFORE executeValidated runs', async () => {
    executedValidatedCount = 0;
    const action = new SafeAction();

    await assert.rejects(
      async () => await action.execute({ message: 'Valid', rogueField: 'unexpected' }, { repoRoot: '/repo' }),
      (err) => {
        assert.ok(err instanceof PreconditionError);
        assert.ok(err.errors.some(e => e.field === 'rogueField' && e.code === 'UNEXPECTED_INPUT_PARAMETER'));
        return true;
      }
    );

    assert.equal(executedValidatedCount, 0);
  });

  test('execute(inputs, context) throws WorkflowError if check() returns malformed result', async () => {
    class BadCheckAction extends ActionContract {
      get id() { return 'bad-check'; }
      get description() { return 'Bad check'; }
      async check() { return { notAnActionCheckResult: true }; }
      async executeValidated() { return new ActionExecuteResult({ actionId: this.id, success: true }); }
    }

    const action = new BadCheckAction();
    await assert.rejects(
      async () => await action.execute({}, {}),
      (err) => {
        assert.ok(err instanceof WorkflowError);
        assert.match(err.message, /check\(context\) must return an ActionCheckResult instance/);
        return true;
      }
    );
  });

  test('execute(inputs, context) throws WorkflowError if executeValidated returns malformed result', async () => {
    class BadExecuteAction extends ActionContract {
      get id() { return 'bad-exec'; }
      get description() { return 'Bad exec'; }
      async check() { return new ActionCheckResult({ actionId: this.id }); }
      async executeValidated() { return { success: true }; }
    }

    const action = new BadExecuteAction();
    await assert.rejects(
      async () => await action.execute({}, {}),
      (err) => {
        assert.ok(err instanceof WorkflowError);
        assert.match(err.message, /executeValidated\(inputs, context\) must return an ActionExecuteResult instance/);
        return true;
      }
    );
  });
});

describe('validateActionInputs schema hardening and parameter validation (AC2, AC5, Review Finding 1)', () => {
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

  test('rejects undeclared input keys (deterministic execution)', () => {
    const result = validateActionInputs(schemas, {
      commitMessage: 'feat: valid commit message',
      include: ['src/index.js'],
      unexpectedKey: 'some-value',
      anotherExtraKey: 123,
    });
    assert.equal(result.valid, false);
    assert.equal(result.errors.length, 2);
    assert.ok(result.errors.some(e => e.field === 'unexpectedKey' && e.code === 'UNEXPECTED_INPUT_PARAMETER'));
    assert.ok(result.errors.some(e => e.field === 'anotherExtraKey' && e.code === 'UNEXPECTED_INPUT_PARAMETER'));
  });

  test('rejects non-object caller inputs', () => {
    const result1 = validateActionInputs(schemas, 'not-an-object');
    assert.equal(result1.valid, false);
    assert.ok(result1.errors.some(e => e.code === 'INVALID_INPUTS_OBJECT'));

    const result2 = validateActionInputs(schemas, ['array', 'input']);
    assert.equal(result2.valid, false);
    assert.ok(result2.errors.some(e => e.code === 'INVALID_INPUTS_OBJECT'));
  });

  test('fails closed when schemas is not an array', () => {
    const result = validateActionInputs('not-an-array', {});
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.code === 'INVALID_SCHEMA'));
  });

  test('fails closed when schema entry is not an object', () => {
    const result = validateActionInputs(['string-entry'], {});
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.code === 'INVALID_SCHEMA_ENTRY'));
  });

  test('fails closed when schema entry is missing name', () => {
    const result = validateActionInputs([{ type: 'string' }], {});
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.code === 'INVALID_SCHEMA_NAME'));
  });

  test('fails closed on duplicate parameter names in schema', () => {
    const result = validateActionInputs([
      { name: 'paramA', type: 'string' },
      { name: 'paramA', type: 'number' },
    ], {});
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.code === 'DUPLICATE_SCHEMA_PARAMETER'));
  });

  test('fails closed on invalid schema type', () => {
    const result = validateActionInputs([
      { name: 'badTypeParam', type: 'unsupported-type' },
    ], {});
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.code === 'INVALID_SCHEMA_TYPE'));
  });

  test('fails closed on non-boolean schema required property', () => {
    const result = validateActionInputs([
      { name: 'param', type: 'string', required: 'yes' },
    ], {});
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.code === 'INVALID_SCHEMA_REQUIRED'));
  });

  test('fails closed on non-object schema constraints property', () => {
    const result = validateActionInputs([
      { name: 'param', type: 'string', constraints: 'not-an-object' },
    ], {});
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.code === 'INVALID_SCHEMA_CONSTRAINTS'));
  });

  test('fails closed on invalid constraints.itemType', () => {
    const result = validateActionInputs([
      { name: 'param', type: 'array', constraints: { itemType: 'invalid-type' } },
    ], {});
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.code === 'INVALID_SCHEMA_CONSTRAINT'));
  });

  test('fails closed on invalid regex pattern without crashing', () => {
    const result = validateActionInputs([
      { name: 'param', type: 'string', constraints: { pattern: '[unclosed-bracket' } },
    ], { param: 'test' });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.code === 'INVALID_SCHEMA_PATTERN'));
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

describe('ActionCheckResult and ActionExecuteResult hardened constructor contracts (AC4, Review Finding 1)', () => {
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

  test('ActionCheckResult rejects malformed parameters without silent coercion', () => {
    assert.throws(() => new ActionCheckResult({ actionId: '' }), /requires a non-empty string 'actionId'/);
    assert.throws(() => new ActionCheckResult({ actionId: 'test', requiredInputs: 'not-an-array' }), /'requiredInputs' must be an array/);
    assert.throws(() => new ActionCheckResult({ actionId: 'test', context: 'not-an-object' }), /'context' must be a plain object/);
    assert.throws(() => new ActionCheckResult({ actionId: 'test', ready: 'false' }), /'ready' must be a strict boolean/);
    assert.throws(() => new ActionCheckResult({ actionId: 'test', ready: 0 }), /'ready' must be a strict boolean/);
    assert.throws(() => new ActionCheckResult({ actionId: 'test', summary: 123 }), /'summary' must be a string/);
    assert.throws(() => new ActionCheckResult({ actionId: 'test', details: 'not-an-object' }), /'details' must be a plain object/);
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

  test('ActionExecuteResult rejects malformed parameters without silent coercion', () => {
    assert.throws(() => new ActionExecuteResult({ actionId: '' }), /requires a non-empty string 'actionId'/);
    assert.throws(() => new ActionExecuteResult({ actionId: 'test', success: 'false' }), /'success' must be a strict boolean/);
    assert.throws(() => new ActionExecuteResult({ actionId: 'test', success: 1 }), /'success' must be a strict boolean/);
    assert.throws(() => new ActionExecuteResult({ actionId: 'test', outputs: 'not-an-object' }), /'outputs' must be a plain object/);
    assert.throws(() => new ActionExecuteResult({ actionId: 'test', summary: 123 }), /'summary' must be a string/);
  });
});
