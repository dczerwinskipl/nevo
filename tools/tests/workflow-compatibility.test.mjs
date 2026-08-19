// Tests for workflow definition parser, repository-local loader, security boundaries, and compatibility mode resolution.
// Run: node --test tools/tests/workflow-compatibility.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  resolveWorkflowMode,
  DEFAULT_WORKFLOW_MODE,
  DEFAULT_WORKFLOW_VERSION,
} from '../specs/workflow/compatibility.mjs';

import {
  WORKFLOWS_REL_DIR,
  TEMPLATES_DIR,
  resolveWorkflowPath,
  loadWorkflowDefinition,
  parseWorkflowDefinition,
  listRepositoryWorkflowDefinitions,
  listBuiltInWorkflowTemplates,
} from '../specs/workflow/definitions/loader.mjs';

import {
  validateWorkflowDefinition,
  validateGateDefinition,
  validateActionReference,
} from '../specs/workflow/definitions/schema.mjs';

import { validateWorkflowConfiguration, validateSpecs } from '../specs/validation.mjs';
import { WorkflowDefinitionError, WorkflowError } from '../specs/workflow/errors.mjs';

const REPO_ROOT = resolve(process.cwd());

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

describe('Manifest workflow schema validation (AC2, AC3)', () => {
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

describe('Repository-local workflow loader (.nevo-ai/workflows/) and explicit repoRoot (Finding 4)', () => {
  test('loadWorkflowDefinition requires explicit options.repoRoot', () => {
    assert.throws(
      () => loadWorkflowDefinition('standard'),
      (err) => {
        assert.ok(err instanceof WorkflowDefinitionError);
        assert.equal(err.details?.code, 'MISSING_REPO_ROOT');
        return true;
      }
    );
  });

  test('listRepositoryWorkflowDefinitions requires explicit repoRoot', () => {
    assert.throws(
      () => listRepositoryWorkflowDefinitions(),
      (err) => {
        assert.ok(err instanceof WorkflowDefinitionError);
        assert.equal(err.details?.code, 'MISSING_REPO_ROOT');
        return true;
      }
    );
  });

  test('resolveWorkflowPath requires explicit repoRoot', () => {
    assert.throws(
      () => resolveWorkflowPath('standard'),
      (err) => {
        assert.ok(err instanceof WorkflowDefinitionError);
        assert.equal(err.details?.code, 'MISSING_REPO_ROOT');
        return true;
      }
    );
  });

  test('standard resolves from .nevo-ai/workflows/standard.yaml with explicit repoRoot', () => {
    const standardDef = loadWorkflowDefinition('standard', { repoRoot: REPO_ROOT });
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

  test('repository definitions exist in .nevo-ai/workflows/ and parse cleanly', () => {
    const repoDefs = listRepositoryWorkflowDefinitions(REPO_ROOT);
    assert.ok(repoDefs.includes('standard'), 'standard workflow definition exists in .nevo-ai/workflows/');
    assert.ok(repoDefs.includes('architectural'), 'architectural workflow definition exists in .nevo-ai/workflows/');
    assert.ok(repoDefs.includes('small'), 'small workflow definition exists in .nevo-ai/workflows/');
    assert.ok(repoDefs.includes('exploratory'), 'exploratory workflow definition exists in .nevo-ai/workflows/');

    for (const name of repoDefs) {
      const def = loadWorkflowDefinition(name, { repoRoot: REPO_ROOT });
      assert.ok(def.id);
      assert.ok(def.steps);
      assert.ok(Object.keys(def.steps).length > 0);
    }
  });

  test('workflow implementation directory tools/specs/workflow/definitions has no runtime YAML files', () => {
    const definitionsImplDir = resolve('tools/specs/workflow/definitions');
    assert.equal(existsSync(join(definitionsImplDir, 'standard.yaml')), false);
    assert.equal(existsSync(join(definitionsImplDir, 'small.yaml')), false);
    assert.equal(existsSync(join(definitionsImplDir, 'architectural.yaml')), false);
    assert.equal(existsSync(join(definitionsImplDir, 'exploratory.yaml')), false);
  });

  test('templates directory exists under tools/specs/workflow/templates for scaffolding only', () => {
    const templates = listBuiltInWorkflowTemplates();
    assert.ok(templates.includes('standard'), 'standard template exists');
    assert.ok(templates.includes('architectural'), 'architectural template exists');
  });

  test('missing configured definition fails closed with structured WorkflowDefinitionError', () => {
    assert.throws(
      () => loadWorkflowDefinition('non-existent-workflow', { repoRoot: REPO_ROOT }),
      (err) => {
        assert.ok(err instanceof WorkflowDefinitionError);
        assert.match(err.message, /Deterministic workflow definition 'non-existent-workflow' not found/);
        assert.match(err.message, /\.nevo-ai[\\/]workflows[\\/]non-existent-workflow\.yaml/);
        assert.equal(err.details?.code, 'WORKFLOW_DEFINITION_NOT_FOUND');
        assert.equal(err.details?.definition, 'non-existent-workflow');
        return true;
      }
    );
  });

  test('deterministic manifest cannot accidentally use a built-in template as runtime source of truth', () => {
    // Create an isolated temp repo without .nevo-ai/workflows/standard.yaml
    const tempRepo = mkdtempSync(join(tmpdir(), 'nevo-test-empty-repo-'));
    try {
      assert.throws(
        () => loadWorkflowDefinition('standard', { repoRoot: tempRepo }),
        (err) => {
          assert.ok(err instanceof WorkflowDefinitionError);
          assert.match(err.message, /not found at repository-local location/);
          assert.equal(err.details?.code, 'WORKFLOW_DEFINITION_NOT_FOUND');
          return true;
        }
      );
    } finally {
      rmSync(tempRepo, { recursive: true, force: true });
    }
  });

  test('two repositories can have different standard.yaml definitions without affecting one another', () => {
    const repoA = mkdtempSync(join(tmpdir(), 'nevo-repo-a-'));
    const repoB = mkdtempSync(join(tmpdir(), 'nevo-repo-b-'));

    try {
      mkdirSync(join(repoA, WORKFLOWS_REL_DIR), { recursive: true });
      mkdirSync(join(repoB, WORKFLOWS_REL_DIR), { recursive: true });

      writeFileSync(
        join(repoA, WORKFLOWS_REL_DIR, 'standard.yaml'),
        'id: standard-repo-a\ntitle: "Repo A Workflow"\nsteps:\n  build:\n    actions: [{ id: compile }]\n',
        'utf8'
      );

      writeFileSync(
        join(repoB, WORKFLOWS_REL_DIR, 'standard.yaml'),
        'id: standard-repo-b\ntitle: "Repo B Workflow"\nsteps:\n  test:\n    actions: [{ id: run-tests }]\n',
        'utf8'
      );

      const defA = loadWorkflowDefinition('standard', { repoRoot: repoA });
      const defB = loadWorkflowDefinition('standard', { repoRoot: repoB });

      assert.equal(defA.id, 'standard-repo-a');
      assert.ok(defA.steps.build);
      assert.equal(defB.id, 'standard-repo-b');
      assert.ok(defB.steps.test);
    } finally {
      rmSync(repoA, { recursive: true, force: true });
      rmSync(repoB, { recursive: true, force: true });
    }
  });
});

describe('Path traversal and security boundaries', () => {
  test('rejects ../ and ..\\ path traversal in definition name', () => {
    assert.throws(
      () => resolveWorkflowPath('../secret', REPO_ROOT),
      (err) => {
        assert.ok(err instanceof WorkflowDefinitionError);
        assert.equal(err.details?.code, 'PATH_TRAVERSAL_FORBIDDEN');
        return true;
      }
    );

    assert.throws(
      () => resolveWorkflowPath('..\\secret', REPO_ROOT),
      (err) => {
        assert.ok(err instanceof WorkflowDefinitionError);
        assert.equal(err.details?.code, 'PATH_TRAVERSAL_FORBIDDEN');
        return true;
      }
    );

    assert.throws(
      () => resolveWorkflowPath('nested/../../escape', REPO_ROOT),
      (err) => {
        assert.ok(err instanceof WorkflowDefinitionError);
        assert.equal(err.details?.code, 'PATH_TRAVERSAL_FORBIDDEN');
        return true;
      }
    );
  });

  test('rejects absolute paths', () => {
    assert.throws(
      () => resolveWorkflowPath('/etc/passwd', REPO_ROOT),
      (err) => {
        assert.ok(err instanceof WorkflowDefinitionError);
        assert.equal(err.details?.code, 'PATH_TRAVERSAL_FORBIDDEN');
        return true;
      }
    );

    assert.throws(
      () => resolveWorkflowPath('C:\\Windows\\System32\\workflow', REPO_ROOT),
      (err) => {
        assert.ok(err instanceof WorkflowDefinitionError);
        assert.equal(err.details?.code, 'PATH_TRAVERSAL_FORBIDDEN');
        return true;
      }
    );
  });

  test('rejects invalid or dangerous characters in definition name', () => {
    assert.throws(
      () => resolveWorkflowPath('workflow;evil', REPO_ROOT),
      (err) => {
        assert.ok(err instanceof WorkflowDefinitionError);
        assert.equal(err.details?.code, 'INVALID_WORKFLOW_DEFINITION_NAME');
        return true;
      }
    );

    assert.throws(
      () => resolveWorkflowPath('workflow name with spaces', REPO_ROOT),
      (err) => {
        assert.ok(err instanceof WorkflowDefinitionError);
        assert.equal(err.details?.code, 'INVALID_WORKFLOW_DEFINITION_NAME');
        return true;
      }
    );

    assert.throws(
      () => resolveWorkflowPath('', REPO_ROOT),
      (err) => {
        assert.ok(err instanceof WorkflowDefinitionError);
        assert.equal(err.details?.code, 'INVALID_WORKFLOW_DEFINITION_NAME');
        return true;
      }
    );
  });
});

describe('Workflow definition pure parser and semantic validation (Finding 2 namespace separation)', () => {
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

  test('invalid YAML fails through canonical validator', () => {
    const invalidYaml = `
id: custom-v1
steps: [ unclosed array
`;
    assert.throws(
      () => parseWorkflowDefinition(invalidYaml),
      (err) => {
        assert.ok(err instanceof WorkflowDefinitionError);
        assert.match(err.message, /Invalid YAML in workflow definition/);
        return true;
      }
    );
  });

  test('validates known command-gate action against knownCommandActions', () => {
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
    const def = parseWorkflowDefinition(yaml, {
      knownActions: new Set(['implement-task']),
      knownCommandActions: new Set(['test', 'build']),
    });
    assert.equal(def.id, 'custom-v1');
  });

  test('rejects unknown command-gate action when knownCommandActions is supplied', () => {
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
      () => parseWorkflowDefinition(yaml, {
        knownActions: new Set(['implement-task']),
        knownCommandActions: new Set(['test', 'build']),
      }),
      (err) => {
        assert.ok(err instanceof WorkflowDefinitionError);
        assert.match(err.message, /unknown command gate action alias 'tetss'/);
        return true;
      }
    );
  });

  test('workflow action ID is not accepted as command gate action alias during validation', () => {
    const yaml = `
id: custom-v1
steps:
  step1:
    actions:
      - id: implement-task
    exitGates:
      - type: command
        action: implement-task
`;
    // 'implement-task' is in knownActions, but NOT in knownCommandActions
    assert.throws(
      () => parseWorkflowDefinition(yaml, {
        knownActions: new Set(['implement-task']),
        knownCommandActions: new Set(['test', 'build']),
      }),
      (err) => {
        assert.ok(err instanceof WorkflowDefinitionError);
        assert.match(err.message, /unknown command gate action alias 'implement-task'/);
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

  test('rejects command gate with neither action nor command', () => {
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
        assert.match(err.message, /command gate must declare either 'action' or 'command'/);
        return true;
      }
    );
  });

  test('rejects command gate declaring both action and command (exactly one target required)', () => {
    const yaml = `
id: custom-v1
steps:
  step1:
    exitGates:
      - type: command
        action: test
        command: "npm test"
`;
    assert.throws(
      () => parseWorkflowDefinition(yaml),
      (err) => {
        assert.ok(err instanceof WorkflowDefinitionError);
        assert.match(err.message, /command gate cannot declare both 'action' and 'command' — specify exactly one execution target/);
        return true;
      }
    );
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
});

describe('Repository-wide spec validation (AC6)', () => {
  test('validateSpecs passes with zero errors across all repository changes', () => {
    const errors = validateSpecs();
    assert.deepEqual(errors, [], `Expected zero validation errors, got: ${errors.join(', ')}`);
  });
});
