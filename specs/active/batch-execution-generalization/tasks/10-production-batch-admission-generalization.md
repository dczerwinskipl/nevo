---
id: production-batch-admission-generalization
status: draft
change: batch-execution-generalization
context:
  required:
    - specs/active/batch-execution-generalization/overview.md
    - tools/dashboard/server/ai/sessions/turns/routes.mjs
    - tools/specs/workflow/queue/reservation.mjs
    - tools/dashboard/server/ai/orchestration/admission.mjs
    - tools/dashboard/server/ai/sessions/execution-policy-service.mjs
semantic_references:
  decisions: []
allowed_paths:
  - tools/dashboard/server/ai/sessions/turns/routes.mjs
  - tools/dashboard/tests/execution-policy.test.mjs
  - tools/tests/dashboard-orchestration-wiring.test.mjs
  - tools/tests/production-batch-admission.test.mjs
forbidden_paths:
  - src/**
  - tools/dashboard/ui/**
  - tools/specs/workflow/**
  - tools/dashboard/server/ai/orchestration/batch-completion-settlement.mjs
depends_on: [queue-removal-and-reservation-storage-migration, batch-admission-generalization, batch-finish-gate-correctness]
---

# Task: Generalize the production batch-start route beyond "review together"

## Goal

Corrective task from the post-implementation review (`overview.md` § "Post-implementation
review correction", finding 2). `tools/dashboard/server/ai/sessions/turns/routes.mjs`'s
batch-start branch (triggered by `body.reviewTogether === true || body.batchReview ===
true || body.scope?.kind === 'task-batch'`) is the *only* production, user-facing path
that creates a group reservation and starts a batch. After calling the already-generalized
`validateBatchCompatibility` (task 02), it hardcodes:
```
if (compat.role !== 'reviewer') {
  throw new AiValidationError(`Batch execution is restricted to the 'reviewer' role in v1 ...`);
}
```
and resolves execution policy with a hardcoded `role: 'reviewer'`. A brand-new,
dependency-ordered implementation batch — `validateBatchCompatibility`'s own entry-step
exception correctly returns `role: null` for exactly this case — is rejected by the real
API before it ever reaches `executeBatchStart`. Every existing passing test for tasks
02-08 calls `createGroupReservation`/`executeBatchStart` directly, so this restriction was
never exercised against a real implementation batch.

## Requirements

- Remove the `compat.role !== 'reviewer'` rejection and the hardcoded `role: 'reviewer'`
  execution-policy resolution. Resolve role, target step, executor, and session policy
  from `compat`'s own already-computed result (the same full execution contract
  `validateBatchCompatibility` already resolves and `resolveMemberDestination`-equivalent
  logic elsewhere in this change reads) — not a second, route-local re-derivation.
- A brand-new batch with no incoming role (`compat.role === null`, the entry-step case)
  must be accepted and started the same way a `role: 'reviewer'` batch is today —
  resolve execution policy with whatever role is actually correct for that batch
  (`null`/the target step's own default), not a hardcoded string.
- Keep calling `validateBatchCompatibility` before `createGroupReservation`, exactly as
  today — this task generalizes what happens with its result, not whether it runs.
- Do not weaken any existing readiness/compatibility check: an external, unsatisfied
  dependency outside the batch must still reject; a genuinely incompatible mixed-contract
  selection must still reject with the existing, specific error naming the incompatible
  task.
- The policy-conflict detection (`hasPolicyConflict`, lines ~159-166 today) and the
  `oneOff`/explicit-provider override logic must keep working for every resolved role,
  not only `'reviewer'`.
- Preserve the model this whole change commits to: one explicitly selected, compatible
  group of tasks → one batch execution → one session for the group. Do not add any
  automatic selection of which tasks go into a batch, any new queue/scheduler, or an
  `ExecutionRun`-style abstraction — the caller (`selectedTaskIds`) still decides
  membership; this task only removes the artificial role restriction on what that
  explicitly-selected group is allowed to be.

## Implementation constraints

- Do not modify `tools/specs/workflow/queue/reservation.mjs` (`validateBatchCompatibility`
  itself, forbidden path) — it already resolves the correct role/contract for every
  case this task needs; read its result, do not duplicate its logic.
- Do not touch `batch-completion-settlement.mjs` (task 11's own scope) even though it
  shares conceptual territory (admission/compatibility) — this task is the manual,
  user-initiated start route only.
- The route's existing naming (`reviewTogether`, `batchReview` body flags) may stay as
  the trigger condition for now (renaming the wire contract is a larger, separate
  concern) — this task generalizes what happens *after* the batch-start branch is
  entered, not which request shapes enter it.

## Acceptance criteria

- A request selecting 3 brand-new, dependency-ordered tasks with no incoming role
  (`compat.role === null`) is accepted by the route, creates a group reservation, and
  starts a batch — not rejected.
  `automated: node --test tools/tests/production-batch-admission.test.mjs`
- A request selecting tasks with a genuinely incompatible mixed resulting contract is
  still rejected, naming the incompatible task, exactly as today.
  `automated: node --test tools/tests/production-batch-admission.test.mjs`
- A request where one selected task has an unsatisfied dependency *outside* the
  selected batch is still rejected (external dependencies still block).
  `automated: node --test tools/tests/production-batch-admission.test.mjs`
- A request where a selected task's only unsatisfied dependency is another *member of
  the same batch* is still accepted (same-batch dependency exception, task 02,
  unaffected by this task).
  `automated: node --test tools/tests/production-batch-admission.test.mjs`
- The existing `'reviewer'`-role "Review together" path (execution-policy resolution,
  policy-conflict detection, `oneOff` override) behaves identically to before this
  task's change.
  `automated: node --test tools/dashboard/tests/execution-policy.test.mjs tools/tests/dashboard-orchestration-wiring.test.mjs`

## Verification

```bash
node --test tools/tests/production-batch-admission.test.mjs
node --test tools/dashboard/tests/execution-policy.test.mjs
node --test tools/tests/dashboard-orchestration-wiring.test.mjs
node tools/specs.mjs validate
```

## Out of scope

`BatchFinish` gate correctness (task 09, already a dependency), grouped-handover
durability (task 11) — this task is scoped to the manual production start route only.
