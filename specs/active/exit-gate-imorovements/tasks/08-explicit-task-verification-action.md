---
id: exit-gate-imorovements.explicit-task-verification-action
status: draft
change: exit-gate-imorovements
depends_on: [transition-aware-exit-gates]
context:
  required:
    - specs/active/exit-gate-imorovements/overview.md
    - tools/specs/workflow/cli.mjs
    - tools/specs/workflow/gates/command-catalog.mjs
allowed_paths:
  - tools/specs/workflow/cli.mjs
  - tools/specs/workflow/gates/command-catalog.mjs
  - tools/specs/workflow/definitions/**
  - .nevo-ai/workflows/**
  - tools/tests/task-verification-action.test.mjs
forbidden_paths:
  - tools/dashboard/**
  - src/**
---

# Task: Explicit task-verification action

Conditional: executes **only if owner decision D6 is approved.**

## Goal

Add a `task-verification` catalog action that runs the task's `## Verification` commands,
and let `test` mean literal `npm test`, removing the `'npm test'` string special case in
`runCliCommandWithLiveOutput`.

## Acceptance criteria

- `task-verification` runs task commands; `test` runs `npm test`. `automated: node --test tools/tests/task-verification-action.test.mjs`
- CLI and batch paths behave identically.
- Existing pinned definitions keep working (compat shim or migration documented).

## Verification

```bash
node --test tools/tests/task-verification-action.test.mjs
node --test tools/tests/
node tools/specs.mjs validate
```

## Out of scope

Changing which commands tasks list.
