---
id: deterministic-status-architecture.orchestration-e2e-dogfood-tests
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/owner-decisions.md
allowed_paths:
  - tools/dashboard/tests/orchestration-e2e.test.mjs
  - tools/tests/orchestration-e2e.test.mjs
forbidden_paths:
  - tools/specs/workflow/**
  - tools/dashboard/server/**
  - tools/dashboard/ui/**
  - src/**
depends_on: [ dashboard-orchestration-wiring, user-mutation-source-control-finalization, dependency-invalidation-remediation-review ]
semantic_references:
  decisions: [D33, D40, D41, D42, D44, D45, D47, D49, D50, D51, D52, D53, D55, D56, D57, D58]
---

# Task: Orchestration end-to-end dogfood tests

## Goal

Prove the exact flow that failed during real dogfooding now works end to end: race-safe
agent admission with rollback on failure; a git-finalize lease with a correct boundary,
lease-passing (no self-deadlock), and stale-owner recovery; a workspace-writer slot that
arbitrates the *whole* period an agent actively holds the shared worktree, distinct from and
outer to the git-finalize lease, with `kind`-appropriate crash recovery and a deterministic
dispatch priority for pending user mutations; human interaction available without mutation
and finalized as one self-owned operation; dependency-consumption recorded durably at step
activation with a crash-safe, monotonic `consumptionSequence` giving a real total order
across arbitrary consuming steps; and declarative release/invalidation.

## Implementation constraints

- Test-only task — no production code changes. Compose the real modules from tasks 24–32
  against a realistic fixture change/definition.
- Include one fixture with a newly-authored, non-`implementation`/`review`-named agent step
  declaring `consumesDependencies: true` to prove no step-id dispatch survived anywhere in
  the new orchestration or consumption-recording code.
- Do not implement behavior beyond whatever tasks 24–32 actually shipped.

## Acceptance criteria

**Git-finalize lease (D50/D51):**
1. `finishStep` acquires the git-finalize lease **before** its `update-task` mutation runs.
2. `activateAndSubmitHumanStep`'s combined submit does **not** recursively acquire the
   git-finalize lease.
3. A process holding the git-finalize lease that dies without releasing it is recoverable by
   a new acquirer via the PID-liveness reclaim path, with no manual file deletion.

**Workspace-writer arbitration (D55/D56/D57):**
4. An active agent execution owns the shared workspace-writer slot from successful admission
   until that execution's own turn reaches terminal.
5. A human-submit (`activateAndSubmitHumanStep`) attempted while an agent execution actively
   holds the workspace-writer slot waits and does not mutate any tracked file until the slot
   is free.
6. Publish attempted while an agent execution actively holds the workspace-writer slot waits
   and does not mutate any tracked file until the slot is free.
7. Neither a waiting human-submit nor a waiting Publish ever fails with a scope error caused
   by the active agent's own dirty source files, and neither can commit the active agent's
   dirty `change.yaml`/source-file state once it does proceed.
8. After an agent execution finishes with both a pending human decision and a next-queue
   agent item available, the pending human decision's own operation runs **before** the next
   automatic agent item is admitted (the chosen default priority policy, D57).
9. Workspace-writer ownership survives a simulated server restart: an agent-kind claim tied
   to an orphaned turn is released via the same reconciliation pass that already handles that
   turn; a non-agent-kind claim whose pid doesn't match the restarted process is cleared at
   boot.
10. A stale (confirmed-dead-pid) non-agent workspace-writer owner is safely reclaimed by a new
    acquirer; a live owner (agent or otherwise) is never stolen.
11. A failed agent admission/session creation releases **both** the admission claim and the
    workspace-writer claim — a subsequent admission request for the same spec succeeds.

**Dependency-consumption provenance and total ordering (D52/D53/D58):**
12. A crash simulated after a step's activation succeeds but before its consumption-record
    write completes is reconciled on the next `workflow step start` for that task/step, using
    the **original, frozen** dependency snapshot **and** the original, frozen
    `consumptionSequence` — neither re-resolved nor re-allocated, even if upstream release/
    invalidation state changed in between.
13. A task records dependency consumption again on a later, declared-step work attempt
    (rework) — attempt 1 consumes epoch #1 of a dependency; after that dependency is
    invalidated and fixed (a fresh epoch #2), the reworked attempt consumes epoch #2 at a
    higher `consumptionSequence`.
14. Two distinct declared-consuming steps whose attempt numbers do **not** reflect chronology
    (step A's attempt 2 happened after step B's attempt 1) are ordered correctly by
    `consumptionSequence`, not attempt number, not step name, not `workflow_progress.history`
    position.
15. Invalidating the higher-`consumptionSequence` (authoritative) epoch from scenario 13
    discovers this consumer via `findConsumersOfEpoch`; invalidating the earlier, superseded
    epoch does not.
16. Consumption record identity distinguishes different step/attempt pairs for the same task
    — no path collision across two distinct declared-consuming steps.
17. The fixture step with an arbitrary, custom name and `consumesDependencies: true` records
    consumption, allocates its `consumptionSequence`, and participates in remediation
    identically to `implementation`, with zero step-name branching anywhere in the exercised
    call path.
18. A session created for a task whose `workflow step start` never actually runs (or fails
    before activation) produces no consumption record and no start-operation left `running`
    forever.

**Agent admission (D41/D49):**
19. Two simultaneous `admitAgentExecution` requests for one spec result in at most one
    created execution.

**Execution policy and human dispatch (D21/D47):**
20. The first explicit Start for a change with no resolved execution policy always opens the
    provider + mode picker.
21. Reaching `human-verification` via reconciliation exposes the interaction preview with
    `change.yaml` byte-for-byte unchanged — no unowned dirty mutation from merely showing the
    interaction.

**Standing invariants, re-asserted end to end:**
22. Release remains satisfied after a later, non-invalidating transition; a declared
    `invalidatesDependencyRelease: true` transition revokes a previously-valid release.
23. `TaskProjection`/`projectTask()` remains provably pure even while a `suspensions` entry —
    read from a separate `SuspensionProjection` — blocks that task's `ExecutionReadiness`.
24. For one spec/change, there is never more than one active agent execution created by
    deterministic orchestration at any inspected point, including while one or more human
    decisions are pending on other tasks.

All scenarios: `automated: node --test tools/tests/orchestration-e2e.test.mjs` (or
`tools/dashboard/tests/orchestration-e2e.test.mjs` for scenarios that must exercise the
dashboard-side dispatch/admission code — 2, 8, 20, 21 specifically).

## Verification

```bash
node --test tools/dashboard/tests/orchestration-e2e.test.mjs
node --test tools/tests/orchestration-e2e.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Any production code fix — this task only adds end-to-end regression coverage for tasks
24–32's own already-implemented behavior.
