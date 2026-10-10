# Area B — Transition-aware exit gates and review outcomes

## Responsibility

Let each workflow transition declare which exit gates it requires, so a negative review
(`fail`) can always be recorded, while a positive one (`pass`) still requires successful
verification — without weakening scope, Git ownership or durable-operation safety.

## Current state

See `discovery.md` § "Why `review fail` cannot be recorded when checks fail" and "How
verification commands are selected".

## Requirements

1. Optional `when: [<result>...]` on exit gates (schema, loader, normalized definition);
   absent means "all transitions".
2. `planFinish` and `ensureVerifyGates` evaluate only gates applicable to the resolved
   `result`; the `result` source is the persisted, conflict-checked `resolvedInputs`.
3. `standard.yaml` (and `standard-v1.yaml`, templates): `review` command gate
   `when: [pass]`; `review` `fail` requires non-empty `feedback`.
4. A red required gate leaves a replayable record; `result`/`feedback` may be revised
   until `update-task` has started; settlement reports `resumable`.
5. Gate verification outcomes: `passed`, `failed` (executed, red), `blocked` (could not
   evaluate). Runner exceptions are `blocked`, never `failed`.
6. `update-task`, `commit`, scope enforcement and writer claims are untouched for `fail`.
7. (D6) Explicit `task-verification` catalog action; the `'npm test'` string match is
   removed and shipped definitions are migrated to it.

## Interfaces and boundaries

- Consumes: `definitions/schema.mjs`, `step-runner.mjs` (`inspectGates`, `verifyGates`),
  `finish-operation.mjs`, `operation-record.mjs`, `gates/command-gate.mjs`.
- Behavior is shared by CLI `finish`, human-step and `batch finish` because all call
  `finishStep`.

## Area-specific acceptance criteria

See change-wide criteria 10–13, 15 in `overview.md`.

## Dependencies

None on Area A (tests for criterion 13 also cover `batch finish` once task 03 lands, but
are written against the shared `finishStep`).

## Out of scope

Recording failed-check output as non-blocking evidence; changes to `implementation` or
`human-verification` gates; question-tool (`ask_user`) behavior itself.
