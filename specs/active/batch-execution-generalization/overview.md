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

Eight tasks, ordered by dependency (see each task's own `depends_on`):

1. `tasks/01-queue-removal-and-reservation-storage-migration.md` — independent.
2. `tasks/02-batch-admission-generalization.md` — independent.
3. `tasks/03-batch-finish-phase-neutral-generalization.md` — depends on 2.
4. `tasks/04-intra-batch-dependency-consumption-materialization.md` — depends on 2, 3.
5. `tasks/05-batch-completion-handover-partitioning.md` — depends on 3, 4.
6. `tasks/06-ui-canonical-dependency-projection.md` — independent.
7. `tasks/07-acceptance-initial-implementation-batch.md` — depends on 2, 3, 4, 5.
8. `tasks/08-single-task-convergence-verification.md` — depends on 1, 2, 3.

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
