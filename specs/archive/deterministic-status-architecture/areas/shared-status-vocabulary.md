# Area: Shared status vocabulary

## Responsibility

Extract `TERMINAL_STATUSES` — the one piece of `tools/specs/lifecycle-primitives.mjs` the
deterministic engine genuinely needs — into a neutral, shared module, and remove the two
existing deterministic-side imports of `lifecycle-primitives.mjs` that make it, so the
import-boundary regression test (`areas/lifecycle-boundary-guards.md`) can actually pass
rather than fail on its own first run (D8).

## Current state

`tools/specs/lifecycle-primitives.mjs` exports `TERMINAL_STATUSES`,
`DEPENDENCY_SATISFYING_STATUSES`, `READY_STATUSES`, `TASK_STATUSES`/`CHANGE_STATUSES`,
`depsSatisfied`, `isTaskReady`, and `TRANSITIONS` — a mix of genuinely shared persistence
vocabulary (`TERMINAL_STATUSES`) and legacy-specific interpretation of it (everything else).
Grep-confirmed (2026-09-19): exactly two files under `tools/specs/workflow/**` import from
it, both for `TERMINAL_STATUSES` only — `tools/specs/workflow/finish-operation.mjs`
(terminal-vs-internal transition discrimination, `discriminateTarget`) and
`tools/specs/workflow/definitions/schema.mjs` (`validateTransitionDefinition`'s check that a
transition's `to` is either a declared step or a member of `TERMINAL_STATUSES`, and the
step-name-collision check). No other file in `tools/specs/workflow/**` imports it.

## Requirements

- New module (e.g. `tools/specs/status-vocabulary.mjs`) exporting `TERMINAL_STATUSES` as
  its single source of truth.
- `tools/specs/lifecycle-primitives.mjs` imports and re-exports it
  (`export { TERMINAL_STATUSES } from './status-vocabulary.mjs'`) — every existing legacy
  import path (`tools/specs/{approve,start,complete,verify}/**`, `tools/specs/context.mjs`,
  etc.) keeps working unchanged.
- `tools/specs/workflow/finish-operation.mjs` and `tools/specs/workflow/definitions/schema.mjs`
  change their `TERMINAL_STATUSES` import to the new neutral module directly — these are
  the only two files this task needs to touch for the import change itself.
- `DEPENDENCY_SATISFYING_STATUSES`, `READY_STATUSES`, `TASK_STATUSES`/`CHANGE_STATUSES`,
  `depsSatisfied`, `isTaskReady`, `TRANSITIONS` all stay exactly where they are, in
  `lifecycle-primitives.mjs`, legacy-only — none of this is extracted.

## Constraints

- No behavior change anywhere — `TERMINAL_STATUSES`'s value and every consumer's use of it
  is byte-for-byte identical before and after this extraction.
- This task must land, and actually remove both existing imports, before
  `lifecycle-boundary-regression-tests` enables its "no `lifecycle-primitives.mjs` import"
  static check — otherwise that check fails immediately against real, pre-existing code.

## Interfaces and boundaries

Exposes: `TERMINAL_STATUSES` from `tools/specs/status-vocabulary.mjs`.

Consumed by: `tools/specs/lifecycle-primitives.mjs` (re-export, legacy compatibility),
`tools/specs/workflow/finish-operation.mjs`, `tools/specs/workflow/definitions/schema.mjs`,
and (per `areas/step-executor-model.md`) the same schema module's new `outcome`-field
validation, which also needs `TERMINAL_STATUSES` to check a transition's `to`.

## Area-specific acceptance criteria

- `tools/specs/status-vocabulary.mjs` exports `TERMINAL_STATUSES` with the identical value
  (`implemented`/`verified`/`archived`/`abandoned`).
- `tools/specs/lifecycle-primitives.mjs`'s own `TERMINAL_STATUSES` export still works for
  every existing legacy importer, unchanged.
- `finish-operation.mjs` and `definitions/schema.mjs` import `TERMINAL_STATUSES` from the
  new neutral module, not from `lifecycle-primitives.mjs`.
- Every existing legacy and deterministic-workflow-engine test suite that exercises
  terminal-status logic continues passing unchanged.
- Grepping `tools/specs/workflow/**` for `lifecycle-primitives` returns zero matches after
  this task.

## Dependencies

None — small, foundational, independent extraction.

## Out of scope

Extracting anything beyond `TERMINAL_STATUSES` (D8 — `isTaskReady`, dependency-satisfying
statuses, and legacy transitions stay legacy-only). The import-boundary regression test
itself (owned by `areas/lifecycle-boundary-guards.md`, which depends on this area).
