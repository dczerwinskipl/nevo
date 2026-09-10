// Tests for workflow definition parser, repository-local loader, security boundaries, and compatibility mode resolution.
// Run: node --test tools/tests/workflow-compatibility.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
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
  KNOWN_COMMAND_ACTIONS,
} from '../specs/workflow/definitions/schema.mjs';

import { validateWorkflowConfiguration, validateSpecs, validateWorkflowProgress } from '../specs/validation.mjs';
import { WorkflowDefinitionError, WorkflowError } from '../specs/workflow/errors.mjs';
import { defaultActionRegistry } from '../specs/workflow/registry.mjs';
// D34 (task 09): loadWorkflowDefinition now defaults knownActions from
// defaultActionRegistry.list() (D20/C20, fail-closed action resolution) — this file
// calls loadWorkflowDefinition directly against the real .nevo-ai/workflows/standard.yaml,
// so its own registry must be populated first, exactly like cli.mjs's own side-effect
// import already guarantees for real CLI usage.
import '../specs/workflow/actions/index.mjs';

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
    assert.deepEqual(impl.actions, []);
    assert.equal(impl.exitGates.length, 2);
    assert.deepEqual(impl.exitGates[0], { type: 'command', action: 'test' });
    assert.deepEqual(impl.exitGates[1], { type: 'human', required: true });
    assert.deepEqual(impl.finalize, [{ id: 'commit-and-push' }]);
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

  test('every built-in initialization template validates under the corrected schema (D19/D27), including exploratory', () => {
    const templates = listBuiltInWorkflowTemplates();
    assert.ok(templates.includes('exploratory'), 'exploratory template exists');

    for (const name of templates) {
      const content = readFileSync(join(TEMPLATES_DIR, `${name}.yaml`), 'utf8');
      const def = parseWorkflowDefinition(content);
      assert.ok(def.id);
      assert.ok(Object.keys(def.steps).length > 0);
    }
  });

  test('every built-in initialization template validates against the real, registered-action vocabulary (D20/D36) — a template must never be invalid the moment it is copied into a real repository', () => {
    const knownActions = defaultActionRegistry.list();
    assert.ok(knownActions.includes('commit-and-push'), 'sanity: the real registry must have at least commit-and-push registered for this test to mean anything');

    const templates = listBuiltInWorkflowTemplates();
    for (const name of templates) {
      const content = readFileSync(join(TEMPLATES_DIR, `${name}.yaml`), 'utf8');
      // parseWorkflowDefinition(content) alone (no knownActions) previously let this pass
      // even when a template referenced a dead, unregistered action id — this is the
      // exact registry-aware contract loadWorkflowDefinition applies to a real, on-disk
      // definition (D20), and a template's whole purpose is to become exactly that the
      // moment it's copied into .nevo-ai/workflows/.
      const def = parseWorkflowDefinition(content, { knownActions });
      assert.ok(def.id, `template '${name}' must validate against the real registered-action vocabulary`);
    }
  });

  test('reintroducing a dead action id into a template fails the registry-aware validation unless it is actually registered (D36)', () => {
    const knownActions = defaultActionRegistry.list();
    for (const [templateName, deadActionId] of [
      ['standard', 'implement-task'],
      ['standard', 'verify-task-output'],
      ['architectural', 'implement-task'],
      ['architectural', 'verify-task-output'],
      ['small', 'implement-task'],
      ['exploratory', 'discover-scope'],
    ]) {
      assert.ok(!knownActions.includes(deadActionId), `precondition: '${deadActionId}' must not actually be registered`);
      const content = readFileSync(join(TEMPLATES_DIR, `${templateName}.yaml`), 'utf8');
      const injected = content.replace(
        /^(steps:\r?\n(?: {2}\S.*\r?\n)?)/m,
        `$1    actions:\n      - id: ${deadActionId}\n`
      );
      assert.notEqual(injected, content, `precondition: injection regex must actually match template '${templateName}'`);
      assert.throws(
        () => parseWorkflowDefinition(injected, { knownActions }),
        (err) => {
          assert.ok(err instanceof WorkflowDefinitionError);
          assert.match(err.message, new RegExp(`unknown action '${deadActionId}'`));
          return true;
        },
        `template '${templateName}' should reject a reintroduced '${deadActionId}' action reference`
      );
    }
  });

  test('the shipped exploratory workflow (repository-local and template) both terminate at a real TERMINAL_STATUSES value, never the stale "refined" placeholder', () => {
    const repoDef = loadWorkflowDefinition('exploratory', { repoRoot: REPO_ROOT });
    assert.equal(repoDef.steps.discovery.transitions[0].to, 'verified');

    const templateContent = readFileSync(join(TEMPLATES_DIR, 'exploratory.yaml'), 'utf8');
    const templateDef = parseWorkflowDefinition(templateContent);
    assert.equal(templateDef.steps.discovery.transitions[0].to, 'verified');
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
        'id: standard-repo-a\ntitle: "Repo A Workflow"\nsteps:\n  build:\n    transitions: [{ to: verified }]\n',
        'utf8'
      );

      writeFileSync(
        join(repoB, WORKFLOWS_REL_DIR, 'standard.yaml'),
        'id: standard-repo-b\ntitle: "Repo B Workflow"\nsteps:\n  test:\n    transitions: [{ to: verified }]\n',
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

describe('Workflow definition validation and uniqueness (Finding 1, 2)', () => {
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
      - to: verified
`;
    const def = parseWorkflowDefinition(yaml);
    assert.equal(def.id, 'custom-v1');
    assert.ok(def.steps.step1);
    assert.deepEqual(def.steps.step1.actions, [{ id: 'custom-action' }]);
  });

  test('rejects duplicate action references in step actions list (Finding 1)', () => {
    const yaml = `
id: custom-v1
steps:
  step1:
    actions:
      - id: implement-task
      - id: implement-task
`;
    assert.throws(
      () => parseWorkflowDefinition(yaml),
      (err) => {
        assert.ok(err instanceof WorkflowDefinitionError);
        assert.match(err.message, /duplicate action reference 'implement-task' at index 1/);
        return true;
      }
    );
  });

  test('rejects duplicate action references in step finalize list (Finding 1)', () => {
    const yaml = `
id: custom-v1
steps:
  step1:
    finalize:
      - id: commit-and-push
      - id: commit-and-push
`;
    assert.throws(
      () => parseWorkflowDefinition(yaml),
      (err) => {
        assert.ok(err instanceof WorkflowDefinitionError);
        assert.match(err.message, /duplicate action reference 'commit-and-push' at index 1/);
        return true;
      }
    );
  });

  test('same action reference in two different steps remains valid (Finding 1)', () => {
    const yaml = `
id: custom-v1
steps:
  step1:
    actions:
      - id: run-check
    transitions:
      - to: step2
  step2:
    actions:
      - id: run-check
    transitions:
      - to: verified
`;
    const def = parseWorkflowDefinition(yaml);
    assert.equal(def.id, 'custom-v1');
    assert.deepEqual(def.steps.step1.actions, [{ id: 'run-check' }]);
    assert.deepEqual(def.steps.step2.actions, [{ id: 'run-check' }]);
  });

  test('canonical command catalog built-ins (test, build) accepted without extra options (Finding 2)', () => {
    const yaml = `
id: custom-v1
steps:
  step1:
    exitGates:
      - type: command
        action: test
      - type: command
        action: build
    transitions:
      - to: verified
`;
    const def = parseWorkflowDefinition(yaml);
    assert.equal(def.id, 'custom-v1');
  });

  test('unknown command gate alias rejected without custom options (Finding 2)', () => {
    const yaml = `
id: custom-v1
steps:
  step1:
    exitGates:
      - type: command
        action: unknown-alias
`;
    assert.throws(
      () => parseWorkflowDefinition(yaml),
      (err) => {
        assert.ok(err instanceof WorkflowDefinitionError);
        assert.match(err.message, /unknown command gate action alias 'unknown-alias'/);
        return true;
      }
    );
  });

  test('configured custom command alias accepted by loader/validator (Finding 2)', () => {
    const yaml = `
id: custom-v1
steps:
  step1:
    exitGates:
      - type: command
        action: lint
    transitions:
      - to: verified
`;
    const def = parseWorkflowDefinition(yaml, { knownCommandActions: new Set(['test', 'build', 'lint']) });
    assert.equal(def.id, 'custom-v1');
  });

  test('workflow action ID is not accepted as command gate action alias during validation (Finding 2)', () => {
    const yaml = `
id: custom-v1
steps:
  step1:
    actions:
      - id: implement-task
    exitGates:
      - type: command
        action: implement-task
    transitions:
      - to: verified
`;
    // 'implement-task' is in knownActions, but NOT in knownCommandActions
    assert.throws(
      () => parseWorkflowDefinition(yaml, {
        knownActions: new Set(['implement-task']),
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
    transitions:
      - to: verified
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

describe('Safe, unique step and gate identifiers (D30, task 08 AC12)', () => {
  function stepWith(overrides) {
    return {
      id: 'ids-v1',
      steps: {
        implementation: {
          actions: [{ id: 'a' }],
          transitions: [{ to: 'verified' }],
          ...overrides,
        },
      },
    };
  }

  test('a step key containing "/" fails validation', () => {
    const raw = { id: 'ids-v1', steps: { 'bad/step': { actions: [], transitions: [{ to: 'verified' }] } } };
    const { valid, errors } = validateWorkflowDefinition(raw);
    assert.equal(valid, false);
    assert.ok(errors.some(e => /must be a non-empty identifier matching/.test(e)));
  });

  test('an empty step key fails validation', () => {
    const raw = { id: 'ids-v1', steps: { '': { actions: [], transitions: [{ to: 'verified' }] } } };
    const { valid, errors } = validateWorkflowDefinition(raw);
    assert.equal(valid, false);
    assert.ok(errors.some(e => /must be a non-empty identifier matching/.test(e)));
  });

  test('entryStep containing invalid characters fails validation', () => {
    const raw = { ...stepWith({}), entryStep: 'not a safe id' };
    const { valid, errors } = validateWorkflowDefinition(raw);
    assert.equal(valid, false);
    assert.ok(errors.some(e => /entryStep: must be a non-empty identifier matching/.test(e)));
  });

  test('entryStep naming an undeclared step fails validation (also AC15)', () => {
    const raw = { ...stepWith({}), entryStep: 'no-such-step' };
    const { valid, errors } = validateWorkflowDefinition(raw);
    assert.equal(valid, false);
    assert.ok(errors.some(e => /entryStep: 'no-such-step' does not name a declared step/.test(e)));
  });

  test('a gate\'s explicit id containing invalid characters fails validation', () => {
    const raw = stepWith({ exitGates: [{ type: 'human', required: true, id: 'not a safe id' }] });
    const { valid, errors } = validateWorkflowDefinition(raw);
    assert.equal(valid, false);
    assert.ok(errors.some(e => /exitGates\[0\]\.id: must be a non-empty identifier matching/.test(e)));
  });

  test('a step declaring two human gates with no ids at all fails validation', () => {
    const raw = stepWith({
      entryGates: [{ type: 'human', required: true }],
      exitGates: [{ type: 'human', required: true }],
    });
    const { valid, errors } = validateWorkflowDefinition(raw);
    assert.equal(valid, false);
    assert.ok(errors.some(e => /2 human-verification gates.*explicit, unique 'id'/.test(e)));
  });

  test('a step declaring two human gates with the same explicit id fails validation', () => {
    const raw = stepWith({
      entryGates: [{ type: 'human', required: true, id: 'review' }],
      exitGates: [{ type: 'human', required: true, id: 'review' }],
    });
    const { valid, errors } = validateWorkflowDefinition(raw);
    assert.equal(valid, false);
    assert.ok(errors.some(e => /duplicate human-verification gate id 'review'/.test(e)));
  });

  test('a step declaring two human gates with distinct explicit ids is valid', () => {
    const raw = stepWith({
      entryGates: [{ type: 'human', required: true, id: 'entry-review' }],
      exitGates: [{ type: 'human', required: true, id: 'exit-review' }],
    });
    const { valid, errors } = validateWorkflowDefinition(raw);
    assert.equal(valid, true, errors.join('; '));
  });
});

describe('Transition cardinality and terminal-target correctness (D19 refined/D27, task 08 AC14/AC16/AC17)', () => {
  test('a step declaring zero transitions fails validation', () => {
    const raw = { id: 'card-v1', steps: { implementation: { actions: [{ id: 'a' }], transitions: [] } } };
    const { valid, errors } = validateWorkflowDefinition(raw);
    assert.equal(valid, false);
    assert.ok(errors.some(e => /transitions: must declare exactly one transition, got 0/.test(e)));
  });

  test('a step declaring more than one transition fails validation', () => {
    const raw = {
      id: 'card-v1',
      steps: { implementation: { actions: [{ id: 'a' }], transitions: [{ to: 'verified' }, { to: 'archived' }] } },
    };
    const { valid, errors } = validateWorkflowDefinition(raw);
    assert.equal(valid, false);
    assert.ok(errors.some(e => /transitions: must declare exactly one transition, got 2/.test(e)));
  });

  test('a step declaring exactly one transition validates successfully', () => {
    const raw = { id: 'card-v1', steps: { implementation: { actions: [{ id: 'a' }], transitions: [{ to: 'verified' }] } } };
    const { valid, errors } = validateWorkflowDefinition(raw);
    assert.equal(valid, true, errors.join('; '));
  });

  test('a step name colliding with a terminal status value fails to load (AC16)', () => {
    const raw = {
      id: 'collide-v1',
      steps: {
        verified: { actions: [{ id: 'a' }], transitions: [{ to: 'implemented' }] },
      },
    };
    const { valid, errors } = validateWorkflowDefinition(raw);
    assert.equal(valid, false);
    assert.ok(errors.some(e => /step name collides with a terminal lifecycle status/.test(e)));
  });

  test('a transition target that is a typo of a terminal status fails validation (AC17)', () => {
    const raw = { id: 'typo-v1', steps: { implementation: { actions: [{ id: 'a' }], transitions: [{ to: 'verifed' }] } } };
    const { valid, errors } = validateWorkflowDefinition(raw);
    assert.equal(valid, false);
    assert.ok(errors.some(e => /transition target 'verifed' is neither a declared step nor a member of/.test(e)));
  });

  test('a transition target that is a real but non-terminal status fails validation (AC17)', () => {
    for (const target of ['approved', 'in-implementation']) {
      const raw = { id: 'nonterm-v1', steps: { implementation: { actions: [{ id: 'a' }], transitions: [{ to: target }] } } };
      const { valid, errors } = validateWorkflowDefinition(raw);
      assert.equal(valid, false, `expected '${target}' to be rejected`);
      assert.ok(errors.some(e => new RegExp(`transition target '${target}' is neither a declared step nor a member of`).test(e)));
    }
  });

  test('a transition target naming another declared step is valid, never reaching setTaskStatus (AC17 contrast)', () => {
    const raw = {
      id: 'multi-v1',
      steps: {
        stepA: { actions: [{ id: 'a' }], transitions: [{ to: 'stepB' }] },
        stepB: { actions: [{ id: 'a' }], transitions: [{ to: 'verified' }] },
      },
    };
    const { valid, errors } = validateWorkflowDefinition(raw);
    assert.equal(valid, true, errors.join('; '));
  });
});

describe('Repository-wide spec validation (AC6)', () => {
  test('validateSpecs passes with zero errors across all repository changes', () => {
    const errors = validateSpecs();
    assert.deepEqual(errors, [], `Expected zero validation errors, got: ${errors.join(', ')}`);
  });
});

describe('workflow_progress validation contract (D18/D19/D28, AC1/AC19)', () => {
  test('absent workflow_progress is a no-op, regardless of workflow mode', () => {
    const errors = [];
    validateWorkflowProgress({ id: 'c' }, { id: 't1' }, errors, 'label');
    validateWorkflowProgress({ id: 'c', workflow: { mode: 'deterministic', definition: 'standard' } }, { id: 't1' }, errors, 'label');
    assert.deepEqual(errors, []);
  });

  test('present on a legacy (non-deterministic) change is an explicit validation error (AC19)', () => {
    const errors = [];
    const change = { id: 'c' }; // no workflow config at all -> resolves to legacy
    const task = { id: 't1', workflow_progress: { current_step: 'implementation', history: [] } };
    validateWorkflowProgress(change, task, errors, 'label');
    assert.equal(errors.length, 1);
    assert.match(errors[0], /workflow_progress is present but this change resolves to workflow mode 'legacy'/);
  });

  test('present on an explicit workflow_mode: deterministic shorthand is accepted (no legacy false-positive)', () => {
    const errors = [];
    const change = { id: 'c', workflow_mode: 'deterministic', type: 'standard' };
    const task = { id: 't1', workflow_progress: { current_step: 'implementation', history: [] } };
    validateWorkflowProgress(change, task, errors, 'label', { repoRoot: REPO_ROOT });
    assert.deepEqual(errors, []);
  });

  test('current_step must be a non-empty string', () => {
    const errors = [];
    const change = { id: 'c', workflow: { mode: 'deterministic', definition: 'standard' } };
    validateWorkflowProgress(change, { id: 't1', workflow_progress: { current_step: '' } }, errors, 'label');
    assert.equal(errors.length, 1);
    assert.match(errors[0], /current_step must be a non-empty string/);
  });

  test('history must be an array when present', () => {
    const errors = [];
    const change = { id: 'c', workflow: { mode: 'deterministic', definition: 'standard' } };
    const task = { id: 't1', workflow_progress: { current_step: 'implementation', history: 'not-an-array' } };
    validateWorkflowProgress(change, task, errors, 'label', { repoRoot: REPO_ROOT });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /workflow_progress\.history must be an array/);
  });

  test('current_step naming a real step in the resolved definition is accepted', () => {
    const errors = [];
    const change = { id: 'c', workflow: { mode: 'deterministic', definition: 'standard' } };
    const task = { id: 't1', workflow_progress: { current_step: 'implementation', history: [] } };
    validateWorkflowProgress(change, task, errors, 'label', { repoRoot: REPO_ROOT });
    assert.deepEqual(errors, []);
  });

  test('current_step naming no declared step in the resolved definition fails closed (AC1)', () => {
    const errors = [];
    const change = { id: 'c', workflow: { mode: 'deterministic', definition: 'standard' } };
    const task = { id: 't1', workflow_progress: { current_step: 'not-a-real-step', history: [] } };
    validateWorkflowProgress(change, task, errors, 'label', { repoRoot: REPO_ROOT });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /current_step 'not-a-real-step' does not name a step declared in workflow definition/);
  });

  test('an unresolvable workflow definition is reported instead of throwing uncaught', () => {
    const errors = [];
    const change = { id: 'c', workflow: { mode: 'deterministic', definition: 'no-such-definition' } };
    const task = { id: 't1', workflow_progress: { current_step: 'implementation', history: [] } };
    validateWorkflowProgress(change, task, errors, 'label', { repoRoot: REPO_ROOT });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /could not resolve workflow definition 'no-such-definition'/);
  });

  test('wired into validateSpecs() itself (the same function `node tools/specs.mjs validate` calls), via an isolated fixture repository', () => {
    const activeDir = mkdtempSync(join(tmpdir(), 'nevo-wp-validate-active-'));
    const archiveDir = join(activeDir, 'no-archive-here');
    try {
      const legacyDir = join(activeDir, 'legacy-change');
      mkdirSync(legacyDir, { recursive: true });
      writeFileSync(join(legacyDir, 'change.yaml'), [
        'id: legacy-change', 'title: Legacy', 'status: draft', '',
        'tasks:', '  - id: t1', '    order: 1', '    status: in-implementation',
        '    workflow_progress:', '      current_step: implementation', '      history: []', '',
      ].join('\n'));

      const badStepDir = join(activeDir, 'bad-step-change');
      mkdirSync(badStepDir, { recursive: true });
      writeFileSync(join(badStepDir, 'change.yaml'), [
        'id: bad-step-change', 'title: Bad Step', 'status: draft',
        'workflow:', '  mode: deterministic', '  definition: standard', '',
        'tasks:', '  - id: t1', '    order: 1', '    status: in-implementation',
        '    workflow_progress:', '      current_step: not-a-real-step', '      history: []', '',
      ].join('\n'));

      const goodDir = join(activeDir, 'good-change');
      mkdirSync(goodDir, { recursive: true });
      writeFileSync(join(goodDir, 'change.yaml'), [
        'id: good-change', 'title: Good', 'status: draft',
        'workflow:', '  mode: deterministic', '  definition: standard', '',
        'tasks:', '  - id: t1', '    order: 1', '    status: in-implementation',
        '    workflow_progress:', '      current_step: implementation', '      history: []', '',
      ].join('\n'));

      const errors = validateSpecs({ activeDir, archiveDir });

      const wpErrors = errors.filter(e => /workflow_progress/.test(e));
      assert.ok(
        wpErrors.some(e => e.includes('legacy-change') && /resolves to workflow mode 'legacy'/.test(e)),
        `Expected a legacy-mode workflow_progress error, got: ${wpErrors.join(' | ')}`
      );
      assert.ok(
        wpErrors.some(e => e.includes('bad-step-change') && /does not name a step declared/.test(e)),
        `Expected an unresolvable current_step error, got: ${wpErrors.join(' | ')}`
      );
      assert.ok(
        !wpErrors.some(e => e.includes('good-change')),
        `good-change should not raise a workflow_progress error, got: ${wpErrors.join(' | ')}`
      );
    } finally {
      rmSync(activeDir, { recursive: true, force: true });
    }
  });
});
