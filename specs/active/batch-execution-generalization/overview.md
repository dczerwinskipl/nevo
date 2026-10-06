---
id: spec.batch-execution-generalization
type: change
title: "Generalize task-batch into the primary multi-task execution model"
status: draft
change: batch-execution-generalization
---

# Generalize task-batch into the primary multi-task execution model

Full discovery, evidence, and decision history: `discovery.md` (three rounds — do not
re-derive what's already established there; this file is the task breakdown built on
top of it).

## Context

Triggered by the runaway-session-creation incident on `ai-spec-history` (fixed
separately, `81bcfe45`/`b5f78606`/`273a4512` on this same branch). Reviewing that fix
led the owner to audit the generic durable sequential queue and the existing
`task-batch`/`ExecutionScope` machinery directly, converging over three discovery
rounds on: generalize the existing batch primitive (built today only for homogeneous
"review together") into the primary model for implementation, review, and refinement
— one session per batch, agent executes the whole dependency-ordered group inside
that session — and retire the generic queue, which nothing actually needs once batch
admission stops depending on it.

## Current architecture

See `discovery.md` in full. Six confirmed gaps, each with exact file:line evidence,
block the current `task-batch` code from supporting anything beyond homogeneous
"review together":
1. `executeBatchStart` re-checks single-task readiness per member and requires an
   incoming transition that structurally cannot exist for a fresh task — no batch of
   brand-new tasks can start today.
2. `BatchFinish`'s preflight requires a `result` field for every member unconditionally
   — rejected by `finishStep` itself for an unconditional step (e.g. `implementation`).
3. `BatchFinish` always renders+commits the review report and calls `finishStep` once
   per member — N commits/pushes, not one shared finalize.
4. Dependency-consumption recording (`planStart`'s frozen `consumptionSequence`) is
   never invoked by batch-start at all; intra-batch dependencies have no upstream
   release epoch to record against at batch-start time by construction.
5. The heterogeneous mixed-step `BatchContext` idea (an earlier revision) is
   unnecessary — a dependency-blocked task's canonical `nextStep` is unchanged by the
   block, so dependency-ordered batches stay homogeneous by target step.
6. Batch-completion handover dispatches one independent fresh-refiner session per
   failed member instead of one session per group of members sharing a full execution
   contract.

Also confirmed: the generic sequential queue (`tools/specs/workflow/queue/{store,evaluator}.mjs`)
has no caller that single-task Start/continuation actually needs, and `schedulingPriority`
is reachable only through the one drain path responsible for the original incident.
`groupReservations` (the batch barrier/reservation) is call-graph independent of the
plain queue but storage-coupled to it today (same JSON file).

## Constraints

- Legacy lifecycle for this change (same principle as `deterministic-flow-hardening-pt3`:
  the agent should not be the one driving the deterministic workflow machinery it is
  being asked to change) — confirm/override before `change.yaml` is finalized.
- Workspace-writer claims, the 3-outcome settlement model, session fresh/reuse policy,
  and execution-policy resolution are explicitly unchanged.
- `groupReservations`'s own call-graph logic (D31/D33/D36/D37) is sound and unchanged
  — only its storage location moves.
- The dependency-consumption *recording* contract (D52/D53/D58) is reused as-is, new
  timing only. Its remediation/invalidation *consumer* side has zero production call
  sites today (confirmed by direct grep) — this change does not complete that path,
  it keeps the recorded data correct for whenever it is built.
- No heterogeneous mixed-step batch in v1 — batches stay homogeneous by full execution
  contract (target step/executor, role, session policy, resolved execution policy).

## Affected modules

`tools/specs/workflow/queue/**`, `tools/specs/workflow/batch-start/`,
`tools/specs/workflow/batch-finish/`, `tools/specs/context/batch-context.mjs`,
`tools/specs/workflow/dependency-consumption.mjs`/`start-operation.mjs` (timing only,
not reshaped), `tools/dashboard/server/ai/orchestration/{admission,reconciliation,
batch-completion-settlement}.mjs`, `tools/dashboard/server/ai/sessions/turns/routes.mjs`,
`tools/dashboard/ui/screens/specification-detail/specification-overview.tsx`.

## Owner decisions

Recorded in full in `discovery.md` § "Owner decisions" (all three rounds). Summary:
generalized `BatchExecution`/`ExecutionScope`, homogeneous by full execution contract
(not `ExecutionRun`, not heterogeneous); `groupReservations` storage migrates in this
same change, no compatibility shim; UI dependency-duplication fix is in scope;
`BatchFinish` becomes genuinely phase-neutral (per-member canonical `finishContract`,
one shared `batchFinishContract` commit section, optional review-report); dependency-
consumption reuses existing primitives with new timing; handover partitions by full
contract tuple; single-task execution keeps `ExecutionScope{task|task-batch}` on
shared orchestration primitives, no separate scheduler.

## Proposed architecture

See `discovery.md` § "Revised target flows" (implementation batch, review batch,
refinement batch, single-task execution) for the complete, owner-reviewed target
shape. Not restated here — this file decomposes it into tasks.

## Implementation decomposition

Fifteen tasks, ordered by dependency (see each task's own `depends_on`). Tasks 1-8 were
the original decomposition; tasks 9-12 are corrective work appended after a
post-implementation, change-level review found that tasks 1-8's own scoped acceptance
did not, in aggregate, prove the change-wide acceptance criteria in real production
behavior — see "Post-implementation review correction" below. Tasks 13-14 are further
corrective work appended after a second review round found task 11's landed fix still
incomplete and task 12's own proof of automatic resume not actually automatic — see
"Second-round review correction" below. Task 15 is further hardening appended after a
third review round found task 13's own resume trigger insufficiently scope-guarded and
its own test coverage incomplete — see "Third-round review correction" below.

1. `tasks/01-queue-removal-and-reservation-storage-migration.md` — independent.
2. `tasks/02-batch-admission-generalization.md` — independent.
3. `tasks/03-batch-finish-phase-neutral-generalization.md` — depends on 2.
4. `tasks/04-intra-batch-dependency-consumption-materialization.md` — depends on 2, 3.
5. `tasks/05-batch-completion-handover-partitioning.md` — depends on 3, 4.
6. `tasks/06-ui-canonical-dependency-projection.md` — independent.
7. `tasks/07-acceptance-initial-implementation-batch.md` — depends on 2, 3, 4, 5.
8. `tasks/08-single-task-convergence-verification.md` — depends on 1, 2, 3.
9. `tasks/09-batch-finish-gate-correctness.md` — depends on 3, 4.
10. `tasks/10-production-batch-admission-generalization.md` — depends on 1, 2, 9
    (explicit sequencing per the review's own corrective ordering, not only a
    technical necessity).
11. `tasks/11-durable-grouped-handover-dispatch.md` — depends on 2, 5, 10 (explicit
    sequencing, same reason).
12. `tasks/12-real-end-to-end-corrective-acceptance.md` — depends on 9, 10, 11.
13. `tasks/13-durable-grouped-handover-resume-generalization.md` — depends on 11
    (second-round corrective fix to task 11's own landed code).
14. `tasks/14-real-end-to-end-automatic-resume-proof.md` — depends on 12, 13
    (second-round corrective fix to task 12's own Test D).
15. `tasks/15-resume-trigger-scope-guard-and-coverage-hardening.md` — depends on 13, 14
    (third-round hardening fix to task 13's own landed code and test coverage, plus a
    wording reconciliation to task 14's own requirements).

## Change-wide acceptance criteria

- A batch of brand-new, dependency-ordered implementation tasks can start, execute
  under one session, and finish with exactly one commit and one push.
- A dependency-blocked batch member's own, same-batch dependency never blocks batch
  admission; an unsatisfied dependency outside the batch still does.
- A failed review's members produce no more than one new agent session per distinct
  execution-contract group — never one per member.
- No code path remains that creates a new session merely because execution moved from
  one member task to another inside the same batch (one may resume with another turn
  in the same session).
- The generic sequential queue (`enqueueTasks`/`dequeueTask`/`evaluateTaskQueue`'s
  cross-task selection, `schedulingPriority`) is removed, not merely unused.
- `node tools/specs.mjs validate`, the full `tools/tests/*.test.mjs` suite, and the
  dashboard test suites all pass.

## Post-implementation review correction

After tasks 1-8 were each individually implemented and verified against their own
scoped acceptance criteria, a separate change-level review (full diff against the
pre-change baseline, `982180d`) found that two of the change-wide acceptance criteria
above were not actually proven in production behavior, and found two further gaps in
already-"verified" or pre-existing production code. None of this is a claim that tasks
1-8 did the wrong thing against their own stated scope — each is retained as `verified`
exactly as completed. The finding is that the aggregate did not yet establish what the
change as a whole claims.

1. **Batch finish never exercises real gate infrastructure, and silently proceeds past
   a non-terminal member outcome.** `executeBatchFinish` (`batch-finish/operation.mjs`)
   calls `finishStep` without the same `gateRegistry` the single-task CLI finish path
   builds (`buildWorkflowGateRegistry`, `cli.mjs`) — falling back to the default
   registry, whose `CommandGate` has no verification store configured, so the real
   `standard-v1` workflow's `command`-type exit gates can never pass through the batch
   path regardless of whether the underlying command actually succeeds. Independently,
   the per-member loop records `memberFinishes[taskId].status = 'completed'`
   unconditionally, without checking `finishStep`'s own returned `status` — so a
   `'blocked'`/`'input-required'`/`'reconciliation-required'` result is silently treated
   as a successfully finished member. Task 07's own acceptance test discovered and
   documented the first half of this as a FINDING, and worked around it with a test
   fixture using `exitGates: []` — correct and transparent for that task's own
   test-only scope, but it means the change-wide claim "a real brand-new implementation
   batch finishes end-to-end" was never actually exercised against real gates. Task 09
   fixes this in production; task 12 re-proves it against the real `standard-v1`.
2. **No production path starts a generalized batch.** The only two production callers
   of `createGroupReservation`/`executeBatchStart` are the auto-handover inside
   `batch-completion-settlement.mjs` and the `reviewTogether`/`batchReview` route in
   `tools/dashboard/server/ai/sessions/turns/routes.mjs` — which hardcodes
   `compat.role !== 'reviewer'` as a rejection, predating this change. A fresh,
   dependency-ordered implementation batch (`role: null`, the exact case task 02's own
   `validateBatchCompatibility` was generalized to accept) is rejected by the real API.
   Tasks 02-08's own tests all call `createGroupReservation`/`executeBatchStart`
   directly, never through this route, so this gap was never caught. Task 10 fixes this.
3. **Grouped handover cannot actually admit a second contract group, and skips
   compatibility/readiness validation entirely.** When post-finish handover partitions
   members into 2+ execution-contract groups (task 05), every group is admitted in the
   same pass; the first group's `admitAgentExecution` call sets the in-process
   single-active-execution guard for the spec, so the second group's own call
   immediately gets `ACTIVE_EXECUTION_EXISTS` — and is still recorded as a completed,
   `noop` dispatch, permanently losing that group rather than retrying it once the first
   settles. Separately, this path calls `createGroupReservation` directly, never running
   `validateBatchCompatibility` first (every other reservation-creation call site does),
   and hardcodes `sessionPolicy: 'fresh'` on the admission candidate despite grouping
   members by `destination.sessionPolicy` upstream — silently coercing a `'reuse'`
   destination to `'fresh'` were one ever to occur. Task 11 fixes all three.

Corrective tasks 09-12 (added below) resolve these in production behavior, not by
loosening the acceptance criteria or the test fixtures used to prove them. The change
is not ready for approval until tasks 09-12 are each independently verified.

## Second-round review correction

A second review round, run against head `300593a` (tasks 09-12 landed and verified),
confirmed tasks 09 and 10 are correct as implemented, but found task 11's own fix for
finding 3 is still incomplete in two specific ways, and found task 12's own Test D does
not actually prove the claim it is meant to prove.

1. **The pending-handover resume trigger only fires from a batch settlement's own Stage
   2 — not from a singleton's own settlement.** `resumePendingHandoverForSpec` is called
   from exactly one place: `batch-completion-settlement.mjs`'s `activeExecutionClear`
   stage, only when a BATCH's own settlement clears the active-execution slot. If the
   *first* dispatch unit admitted for a spec is a singleton (dispatched via
   `reconcileContinuation`, Stage 4's `!unit.isGroup` branch — never through
   `executeBatchCompletionSettlement` at all), there is no equivalent trigger when that
   singleton's own turn settles in `admission.mjs`'s own `reconcileHook1`. A durable
   pending multi-member group left behind it (e.g. t1 dispatched as a singleton, {t2,t3}
   left pending; t1 settles) is never woken — stuck forever, not merely delayed. Task 13
   fixes this with a trigger tied to the freeing of the active-execution slot generally,
   not only to batch settlement.
2. **Only `ACTIVE_EXECUTION_EXISTS` is treated as transient; every other transient
   admission failure is recorded as terminal.** In Stage 4's grouped branch,
   `DEFERRED_TO_PENDING_WORKSPACE_REQUEST`, `WORKSPACE_WRITER_CONTENDED`,
   `WORKSPACE_WRITER_BLOCKED_BY_RECOVERY`, `REUSE_SESSION_NOT_RESOLVED`, and a thrown
   admission exception are all exactly as transient as `ACTIVE_EXECUTION_EXISTS`, but are
   currently recorded as a terminal `noop`/`failed` outcome, permanently losing the
   continuation. The singleton branch has no transient/terminal classification at all —
   `reconcileContinuation`'s result is consumed as a completed unit unconditionally. Task
   13 fixes both halves.
3. **Task 12's Test D proves durability, not automatic resume.** Test D manually calls
   `clearActiveAgentExecution(specId)` and then manually re-invokes the parent
   `executeBatchCompletionSettlement()` directly — this proves the pending record
   survives and can be resumed when re-invoked, not that settling the first execution
   automatically triggers the resume with nobody manually freeing the slot or manually
   re-entering the saga. Task 11's own dedicated test proves real automatic resume, but
   only for the batch-first ordering, so it cannot catch finding 1 above (singleton-first
   ordering). Task 14 re-proves automatic resume for both orderings at the same real,
   end-to-end level Test A-C already operate at.

Tasks 13-14 (added below) resolve these in production behavior. The change is not ready
for approval until tasks 09-14 are each independently verified and all five original
review findings plus these three second-round findings are genuinely resolved in
production behavior, not merely hidden by test fixtures.

## Third-round review correction

A third review round, run against head `97b50d0` (tasks 13-14 landed and verified),
confirmed the singleton-first deadlock and the transient/terminal misclassification are
genuinely fixed, and that Test D/D2 now prove real automatic resume without any manual
`clearActiveAgentExecution` call. It found three further issues.

1. **MAJOR — the resume trigger is not scope-guarded to singletons in two of its three
   call sites.** Task 13 explicitly required `capturedScope.kind === 'task'` and said
   "do not duplicate the trigger for task-batch." The `'completed'` branch is safe only
   because `task-batch` already returns early before reaching it; the `'resumable'`
   branch and the final `else` (`'recovery-required'`) branch have no such guard at all
   — they run for both scopes. A child batch failing closed to `recovery-required`
   could, in a race where its own recovery-required claim marking does not hold, wake a
   sibling group while its own batch is still unresolved — contrary to fail-closed
   semantics. Task 15 fixes this.
2. **MAJOR verification gap — task 13 is `verified` but several of its own declared
   `automated:` acceptance criteria are not actually exercised.** Covered: singleton-
   first automatic resume; a grouped admission attempt that *throws*. Not covered: a
   grouped or singleton admission attempt blocked by a genuine (non-exception)
   transient reason value; a reason outside the transient set remaining terminally
   failed via the admission path itself. Task 15 closes this gap.
3. **Task 14's Test D/D2 do not literally satisfy their own written requirement** to
   settle the first dispatch unit via real `executeBatchStart`/`executeBatchFinish` —
   they advance `workflow_progress` and save a batch-finish record directly instead,
   the same fidelity task 11/13's own tests already use. The automatic-resume proof
   itself is real and unaffected; only task 14's own requirement wording overstates what
   was exercised. Task 15 reconciles the wording (real `BatchStart`/`BatchFinish` is
   already proven by Test A and tasks 09/10/12) rather than re-engineering D/D2 to
   duplicate that proof.

Task 15 (added below) resolves these. The change is not ready for approval until task
15 is independently verified and all findings across all three review rounds are
genuinely resolved in production behavior, not merely hidden by test fixtures.

## Verification strategy

Each task's own `## Verification`. Change-wide, after every task is implemented:

```bash
node --test tools/tests/*.test.mjs
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run test:ui-stable
npm --prefix tools/dashboard run test:ui-provider-selector
node tools/specs.mjs validate
```

## ADR impact

None required to supersede — confirmed in `discovery.md` that no existing ADR
documents the sequential-queue or batch-reservation architecture. Consider a new ADR
recording the generalized batch model once implemented (not required to start).

## Out of scope

- Review-batch intra-batch dependency ordering (assumed unnecessary; open question,
  not blocking).
- Wiring up the dependency-consumption remediation/invalidation *consumer* side
  (`findConsumersOfEpoch`/`createRemediationRecord`) — confirmed to have no production
  call sites today; this change keeps its recorded data correct, does not complete it.
- Provider-quota UX, session-visibility-race, and execution-policy-provider-selector
  fixes — already handled in `deterministic-flow-hardening-pt3` on this same branch.
