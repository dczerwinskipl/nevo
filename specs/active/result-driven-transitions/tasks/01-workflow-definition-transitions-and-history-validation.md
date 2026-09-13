---
id: result-driven-transitions.workflow-definition-transitions-and-history-validation
status: draft
change: result-driven-transitions
context:
  required:
    - specs/active/result-driven-transitions/overview.md
    - specs/active/result-driven-transitions/owner-decisions.md
    - specs/active/result-driven-transitions/areas/01-workflow-definitions-and-transitions.md
    - tools/specs/workflow/definitions/schema.mjs
    - tools/specs/workflow/definitions/loader.mjs
    - tools/specs/validation.mjs
  optional:
    - docs/development/workflow-engine.md
    - docs/development/node-tooling-guidelines.md
allowed_paths:
  - tools/specs/workflow/definitions/schema.mjs
  - tools/specs/workflow/definitions/loader.mjs
  - tools/specs/validation.mjs
  - tools/tests/workflow-definitions.test.mjs
  - tools/tests/workflow-compatibility.test.mjs
  - specs/active/result-driven-transitions/change.yaml
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D1, D2]
  constraints: [C1, C2, C3, C4, C5]
---

# Task: Declarative workflow definition schema and semantic history validation

## Goal

Update `tools/specs/workflow/definitions/schema.mjs` and `loader.mjs` to support unconditional transitions and result-driven conditional transitions in workflow definitions. Enforce fail-closed validation against ambiguous, duplicate, or malformed transition definitions, enforce the v1 closed transition value set (`pass | fail | blocked`), and add semantic validation in `tools/specs/validation.mjs` to ensure completed task history records strictly conform to declared workflow definitions.

## Implementation constraints

- In `tools/specs/workflow/definitions/schema.mjs`:
  - Allow a step's `transitions` to declare either:
    1. Exactly one unconditional transition (`{ to: string }`, where `value` is absent).
    2. Two or more result-driven transitions (`{ value: string, to: string }`, where `value` is present on every item).
  - Reject ambiguous mixtures (some transitions with `value`, some without).
  - Reject single transitions with a `value` (unconditional steps must not require synthetic results).
  - Validate that every `value` is a member of `KNOWN_TRANSITION_VALUES = new Set(['pass', 'fail', 'blocked'])`.
  - Validate that `value` strings are mutually distinct within a step's `transitions`.
  - Validate that every `to` target matches a declared step name in `definition.steps` or a member of `TERMINAL_STATUSES`.
  - Update `normalizeWorkflowDefinition` in `loader.mjs` to preserve transition `value` fields on normalized steps.
- In `tools/specs/validation.mjs`:
  - Enhance `validateWorkflowProgress` to semantically validate every entry in `workflow_progress.history` against the task's workflow definition:
    - Verify that `h.step` is declared in `definition.steps`.
    - If the step is unconditional: verify `h.result === undefined` and `h.transitioned_to === step.transitions[0].to`.
    - If the step is conditional: verify `h.result` is non-empty, matches a declared transition `value` (and in v1 `KNOWN_TRANSITION_VALUES`), and `h.transitioned_to` equals the `to` target of the transition for that `value`.
    - Fail closed with `INVALID_WORKFLOW_HISTORY` if any historical entry is inconsistent with the definition.
- Do not introduce backward-compatibility hacks or legacy aliases into the deterministic definition schema.

## Acceptance criteria

1. Workflow definition validator accepts steps with a single unconditional transition (`[{ to: 'review' }]`). `automated: node --test tools/tests/workflow-definitions.test.mjs`
2. Workflow definition validator accepts steps with multiple result-driven transitions (`[{ value: 'pass', to: 'human-verification' }, { value: 'fail', to: 'implementation' }]`). `automated: node --test tools/tests/workflow-definitions.test.mjs`
3. Workflow definition validator rejects steps with duplicate transition values or mixing conditional and unconditional transitions. `automated: node --test tools/tests/workflow-definitions.test.mjs`
4. Workflow definition validator rejects transitions with values outside the v1 closed set (e.g. `value: 'approved'`). `automated: node --test tools/tests/workflow-definitions.test.mjs`
5. Workflow definition validator rejects transitions targeting undeclared steps or colliding with terminal statuses. `automated: node --test tools/tests/workflow-definitions.test.mjs`
6. `normalizeWorkflowDefinition` outputs normalized transitions preserving `value` (when present) and `to`. `automated: node --test tools/tests/workflow-definitions.test.mjs`
7. Task validation fails closed when `workflow_progress.history` contains records for undeclared steps, results on unconditional steps, undeclared results on conditional steps, or mismatched transition targets. `automated: node --test tools/tests/workflow-compatibility.test.mjs`
8. Existing workflow tests pass and `node tools/specs.mjs check` passes with zero errors. `automated: node tools/specs.mjs check`

## Verification

```text
node --test tools/tests/workflow-definitions.test.mjs
node --test tools/tests/workflow-compatibility.test.mjs
node tools/specs.mjs check
```
