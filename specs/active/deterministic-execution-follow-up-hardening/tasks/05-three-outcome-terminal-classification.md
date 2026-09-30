---
id: three-outcome-terminal-classification
status: draft
change: deterministic-execution-follow-up-hardening
context:
  required:
    - specs/active/deterministic-execution-follow-up-hardening/overview.md
    - specs/active/deterministic-execution-follow-up-hardening/areas/terminal-execution-classification-and-resumability.md
    - specs/active/deterministic-execution-follow-up-hardening/owner-decisions.md
    - tools/specs/workflow/execution-settlement.mjs
    - tools/specs/workflow/step-context.mjs
    - tools/specs/workflow/operation-record.mjs
  optional:
    - tools/specs/workflow/readiness-policy.mjs
    - tools/specs/workflow/start-operation.mjs
allowed_paths:
  - tools/specs/workflow/execution-settlement.mjs
  - tools/tests/execution-settlement.test.mjs
forbidden_paths:
  - tools/dashboard/**
  - tools/specs/workflow/cli.mjs
  - tools/specs/workflow/reconciliation.mjs
  - tools/specs/workflow/operation-record.mjs
  - tools/specs/workflow/finish-operation.mjs
  - tools/specs/workflow/start-operation.mjs
  - src/**
depends_on:
  - shared-finish-operation-replayability-classifier
semantic_references:
  decisions: [D1, D2, D3]
  dependency_contracts: [shared-finish-operation-replayability-classifier]
---

# Task: Three-outcome terminal classification

## Dependencies

`shared-finish-operation-replayability-classifier` — imports its exported replayability
function; never reimplements the running/blocked/unknown distinction locally. This is the
same D2 rule `readiness-policy.mjs` (task 02) applies on the admission side, via the
identical shared helper.

## Goal

Extend `assessExecutionSettlement`'s result with an explicit `outcome` field —
`'completed' | 'resumable' | 'recovery-required'` — per the model in `owner-decisions.md`
D1/D2/D3, without introducing any new persisted state. This task changes only the
classification function itself; tasks 06–07 update its consumers.

`resumable` is broader than "an attempt is mid-flight" (D1 amendment, spec-review F1): it
means *the execution/turn ended safely, no ambiguous durable operation requires recovery, but
the workflow still permits further legal work* — covering **three** cases, not two:

1. an active attempt left unfinished;
2. a pre-activation remediation turn that ends while its activation blocker still exists
   (never activated at all);
3. a finish operation left behind by this execution whose persisted state is proven
   deterministically replayable (D2 amendment, this correction) — checked via task 01's
   shared `isFinishOperationReplayable` against whatever record
   `findInFlightOperationRecord` returns, exactly the same semantic rule
   `readiness-policy.mjs` applies when *admitting* a new execution against an existing
   finish-operation record. D2 governs both sides of the lifecycle identically: the same
   record state that would let a *new* execution be admitted writable must also let a
   *terminating* execution release cleanly instead of being forced into `recovery-required`.

`completed` still means *only* "a real transition genuinely happened during this execution."
`recovery-required` is now reserved for what D2 actually calls ambiguous: an in-flight
start-operation record (unchanged — see Out of scope), or an in-flight finish-operation
record whose state is *not* proven replayable.

## Acceptance criteria

- In-flight **start**-operation record present → `outcome: 'recovery-required'` (unchanged
  trigger condition, untouched by this task's finish-operation correction — see Out of
  scope). `automated: node --test tools/tests/execution-settlement.test.mjs`
- In-flight **finish**-operation record present, and task 01's shared classifier proves it
  deterministically replayable → `outcome: 'resumable'` (corrected — previously
  unconditionally `recovery-required`), with the durable finish-operation record left
  completely intact (this task never writes, deletes, or resets it — settlement only reads
  it to classify). `automated: node --test tools/tests/execution-settlement.test.mjs`
- In-flight **finish**-operation record present, and task 01's shared classifier does
  *not* prove it replayable (ambiguous/blocked/unknown) → `outcome: 'recovery-required'`,
  unchanged fail-closed behavior. `automated: node --test tools/tests/execution-settlement.test.mjs`
- No in-flight record, `workflow_progress.state === 'active'` → `outcome: 'resumable'`,
  regardless of in-scope dirty files (in-scope WIP never blocks this outcome).
  `automated: node --test tools/tests/execution-settlement.test.mjs`
- No in-flight record, `workflow_progress.state !== 'active'`, and this execution never
  activated the attempt at all (an activation-only precondition was still open when the
  turn ended) → `outcome: 'resumable'` (moved from `completed`, D1/F1 amendment), in-scope
  dirty files here do **not** block (they are the pre-existing activation blocker,
  re-reported correctly at the next activation attempt, not a settlement failure).
  `automated: node --test tools/tests/execution-settlement.test.mjs`
- No in-flight record, `workflow_progress.state !== 'active'`, and the attempt genuinely
  advanced during this execution (per the smallest reliable signal chosen — document it in
  this task's implementation, e.g. a step/attempt value captured at classification-context
  creation, not persisted on the claim) → `outcome: 'completed'` — the *only* case this
  outcome now covers — with in-scope dirty files still flagged exactly as today (`reason:
  'dirty-in-scope-files'` preserved on the result).
  `automated: node --test tools/tests/execution-settlement.test.mjs`
- A test explicitly distinguishes all three `resumable` sub-cases (active-mid-flight,
  never-activated, replayable-finish-left-behind) and asserts each produces byte-for-byte
  identical `workflow_progress` before and after classification, and that the
  replayable-finish sub-case's durable operation record is unchanged by classification.
  `automated: node --test tools/tests/execution-settlement.test.mjs`
- Dirty files outside the task's owned scope (including ones matching `forbidden_paths`)
  are computed and attached to the result as a non-blocking diagnostic field on every
  outcome — never causing `recovery-required` by themselves, never silently dropped.
  `automated: node --test tools/tests/execution-settlement.test.mjs`
- The function's existing `settled` boolean and `reason` fields remain present and correct
  for any caller not yet migrated (backward compatible until tasks 06–07 land).
  `automated: node --test tools/tests/execution-settlement.test.mjs`

## Verification

```bash
node --test tools/tests/execution-settlement.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Updating `admission.mjs`/`reconciliation.mjs`/`cli.mjs` to consume `outcome` (task 06).
Dependency-consumption idempotency (task 07). Audit trail (task 08). **Start-operation
records** (`start-operation.mjs`/`findInFlightStartOperation`) keep their current,
unconditional `recovery-required` handling — D2's correction in this pass is scoped to
finish-operation records only, per the owner's explicit framing. A structurally similar
running/blocked/reconciliation-required distinction may exist for start-operation records
too (the same stage-based resumability pattern `cli.mjs`'s `consumesDependencies` block
uses), but this is flagged here as a separate, unaddressed observation for a future owner
decision, not folded into this task.
