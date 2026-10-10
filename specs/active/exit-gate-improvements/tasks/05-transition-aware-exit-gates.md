---
id: exit-gate-improvements.transition-aware-exit-gates
status: draft
change: exit-gate-improvements
context:
  required:
    - specs/active/exit-gate-improvements/overview.md
    - specs/active/exit-gate-improvements/areas/02-transition-aware-gates.md
    - tools/specs/workflow/definitions/schema.mjs
    - tools/specs/workflow/finish-operation.mjs
    - .nevo-ai/workflows/standard.yaml
    - .nevo-ai/workflows/standard-v1.yaml
    - tools/specs/workflow/templates/standard.yaml
allowed_paths:
  - tools/specs/workflow/definitions/**
  - tools/specs/workflow/step-runner.mjs
  - tools/specs/workflow/finish-operation.mjs
  - tools/specs/workflow/step-context.mjs
  - tools/specs/workflow/templates/**
  - .nevo-ai/workflows/**
  - tools/tests/transition-aware-gates.test.mjs
forbidden_paths:
  - tools/dashboard/**
  - src/**
semantic_references:
  decisions: [D3]
---

# Task: Transition-aware exit gates

## Goal

Add optional `when: [result...]` to exit gates and evaluate only applicable gates in
`planFinish` and `ensureVerifyGates`; `review` requires the command gate only for `pass`
and requires `feedback` for `fail`.

## Implementation constraints

- Absent `when` = current behavior. Unconditional steps unaffected.
- `result` comes only from persisted `resolvedInputs`.
- Update both `standard.yaml` and `standard-v1.yaml` consistently with templates (decision D3).

## Acceptance criteria

- `review pass` with red verification ⇒ `blocked`. `automated: node --test tools/tests/transition-aware-gates.test.mjs`
- `review fail` with red verification ⇒ `completed`, `feedback` recorded, scope/commit unchanged.
- `review fail` without feedback ⇒ input-required.
- Invalid `when` value (not a declared transition) ⇒ definition validation error.
- Same result through `finishStep` as called by CLI, human-step and batch member path.

## Verification

```bash
node --test tools/tests/transition-aware-gates.test.mjs
node --test tools/tests/workflow-finish-operation.test.mjs
node --test tools/tests/workflow-definitions-schema.test.mjs
node --test tools/tests/workflow-definitions.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Recovery/taxonomy changes (task 06).
