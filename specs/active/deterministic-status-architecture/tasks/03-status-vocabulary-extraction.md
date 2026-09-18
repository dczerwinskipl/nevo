---
id: deterministic-status-architecture.status-vocabulary-extraction
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/shared-status-vocabulary.md
    - specs/active/deterministic-status-architecture/owner-decisions.md
allowed_paths:
  - tools/specs/status-vocabulary.mjs
  - tools/specs/lifecycle-primitives.mjs
  - tools/specs/workflow/finish-operation.mjs
  - tools/specs/workflow/definitions/schema.mjs
  - tools/tests/status-vocabulary.test.mjs
forbidden_paths:
  - tools/specs/approve/**
  - tools/specs/start/**
  - tools/specs/complete/**
  - tools/specs/verify/**
  - tools/dashboard/**
  - src/**
---

# Task: Status vocabulary extraction

## Goal

Extract `TERMINAL_STATUSES` out of `tools/specs/lifecycle-primitives.mjs` into a new,
neutral module, and repoint the two real existing deterministic-side imports of it
(`finish-operation.mjs`, `definitions/schema.mjs`) at that module — the prerequisite for
`lifecycle-boundary-regression-tests`' import-boundary check to be enable-able at all (D8).

## Implementation constraints

- New module `tools/specs/status-vocabulary.mjs` exporting `TERMINAL_STATUSES` with the
  identical value (`new Set(['implemented', 'verified', 'archived', 'abandoned'])`).
- `tools/specs/lifecycle-primitives.mjs`: change its own `TERMINAL_STATUSES` from a local
  `const`/`export const` to `export { TERMINAL_STATUSES } from './status-vocabulary.mjs'` —
  every existing legacy importer's path/name is unaffected.
- `tools/specs/workflow/finish-operation.mjs`: change its `TERMINAL_STATUSES` import from
  `../lifecycle-primitives.mjs` to `../status-vocabulary.mjs`.
- `tools/specs/workflow/definitions/schema.mjs`: change its `TERMINAL_STATUSES` import from
  `../../lifecycle-primitives.mjs` to `../../status-vocabulary.mjs`.
- Do not touch `DEPENDENCY_SATISFYING_STATUSES`, `READY_STATUSES`,
  `TASK_STATUSES`/`CHANGE_STATUSES`, `depsSatisfied`, `isTaskReady`, or `TRANSITIONS` —
  all stay exactly where they are in `lifecycle-primitives.mjs`, unmoved, legacy-only.

## Acceptance criteria

- `tools/specs/status-vocabulary.mjs` exports `TERMINAL_STATUSES` with the identical four
  values. `automated: node --test tools/tests/status-vocabulary.test.mjs`
- Every existing legacy importer of `TERMINAL_STATUSES` from `lifecycle-primitives.mjs`
  (`tools/specs/{approve,start,complete,verify}/**`, `tools/specs/context.mjs`, etc.)
  continues to work unchanged. `automated: node --test tools/tests/task-lifecycle.test.mjs tools/tests/status-dependency-aware.test.mjs`
- `finish-operation.mjs` and `definitions/schema.mjs` import `TERMINAL_STATUSES` from
  `tools/specs/status-vocabulary.mjs`, not `lifecycle-primitives.mjs`.
  `automated: node --test tools/tests/status-vocabulary.test.mjs`
- Existing deterministic-workflow-engine tests exercising terminal-status logic
  (`workflow-e2e.test.mjs`, `workflow-definitions.test.mjs`, `workflow-finish-operation.test.mjs`)
  continue passing unchanged.
  `automated: node --test tools/tests/workflow-e2e.test.mjs tools/tests/workflow-definitions.test.mjs tools/tests/workflow-finish-operation.test.mjs`
- Grepping `tools/specs/workflow/**` for the string `lifecycle-primitives` returns zero
  matches. `inspection: grep tools/specs/workflow/** for 'lifecycle-primitives' and confirm zero matches`

## Verification

```bash
node --test tools/tests/status-vocabulary.test.mjs
node --test tools/tests/task-lifecycle.test.mjs
node --test tools/tests/status-dependency-aware.test.mjs
node --test tools/tests/workflow-e2e.test.mjs
node --test tools/tests/workflow-definitions.test.mjs
node --test tools/tests/workflow-finish-operation.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Extracting anything beyond `TERMINAL_STATUSES` (D8). The import-boundary regression test
itself (owned by `lifecycle-boundary-regression-tests`, which depends on this task).
