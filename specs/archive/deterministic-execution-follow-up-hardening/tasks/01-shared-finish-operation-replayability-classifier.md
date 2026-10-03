---
id: shared-finish-operation-replayability-classifier
status: draft
change: deterministic-execution-follow-up-hardening
context:
  required:
    - specs/active/deterministic-execution-follow-up-hardening/overview.md
    - specs/active/deterministic-execution-follow-up-hardening/owner-decisions.md
    - tools/specs/workflow/finish-operation.mjs
    - tools/specs/workflow/operation-record.mjs
allowed_paths:
  - tools/specs/workflow/operation-record.mjs
  - tools/tests/workflow-operation-record.test.mjs
forbidden_paths:
  - tools/specs/workflow/finish-operation.mjs
  - tools/specs/workflow/readiness-policy.mjs
  - tools/specs/workflow/execution-settlement.mjs
  - tools/specs/workflow/cli.mjs
  - tools/dashboard/**
  - src/**
semantic_references:
  decisions: [D2]
---

# Task: Shared finish-operation replayability classifier

## Goal

D2's semantic rule — *a persisted finish operation is agent-remediable/safely-resumable only
when its current durable state proves the operation is deterministically replayable;
ambiguous or already reconciliation-required finish states are not* — governs **two**
independent call sites: admitting a *new* execution against an existing finish-operation
record (`readiness-policy.mjs`'s `FINISH_OPERATION_UNRESOLVED` check, prior-step's record),
and classifying a *terminating* execution that left a finish-operation record behind
(`execution-settlement.mjs`'s in-flight-finish-operation check, current-step's record). Both
call sites already import shared record I/O from `tools/specs/workflow/operation-record.mjs`
(`loadOperationRecord`, `findInFlightOperationRecord`) rather than duplicating file-reading
logic — this task extends that same shared module with one semantic function, so the
replayability *rule* is defined exactly once and consumed by both, never duplicated or
allowed to drift into contradictory interpretations between admission and settlement.

## Implementation constraints

- Export exactly one function (e.g. `isFinishOperationReplayable(record)`) from
  `operation-record.mjs`, taking a loaded finish-operation record (the same shape
  `loadOperationRecord`/`findInFlightOperationRecord` already return) and returning a
  boolean.
- The function's **contract is semantic** — "is this record's current state proven safe to
  replay through the normal `workflow step finish` path" — not a hard-coded pass-through of
  today's status literals. The current implementation maps `record.status === 'running'` to
  `true` and `'blocked'`/`'unknown'` to `false` (per `finish-operation.mjs`'s own
  `ensureUpdateTask`/`ensureCommit`/`ensurePush` reconciliation logic, which is what
  actually assigns `'blocked'`/`'unknown'` when a stage self-diagnoses an inconsistent
  state) — document this mapping as the current representation, not as the abstraction
  callers depend on.
- Do not change `finish-operation.mjs`'s own stage logic, status assignment, or crash
  reconciliation — this task only reads and classifies already-produced record shapes.
- Neither `readiness-policy.mjs` nor `execution-settlement.mjs` is edited by this task
  (tasks 02 and 05 do that, each importing this function) — this task only adds the shared
  primitive and its own unit coverage.

## Acceptance criteria

- `isFinishOperationReplayable` (or equivalent) returns `true` for a record with
  `status: 'running'`, and `false` for `status: 'blocked'` and `status: 'unknown'` — tested
  against real record shapes produced by `finish-operation.mjs`'s stage functions (e.g. by
  driving `ensureUpdateTask`/`ensureCommit` into their own `reconciliation-required` branches
  and capturing the resulting record), not hand-constructed fixtures alone.
  `automated: node --test tools/tests/workflow-operation-record.test.mjs`
- Returns `false` (fails closed) for a missing/malformed record, and for any status value
  not explicitly known to be safely replayable — the function never defaults to `true` for
  an unrecognized status. `automated: node --test tools/tests/workflow-operation-record.test.mjs`
- A single source of truth: a static/structural check (e.g. grep-based test or code review
  note) confirms no second implementation of this same running/blocked/unknown distinction
  exists elsewhere after tasks 02 and 05 land — enforced by those tasks importing this
  function rather than reimplementing the check (verified as part of tasks 02/05's own
  acceptance criteria, not duplicated here).

## Verification

```bash
node --test tools/tests/workflow-operation-record.test.mjs
node tools/specs.mjs validate
```

## Out of scope

`finish-operation.mjs`'s own logic. `readiness-policy.mjs`/`execution-settlement.mjs`
consuming this function (tasks 02/05). Start-operation records
(`start-operation.mjs`/`findInFlightStartOperation`) — a structurally similar
running/blocked/reconciliation-required distinction may exist there too (the same
stage-based resumability pattern `cli.mjs`'s `consumesDependencies` block uses), but this
was not raised as part of D2 and is flagged here as a separate, unaddressed observation for
a future owner decision, not folded into this task's scope.
