---
id: exit-gate-improvements.explicit-task-verification-action
status: draft
change: exit-gate-improvements
depends_on: [transition-aware-exit-gates]
context:
  required:
    - specs/active/exit-gate-improvements/overview.md
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
semantic_references:
  decisions: [D6]
  dependency_contracts:
    - transition-aware-exit-gates
---

# Task: Explicit task-verification action

Implements owner decision D6: no behavior may be inferred from command strings; it is declared in workflow config.

## Goal

Add a `task-verification` catalog action that runs the task's `## Verification` commands,
and let `test` mean literal `npm test`, removing the `'npm test'` string special case in
`runCliCommandWithLiveOutput` entirely, and migrate `standard.yaml`/`standard-v1.yaml`/templates gates from `action: test` to `action: task-verification` in the same task.

## Acceptance criteria

- `task-verification` runs task commands; `test` runs `npm test`. `automated: node --test tools/tests/task-verification-action.test.mjs`
- CLI and batch paths behave identically.
- No code path substitutes a command by comparing strings; `test` runs literal `npm test`.
- Shipped definitions use `task-verification` where task commands are intended; pinned definitions keep working after migration.

## Verification

```bash
node --test tools/tests/task-verification-action.test.mjs
node --test tools/tests/workflow-cli.test.mjs
node --test tools/tests/workflow-gates.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Changing which commands tasks list.
