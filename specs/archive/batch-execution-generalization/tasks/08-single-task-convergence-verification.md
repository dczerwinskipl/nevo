---
id: single-task-convergence-verification
status: draft
change: batch-execution-generalization
context:
  required:
    - specs/active/batch-execution-generalization/overview.md
    - specs/active/batch-execution-generalization/discovery.md
    - tools/dashboard/server/ai/orchestration/deterministic-execution-plan.mjs
    - tools/dashboard/server/ai/orchestration/reconciliation.mjs
    - tools/dashboard/server/ai/orchestration/admission.mjs
semantic_references:
  decisions: []
allowed_paths:
  - tools/tests/single-task-convergence.test.mjs
forbidden_paths:
  - src/**
  - tools/dashboard/ui/**
  - tools/dashboard/server/ai/orchestration/deterministic-execution-plan.mjs
  - tools/dashboard/server/ai/orchestration/reconciliation.mjs
  - tools/dashboard/server/ai/orchestration/admission.mjs
depends_on: [queue-removal-and-reservation-storage-migration, batch-admission-generalization, batch-finish-phase-neutral-generalization]
---

<!--
Scope amendment (implementation-time, legacy lifecycle — same pattern as tasks 01, 03,
05, and 07's own amendments, references/review-policy.md "Specification scope
amendment"): this task's own `## Verification` section's second command, `node --test
tools/tests/*.test.mjs`, reliably hangs forever when run via `tools/specs.mjs
self-check`/`verify` — confirmed directly while executing task 07 (see that task's own
identical amendment for the full root-cause writeup: `runVerificationCommand` passes
the literal glob to `execFileSync`/`node --test` unexpanded, no shell to expand the
`*`, and this Node version hangs rather than erroring on it). Changed to `tools/tests/`
(a directory, routes through `runVerificationCommand`'s own working directory-expansion
instead) — identical set of files, zero change to what this task actually verifies.
Pre-existing, environment-level tooling gap, unrelated to tasks 01-03's own scope; not
patched in `verify/operation.mjs` itself (out of this task's scope).
-->

# Task: Verify single-task execution converges on shared primitives without a separate scheduler

## Goal

Owner's closed decision (`discovery.md`, round 3): `ExecutionScope {task|task-batch}`
stays as two scope shapes; both converge on one shared orchestration lifecycle and
shared primitives, without a one-task scope fabricating group-reservation/
`BatchContext` metadata, and without retaining any separate queue/scheduler/
continuation engine alongside the batch path. Task 01 removes the queue; tasks 02-03
generalize the batch path. This task is the dedicated check that single-task
execution — after all of that — still behaves correctly and genuinely shares
primitives rather than accidentally keeping its own parallel implementation. New test
file only; this task does not change production code — any gap found is a finding to
report, resolved by whichever of tasks 01-03 actually owns the affected code.

## Requirements

Write tests that directly exercise, after tasks 01-03 land:
1. A single-task manual Start resolves readiness and admits without touching any
   queue file or batch-reservation record (confirms task 01's removal is complete and
   the single-task path never grew a dependency on batch machinery).
2. A single-task manual Start does not fabricate a `groupReservation`/`BatchContext`
   — its admission path is observably simpler than a 2+-member batch's, not merely
   "a batch of one" in disguise.
3. Same-task auto-continuation (`continuation: auto`) still works end to end with no
   queue involvement (confirms task 01's `reconcileWorkflowPosition` rework).
4. The gate-verification/transition-derivation logic a single task's finish uses is
   demonstrably the same function(s) a batch member's finish uses (per task 03's
   reuse of `finishStep`'s non-commit/push stages) — not a second, independently
   maintained implementation.

## Implementation constraints

- This task does not modify any production file — if single-task execution and
  batch execution turn out to not actually share the primitives tasks 01-03 claimed
  to generalize, report the specific divergence rather than patching it here.

## Acceptance criteria

- All 4 checks above pass.
  `automated: node --test tools/tests/single-task-convergence.test.mjs`

## Verification

```bash
node --test tools/tests/single-task-convergence.test.mjs
node --test tools/tests/
node tools/specs.mjs validate
```

## Out of scope

Any production code change.
