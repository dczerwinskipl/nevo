// Tests for ActionContract, input schema validation, PreconditionError, and context models.
// Run: node --test tools/tests/workflow-contracts.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  ActionContract,
  GateContract,
  ActionCheckResult,
  ActionExecuteResult,
  validateActionParameterSchemas,
  assertActionParameterSchemas,
  validateActionInputs,
  assertActionInputs,
} from '../specs/workflow/contracts.mjs';

import { PreconditionError, WorkflowError } from '../specs/workflow/errors.mjs';

describe('ActionContract authoritative fail-closed execution boundary (AC1, Review Finding 1 & 4)', () => {
  let executedValidatedCount = 0;

  class SafeAction extends ActionContract {
    constructor(readyFlag = true) {
      super();
      this.readyFlag = readyFlag;
    }

    get id() { return 'safe-action'; }
    get description() { return 'A safe action'; }

    async check(context) {
      return new ActionCheckResult({
        actionId: this.id,
        requiredInputs: [
          { name: 'message', type: 'string', required: true, description: 'Commit message' },
        ],
        context: { repoRoot: context.repoRoot },
        ready: this.readyFlag,
        summary: this.readyFlag ? 'Prerequisites met' : 'Repo is dirty',
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

  test('subclass overriding execute() is rejected at construction to prevent validation bypass', () => {
    class RogueAction extends ActionContract {
      get id() { return 'rogue-action'; }
      get description() { return 'Bypasses validation'; }
      async execute(inputs, context) {
        return { success: true };
      }
    }

    assert.throws(
      () => new RogueAction(),
      (err) => {
        assert.ok(err instanceof WorkflowError);
        assert.match(err.message, /must not override execute\(\)\. Implement executeValidated\(\) instead/);
        return true;
      }
    );
  });

  test('execute(inputs, context) automatically validates inputs and delegates to executeValidated when ready', async () => {
    executedValidatedCount = 0;
    const action = new SafeAction(true);

    const execResult = await action.execute({ message: 'Hello deterministic' }, { repoRoot: '/repo' });
    assert.ok(execResult instanceof ActionExecuteResult);
    assert.equal(execResult.success, true);
    assert.equal(execResult.outputs.echoed, 'Hello deterministic');
    assert.equal(executedValidatedCount, 1);
  });

  test('execute(inputs, context) stops and throws PreconditionError when ready is false (Finding 1A)', async () => {
    executedValidatedCount = 0;
    const unreadyAction = new SafeAction(false);

    await assert.rejects(
      async () => await unreadyAction.execute({ message: 'Valid' }, { repoRoot: '/repo' }),
      (err) => {
        assert.ok(err instanceof PreconditionError);
        assert.equal(err.actionId, 'safe-action');
        assert.ok(err.errors.some(e => e.field === '$action' && e.code === 'ACTION_NOT_READY'));
        assert.match(err.message, /is not ready for execution/);
        return true;
      }
    );

    assert.equal(executedValidatedCount, 0, 'executeValidated must NEVER run when ready is false');
  });

  test('execute(inputs, context) rejects missing required inputs BEFORE executeValidated runs', async () => {
    executedValidatedCount = 0;
    const action = new SafeAction(true);

    await assert.rejects(
      async () => await action.execute({}, { repoRoot: '/repo' }),
      (err) => {
        assert.ok(err instanceof PreconditionError);
        assert.equal(err.actionId, 'safe-action');
        assert.ok(err.errors.some(e => e.field === 'message' && e.code === 'REQUIRED_FIELD_MISSING'));
        return true;
      }
    );

    assert.equal(executedValidatedCount, 0, 'executeValidated must NEVER run when inputs are invalid');
  });

  test('execute(inputs, context) rejects unexpected undeclared inputs BEFORE executeValidated runs', async () => {
    executedValidatedCount = 0;
    const action = new SafeAction(true);

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

  test('execute(inputs, context) throws WorkflowError if check() returns mismatched actionId (Finding 4)', async () => {
    class MismatchedCheckAction extends ActionContract {
      get id() { return 'actual-action'; }
      get description() { return 'Mismatched check'; }
      async check() {
        return new ActionCheckResult({
          actionId: 'different-action',
          requiredInputs: [],
          ready: true,
        });
      }
      async executeValidated() { return new ActionExecuteResult({ actionId: this.id, success: true }); }
    }

    const action = new MismatchedCheckAction();
    await assert.rejects(
      async () => await action.execute({}, {}),
      (err) => {
        assert.ok(err instanceof WorkflowError);
        assert.match(err.message, /mismatched actionId 'different-action'/);
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

  test('execute(inputs, context) throws WorkflowError if executeValidated returns mismatched actionId (Finding 4)', async () => {
    class MismatchedExecAction extends ActionContract {
      get id() { return 'actual-action'; }
      get description() { return 'Mismatched execute'; }
      async check() { return new ActionCheckResult({ actionId: this.id }); }
      async executeValidated() {
        return new ActionExecuteResult({
          actionId: 'wrong-action',
          success: true,
        });
      }
    }

    const action = new MismatchedExecAction();
    await assert.rejects(
      async () => await action.execute({}, {}),
      (err) => {
        assert.ok(err instanceof WorkflowError);
        assert.match(err.message, /mismatched actionId 'wrong-action'/);
        return true;
      }
    );
  });
});

describe('validateActionParameterSchemas producer contract validation (AC2, Review Finding 2)', () => {
  test('passes with valid complete parameter schemas (Constraint C3)', () => {
    const schemas = [
      { name: 'message', type: 'string', required: true, description: 'Commit message' },
      { name: 'include', type: 'array', required: true, description: 'Files to include', constraints: { itemType: 'string', minLength: 1 } },
      { name: 'retries', type: 'number', required: false, description: 'Retry count', constraints: { minValue: 0, maxValue: 5 } },
    ];
    const result = validateActionParameterSchemas(schemas);
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  test('rejects schema missing required boolean property (Constraint C3)', () => {
    const result1 = validateActionParameterSchemas([{ name: 'param', type: 'string', description: 'Desc' }]);
    assert.equal(result1.valid, false);
    assert.ok(result1.errors.some(e => e.code === 'INVALID_SCHEMA_REQUIRED'));

    const result2 = validateActionParameterSchemas([{ name: 'param', type: 'string', required: 'true', description: 'Desc' }]);
    assert.equal(result2.valid, false);
    assert.ok(result2.errors.some(e => e.code === 'INVALID_SCHEMA_REQUIRED'));
  });

  test('rejects schema missing or empty description (Constraint C3)', () => {
    const result1 = validateActionParameterSchemas([{ name: 'param', type: 'string', required: true }]);
    assert.equal(result1.valid, false);
    assert.ok(result1.errors.some(e => e.code === 'INVALID_SCHEMA_DESCRIPTION'));

    const result2 = validateActionParameterSchemas([{ name: 'param', type: 'string', required: true, description: '   ' }]);
    assert.equal(result2.valid, false);
    assert.ok(result2.errors.some(e => e.code === 'INVALID_SCHEMA_DESCRIPTION'));
  });

  test('rejects incompatible constraint definitions', () => {
    // pattern on number
    const resultPattern = validateActionParameterSchemas([
      { name: 'count', type: 'number', required: true, description: 'Count', constraints: { pattern: '^[0-9]+$' } },
    ]);
    assert.equal(resultPattern.valid, false);
    assert.ok(resultPattern.errors.some(e => e.code === 'INCOMPATIBLE_CONSTRAINT'));

    // itemType on string
    const resultItemType = validateActionParameterSchemas([
      { name: 'text', type: 'string', required: true, description: 'Text', constraints: { itemType: 'string' } },
    ]);
    assert.equal(resultItemType.valid, false);
    assert.ok(resultItemType.errors.some(e => e.code === 'INCOMPATIBLE_CONSTRAINT'));

    // minValue on array
    const resultMinVal = validateActionParameterSchemas([
      { name: 'list', type: 'array', required: true, description: 'List', constraints: { minValue: 1 } },
    ]);
    assert.equal(resultMinVal.valid, false);
    assert.ok(resultMinVal.errors.some(e => e.code === 'INCOMPATIBLE_CONSTRAINT'));

    // minLength on number
    const resultMinLen = validateActionParameterSchemas([
      { name: 'val', type: 'number', required: true, description: 'Val', constraints: { minLength: 1 } },
    ]);
    assert.equal(resultMinLen.valid, false);
    assert.ok(resultMinLen.errors.some(e => e.code === 'INCOMPATIBLE_CONSTRAINT'));

    // minValue > maxValue
    const resultInvertedVal = validateActionParameterSchemas([
      { name: 'range', type: 'number', required: true, description: 'Range', constraints: { minValue: 10, maxValue: 2 } },
    ]);
    assert.equal(resultInvertedVal.valid, false);
    assert.ok(resultInvertedVal.errors.some(e => e.code === 'INVALID_SCHEMA_CONSTRAINT' && e.message.includes('cannot be greater than')));

    // minLength > maxLength
    const resultInvertedLen = validateActionParameterSchemas([
      { name: 'len', type: 'string', required: true, description: 'String', constraints: { minLength: 10, maxLength: 2 } },
    ]);
    assert.equal(resultInvertedLen.valid, false);
    assert.ok(resultInvertedLen.errors.some(e => e.code === 'INVALID_SCHEMA_CONSTRAINT' && e.message.includes('cannot be greater than')));
  });
});

describe('validateActionInputs schema and parameter validation (AC2, AC5)', () => {
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
      commitMessage: 12345,
      include: 'src/index.js',
      retryCount: 'three',
      dryRun: 'yes',
      options: ['not', 'an', 'object'],
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
        description: 'Branch name',
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

describe('ActionCheckResult and ActionExecuteResult hardened constructor contracts (AC4, Review Finding 1 & 2)', () => {
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

  test('ActionCheckResult rejects malformed requiredInputs at the producer boundary (Finding 2)', () => {
    // Missing description
    assert.throws(
      () => new ActionCheckResult({
        actionId: 'test',
        requiredInputs: [{ name: 'msg', type: 'string', required: true }],
      }),
      /must define a non-empty string 'description'/
    );

    // Missing required flag
    assert.throws(
      () => new ActionCheckResult({
        actionId: 'test',
        requiredInputs: [{ name: 'msg', type: 'string', description: 'desc' }],
      }),
      /must explicitly define boolean 'required'/
    );

    // Incompatible constraints
    assert.throws(
      () => new ActionCheckResult({
        actionId: 'test',
        requiredInputs: [{ name: 'msg', type: 'number', required: true, description: 'desc', constraints: { pattern: '.*' } }],
      }),
      /Constraint 'pattern' is only applicable to parameters of type 'string'/
    );
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
