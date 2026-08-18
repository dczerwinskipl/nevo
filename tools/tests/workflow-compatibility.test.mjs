// Tests for workflow definition parser, schema validation, and compatibility mode resolution.
// Run: node --test tools/tests/workflow-compatibility.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveWorkflowMode,
  DEFAULT_WORKFLOW_MODE,
  DEFAULT_WORKFLOW_VERSION,
} from '../specs/workflow/compatibility.mjs';

import {
  loadWorkflowDefinition,
  parseWorkflowDefinition,
  listBuiltInWorkflowDefinitions,
} from '../specs/workflow/definitions/loader.mjs';

import {
  validateWorkflowDefinition,
  validateGateDefinition,
  validateActionReference,
} from '../specs/workflow/definitions/schema.mjs';

import { validateWorkflowConfiguration, validateSpecs } from '../specs/validation.mjs';
import { WorkflowDefinitionError, WorkflowError } from '../specs/workflow/errors.mjs';

describe('Workflow compatibility mode resolution (AC4, AC5)', () => {
  test('manifests omitting workflow metadata cleanly resolve to default legacy mode', () => {
    const change = { id: 'sample-change', title: 'Sample' };
    const resolved = resolveWorkflowMode(change);
    assert.deepEqual(resolved, {
      mode: 'legacy',
      version: 1,
      definition: 'standard',
      isExplicit: false,
    });
  });

  test('manifest with workflow object resolves to explicit deterministic mode', () => {
    const change = {
      id: 'deterministic-spec',
      workflow: { mode: 'deterministic', version: 2, definition: 'architectural' },
    };
    const resolved = resolveWorkflowMode(change);
    assert.deepEqual(resolved, {
      mode: 'deterministic',
      version: 2,
      definition: 'architectural',
      isExplicit: true,
    });
  });

  test('manifest with shorthand workflow_mode resolves cleanly', () => {
    const change = {
      id: 'shorthand-spec',
      type: 'architectural',
      workflow_mode: 'deterministic',
    };
    const resolved = resolveWorkflowMode(change);
    assert.deepEqual(resolved, {
      mode: 'deterministic',
      version: 1,
      definition: 'architectural',
      isExplicit: true,
    });
  });

  test('options.forceDeterministic overrides manifest state for testing', () => {
    const legacyChange = { id: 'legacy-change' };
    const resolved = resolveWorkflowMode(legacyChange, { forceDeterministic: true });
    assert.equal(resolved.mode, 'deterministic');
    assert.equal(resolved.isExplicit, true);
  });

  test('options.deterministicFlow alias overrides manifest state for testing', () => {
    const legacyChange = { id: 'legacy-change' };
    const resolved = resolveWorkflowMode(legacyChange, { deterministicFlow: true });
    assert.equal(resolved.mode, 'deterministic');
    assert.equal(resolved.isExplicit, true);
  });

  test('resolveWorkflowMode throws WorkflowError when both workflow and workflow_mode are declared without override', () => {
    const dualChange = {
      id: 'dual-spec',
      workflow: { mode: 'deterministic' },
      workflow_mode: 'deterministic',
    };
    assert.throws(
      () => resolveWorkflowMode(dualChange),
      (err) => {
        assert.ok(err instanceof WorkflowError);
        assert.match(err.message, /Ambiguous workflow configuration/);
        return true;
      }
    );
  });
});

describe('Manifest workflow schema validation (AC2, AC3, Review Finding 3)', () => {
  test('accepts change without workflow metadata', () => {
    const errors = [];
    validateWorkflowConfiguration({ id: 'clean' }, errors, 'test-file.yaml');
    assert.deepEqual(errors, []);
  });

  test('accepts canonical workflow object only', () => {
    const errors = [];
    validateWorkflowConfiguration({
      id: 'valid-obj',
      workflow: { mode: 'deterministic', version: 1, definition: 'standard' },
    }, errors, 'test-obj.yaml');
    assert.deepEqual(errors, []);
  });

  test('accepts shorthand workflow_mode only', () => {
    const errors = [];
    validateWorkflowConfiguration({
      id: 'valid-short',
      workflow_mode: 'legacy',
    }, errors, 'test-short.yaml');
    assert.deepEqual(errors, []);
  });

  test('rejects dual configuration when both workflow and workflow_mode are present with identical values', () => {
    const errors = [];
    validateWorkflowConfiguration({
      id: 'dual-identical',
      workflow: { mode: 'deterministic', version: 1 },
      workflow_mode: 'deterministic',
    }, errors, 'specs/active/dual/change.yaml');
    assert.equal(errors.length, 1);
    assert.match(
      errors[0],
      /specs\/active\/dual\/change\.yaml: cannot declare both 'workflow' and shorthand 'workflow_mode' — choose one configuration form/
    );
  });

  test('rejects dual configuration when both workflow and workflow_mode are present with conflicting values', () => {
    const errors = [];
    validateWorkflowConfiguration({
      id: 'dual-conflicting',
      workflow: { mode: 'deterministic', version: 1 },
      workflow_mode: 'legacy',
    }, errors, 'specs/active/conflict/change.yaml');
    assert.equal(errors.length, 1);
    assert.match(
      errors[0],
      /specs\/active\/conflict\/change\.yaml: cannot declare both 'workflow' and shorthand 'workflow_mode' — choose one configuration form/
    );
  });

  test('rejects non-object workflow field', () => {
    const errors = [];
    validateWorkflowConfiguration({
      id: 'bad-type',
      workflow: 'deterministic',
    }, errors, 'test.yaml');
    assert.equal(errors.length, 1);
    assert.match(errors[0], /workflow must be an object/);
  });

  test('rejects invalid workflow.mode with path-specific message', () => {
    const errors = [];
    validateWorkflowConfiguration({
      id: 'invalid-mode',
      workflow: { mode: 'magic', version: 1 },
    }, errors, 'specs/active/bad/change.yaml');
    assert.equal(errors.length, 1);
    assert.match(errors[0], /specs\/active\/bad\/change\.yaml: workflow\.mode must be 'legacy' or 'deterministic', got 'magic'/);
  });

  test('rejects invalid workflow_mode with path-specific message', () => {
    const errors = [];
    validateWorkflowConfiguration({
      id: 'invalid-short',
      workflow_mode: 'unsupported',
    }, errors, 'specs/active/bad/change.yaml');
    assert.equal(errors.length, 1);
    assert.match(errors[0], /specs\/active\/bad\/change\.yaml: workflow_mode must be 'legacy' or 'deterministic', got 'unsupported'/);
  });

  test('rejects invalid workflow.version (non-positive or non-integer)', () => {
    const errors1 = [];
    validateWorkflowConfiguration({
      workflow: { mode: 'deterministic', version: 0 },
    }, errors1, 'test.yaml');
    assert.equal(errors1.length, 1);
    assert.match(errors1[0], /workflow\.version must be a positive integer/);

    const errors2 = [];
    validateWorkflowConfiguration({
      workflow: { mode: 'deterministic', version: -2 },
    }, errors2, 'test.yaml');
    assert.equal(errors2.length, 1);

    const errors3 = [];
    validateWorkflowConfiguration({
      workflow: { mode: 'deterministic', version: 1.5 },
    }, errors3, 'test.yaml');
    assert.equal(errors3.length, 1);
  });

  test('rejects empty workflow.definition string', () => {
    const errors = [];
    validateWorkflowConfiguration({
      workflow: { mode: 'deterministic', version: 1, definition: '   ' },
    }, errors, 'test.yaml');
    assert.equal(errors.length, 1);
    assert.match(errors[0], /workflow\.definition must be a non-empty string/);
  });
});

describe('Workflow definition parser, loader, and gate validation (AC1, Review Finding 2)', () => {
  test('built-in definitions exist and parse cleanly', () => {
    const definitions = listBuiltInWorkflowDefinitions();
    assert.ok(definitions.includes('standard'), 'standard workflow definition exists');
    assert.ok(definitions.includes('architectural'), 'architectural workflow definition exists');
    assert.ok(definitions.includes('small'), 'small workflow definition exists');
    assert.ok(definitions.includes('exploratory'), 'exploratory workflow definition exists');

    for (const name of definitions) {
      const def = loadWorkflowDefinition(name);
      assert.ok(def.id);
      assert.ok(def.steps);
      assert.ok(Object.keys(def.steps).length > 0);
    }
  });

  test('standard definition contains expected steps, actions, gates, and transitions', () => {
    const standardDef = loadWorkflowDefinition('standard');
    assert.equal(standardDef.id, 'standard-v1');
    assert.equal(standardDef.type, 'standard');
    assert.ok(standardDef.steps.implementation);

    const impl = standardDef.steps.implementation;
    assert.deepEqual(impl.actions, [{ id: 'implement-task' }]);
    assert.equal(impl.exitGates.length, 2);
    assert.deepEqual(impl.exitGates[0], { type: 'command', action: 'test' });
    assert.deepEqual(impl.exitGates[1], { type: 'human', required: true });
    assert.deepEqual(impl.finalize, [{ id: 'verify-task-output' }, { id: 'commit-and-push' }]);
    assert.deepEqual(impl.transitions, [{ to: 'verified' }]);
  });

  test('parseWorkflowDefinition parses valid YAML definition string', () => {
    const yaml = `
id: custom-v1
title: "Custom Workflow"
steps:
  step1:
    actions:
      - id: custom-action
    exitGates:
      - type: command
        action: test
    transitions:
      - to: step2
`;
    const def = parseWorkflowDefinition(yaml);
    assert.equal(def.id, 'custom-v1');
    assert.ok(def.steps.step1);
    assert.deepEqual(def.steps.step1.actions, [{ id: 'custom-action' }]);
  });

  test('validates known command-gate action when knownActions is supplied', () => {
    const yaml = `
id: custom-v1
steps:
  step1:
    actions:
      - id: implement-task
    exitGates:
      - type: command
        action: test
`;
    const def = parseWorkflowDefinition(yaml, { knownActions: new Set(['implement-task', 'test']) });
    assert.equal(def.id, 'custom-v1');
  });

  test('rejects unknown command-gate action when knownActions is supplied', () => {
    const yaml = `
id: custom-v1
steps:
  step1:
    actions:
      - id: implement-task
    exitGates:
      - type: command
        action: tetss
`;
    assert.throws(
      () => parseWorkflowDefinition(yaml, { knownActions: new Set(['implement-task', 'test']) }),
      (err) => {
        assert.ok(err instanceof WorkflowDefinitionError);
        assert.match(err.message, /unknown command gate action 'tetss'/);
        return true;
      }
    );
  });

  test('preserves raw command in command gate without treating it as an action ID', () => {
    const yaml = `
id: custom-v1
steps:
  step1:
    actions:
      - id: implement-task
    exitGates:
      - type: command
        command: "npm run test:unit"
`;
    const def = parseWorkflowDefinition(yaml, { knownActions: new Set(['implement-task']) });
    assert.equal(def.id, 'custom-v1');
    assert.equal(def.steps.step1.exitGates[0].command, 'npm run test:unit');
  });

  test('parseWorkflowDefinition rejects unknown actions when knownActions is provided', () => {
    const yaml = `
id: custom-v1
steps:
  step1:
    actions:
      - id: unknown-action
`;
    assert.throws(
      () => parseWorkflowDefinition(yaml, { knownActions: new Set(['implement-task', 'commit-and-push']) }),
      (err) => {
        assert.ok(err instanceof WorkflowDefinitionError);
        assert.match(err.message, /unknown action 'unknown-action'/);
        return true;
      }
    );
  });

  test('parseWorkflowDefinition rejects unknown gate type', () => {
    const yaml = `
id: custom-v1
steps:
  step1:
    exitGates:
      - type: magical-gate
`;
    assert.throws(
      () => parseWorkflowDefinition(yaml),
      (err) => {
        assert.ok(err instanceof WorkflowDefinitionError);
        assert.match(err.message, /unknown gate type 'magical-gate'/);
        return true;
      }
    );
  });

  test('parseWorkflowDefinition rejects command gate missing action or command', () => {
    const yaml = `
id: custom-v1
steps:
  step1:
    exitGates:
      - type: command
`;
    assert.throws(
      () => parseWorkflowDefinition(yaml),
      (err) => {
        assert.ok(err instanceof WorkflowDefinitionError);
        assert.match(err.message, /command gate must declare an 'action' or 'command'/);
        return true;
      }
    );
  });

  test('parseWorkflowDefinition rejects definition with missing steps', () => {
    const yaml = `
id: custom-v1
title: "No Steps"
`;
    assert.throws(
      () => parseWorkflowDefinition(yaml),
      (err) => {
        assert.ok(err instanceof WorkflowDefinitionError);
        assert.match(err.message, /'steps' must be an object with at least one step/);
        return true;
      }
    );
  });

  test('loadWorkflowDefinition throws if file not found', () => {
    assert.throws(
      () => loadWorkflowDefinition('non-existent-workflow'),
      (err) => {
        assert.ok(err instanceof WorkflowDefinitionError);
        assert.match(err.message, /Workflow definition not found/);
        return true;
      }
    );
  });
});

describe('Repository-wide spec validation (AC6)', () => {
  test('validateSpecs passes with zero errors across all repository changes', () => {
    const errors = validateSpecs();
    assert.deepEqual(errors, [], `Expected zero validation errors, got: ${errors.join(', ')}`);
  });
});
