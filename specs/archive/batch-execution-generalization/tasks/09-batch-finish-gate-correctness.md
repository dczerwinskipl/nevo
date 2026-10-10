---
id: batch-finish-gate-correctness
status: draft
change: batch-execution-generalization
context:
  required:
    - specs/active/batch-execution-generalization/overview.md
    - tools/specs/workflow/batch-finish/operation.mjs
    - tools/specs/workflow/finish-operation.mjs
    - tools/specs/workflow/cli.mjs
    - tools/specs/workflow/dependency-consumption.mjs
semantic_references:
  decisions: []
allowed_paths:
  - tools/specs/workflow/batch-finish/operation.mjs
  - tools/tests/batch-finish-operation.test.mjs
  - tools/tests/batch-finish-gate-correctness.test.mjs
  - tools/tests/batch-cli-and-security.test.mjs
forbidden_paths:
  - src/**
  - tools/dashboard/**
  - tools/specs/workflow/finish-operation.mjs
  - tools/specs/workflow/batch-start/**
  - tools/specs/workflow/queue/**
depends_on: [batch-finish-phase-neutral-generalization, intra-batch-dependency-consumption-materialization]
---

<!--
Scope amendment (implementation-time, legacy lifecycle — same pattern as tasks 01, 03,
05, 07, and 08's own amendments, references/review-policy.md "Specification scope
amendment"): tools/tests/batch-cli-and-security.test.mjs's `setupTestRepo` copies the
real .nevo-ai/workflows/standard.yaml, whose `implementation` step declares a real
`action: test` exit gate. Before this task's fix, that gate was silently never
evaluated for real (the exact bug this task fixes), so 3 of its tests passed despite
never actually exercising a working gate. With the fix, the gate genuinely runs `npm
test` — and the fixture had no package.json, so it genuinely fails (ENOENT), correctly
blocking those 3 tests now that the gate is real — a mechanical, necessary consequence
of this task's own fix, not a scope expansion of what the task does. Added a real
package.json with a trivial passing test script, matching every other gate-correctness
fixture in this task's own new test file.
-->


# Task: Make `BatchFinish`'s per-member finish use real gate infrastructure and respect its own outcome

## Goal

Corrective task from the post-implementation review (`overview.md` § "Post-implementation
review correction", finding 1). `executeBatchFinish`'s Stage 4 (`batch-finish/operation.mjs`)
calls `finishStep` without a `gateRegistry`, so it silently falls back to the module-level
`defaultGateRegistry` (`registry.mjs`), whose `CommandGate` has no verification store
configured. Any step with a `command`-type exit gate — exactly what the real
`standard-v1`'s `implementation`/`review` steps declare — can never pass through the
batch path, regardless of whether the underlying command actually succeeds. Independently,
and just as seriously: the per-member loop writes `memberFinishes[taskId] = {status:
'completed', ...}` unconditionally from whatever `finishStep` returns, without checking
its own `status` field — so a `'blocked'`, `'input-required'`, or
`'reconciliation-required'` result (anything other than a genuine terminal completion) is
silently treated as a successfully finished member, and the batch proceeds to the shared
commit/push and its own overall `'completed'` status with zero real progress for that
member.

## Requirements

- Build and pass the same kind of real, correctly-configured `gateRegistry` the
  single-task CLI finish path builds (`buildWorkflowGateRegistry`, `tools/specs/workflow/cli.mjs`
  — a fresh `MemoryCommandVerificationStore` plus a real `FileHumanVerificationStore`,
  keyed by this member's own `changeSlug`/`taskId`/`attempt`) into every per-member
  `finishStep` call in Stage 4. Reuse `buildWorkflowGateRegistry` itself — do not write a
  second, parallel gate-registry construction.
- After each `finishStep` call, treat only `{status: 'completed'}`, `{status:
  'already-complete'}`, and `{status: 'already-completed'}` as "this member's finish
  stage is done." Any other returned `status` (`'blocked'`, `'input-required'`,
  `'reconciliation-required'`, or any future non-terminal value) must **not** be recorded
  as `memberFinishes[taskId].status = 'completed'` — `executeBatchFinish` itself must stop
  there and report the batch as not finished (a thrown `WorkflowError` carrying the
  member's own blocking detail, or an equivalent non-`'completed'` return — pick whichever
  shape is more consistent with how `executeBatchFinish`'s other failure paths already
  signal "did not complete" to its own callers; do not invent a second convention).
- Do not call `tryCompleteDependencyConsumption` (task 04's materialization sweep) for a
  member whose own `finishStep` call did not reach a genuine terminal completion in this
  same invocation — a transition that didn't actually happen must not release a
  dependency epoch for its downstream consumers.
- Do not proceed to Stage 5 (shared commit/push) while any member's own finish has not
  reached genuine completion.
- Preserve existing resumability: re-running `executeBatchFinish` after a real,
  external remediation (e.g. the actual command now passes, or a human verification
  record now exists) must pick up exactly where it left off — already-`'completed'`
  members are still skipped via the existing `memberFinishes[taskId]?.status ===
  'completed'` check; a previously-blocked member gets a fresh `finishStep` attempt with
  a fresh gate evaluation, not a stale cached result.
- Preserve crash-safe replay: a crash immediately after a member's `finishStep` call
  returns a genuine `'completed'` result, before `saveBatchFinishRecord` persists it,
  must still resume correctly on retry (no new behavior required here beyond what
  already exists — confirm with a test, do not assume).

## Implementation constraints

- Do not modify `finish-operation.mjs` itself (forbidden path) — `finishStep`'s own
  stage sequence and return shapes are correct as specified; this task only wires the
  real gate registry into the existing call and correctly reacts to what it already
  returns.
- Do not modify `dependency-consumption.mjs`/`start-operation.mjs` or anything under
  `tools/specs/workflow/queue/**` — this task changes gate wiring and outcome-handling
  in `batch-finish/operation.mjs` only.
- `buildWorkflowGateRegistry` is defined in `cli.mjs`; importing it from
  `batch-finish/operation.mjs` is intentional reuse, not a layering violation — confirm
  the existing "zero references to `tools/dashboard/**`" static check (test 7 in
  `batch-finish-operation.test.mjs`) still passes, since `cli.mjs` itself must not pull
  in any dashboard-side module transitively.

## Acceptance criteria

- A batch member whose target step has a real `command`-type exit gate that actually
  fails is recorded as blocked, not completed; the batch does not reach `'completed'`,
  no shared commit/push happens, and no dependency-consumption entry is materialized for
  that member's downstream consumers.
  `automated: node --test tools/tests/batch-finish-gate-correctness.test.mjs`
- The same scenario, after the underlying condition is remediated (the command now
  passes) and `executeBatchFinish` is re-invoked, completes that member and the whole
  batch correctly, without re-running already-completed members' own gates.
  `automated: node --test tools/tests/batch-finish-gate-correctness.test.mjs`
- A batch using the real `standard-v1`-shaped workflow (real `command`-type exit gates,
  not `exitGates: []`) with a genuinely passing command finishes successfully end to
  end — exactly one shared commit, correct transitions.
  `automated: node --test tools/tests/batch-finish-gate-correctness.test.mjs`
- All existing `batch-finish-operation.test.mjs` tests (which use a deliberately
  simplified `exitGates: []` fixture for unrelated concerns) still pass unchanged.
  `automated: node --test tools/tests/batch-finish-operation.test.mjs`

## Verification

```bash
node --test tools/tests/batch-finish-gate-correctness.test.mjs
node --test tools/tests/batch-finish-operation.test.mjs
node tools/specs.mjs validate
```

## Out of scope

The production admission route generalization (task 10) and grouped-handover durability
(task 11) — this task is scoped to `BatchFinish`'s own per-member gate correctness only.
