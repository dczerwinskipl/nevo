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
  decisions: [D33, D40, D41, D42, D44, D45, D47, D49, D50, D51, D52, D53, D54]
---

# Task: Orchestration end-to-end dogfood tests

## Goal

Prove the exact flow that failed during real dogfooding now works end to end: race-safe
agent admission with rollback on failure; a git-finalize lease with a correct boundary,
lease-passing (no self-deadlock), and stale-owner recovery; human interaction available
without mutation and finalized as one self-owned operation; dependency-consumption recorded
durably at step activation, triggered declaratively per attempt (not "first-ever"), with
step-scoped identity and authoritative-record remediation matching; declarative release/
invalidation; and a pending human decision that never pauses other agent-owned work nor
leaks dirty state into another task's commit.

## Implementation constraints

- Test-only task — no production code changes. Compose the real modules from tasks 24–32
  against a realistic fixture change/definition.
- Include one fixture with a newly-authored, non-`implementation`/`review`-named agent step
  declaring `consumesDependencies: true` to prove no step-id dispatch survived anywhere in
  the new orchestration or consumption-recording code.
- Do not implement behavior beyond whatever tasks 24–32 actually shipped.

## Acceptance criteria

1. `finishStep` acquires the git-finalize lease **before** its `update-task` mutation runs —
   proven by holding the lease externally and asserting the mutation stage itself waits, not
   only the commit stage.
   `automated: node --test tools/tests/orchestration-e2e.test.mjs`
2. `activateAndSubmitHumanStep`'s combined submit does **not** recursively acquire the
   git-finalize lease — proven by asserting exactly one acquire/release pair for the whole
   call, and proven not to deadlock or time out against itself.
   `automated: node --test tools/dashboard/tests/orchestration-e2e.test.mjs`
3. Publish and a concurrently-running agent `finishStep` for a different task cannot commit
   each other's `change.yaml` mutation — proven by racing the two directly and inspecting
   each resulting commit's actual diff.
   `automated: node --test tools/tests/orchestration-e2e.test.mjs`
4. A process holding the git-finalize lease that dies without releasing it (simulated kill,
   no `finally` run) is recoverable by a new acquirer without any manual file deletion —
   proven via the PID-liveness reclaim path.
   `automated: node --test tools/tests/orchestration-e2e.test.mjs`
5. A crash simulated after a step's activation succeeds but before its consumption-record
   write completes is reconciled on the next `workflow step start` for that task/step.
   `automated: node --test tools/tests/orchestration-e2e.test.mjs`
6. The reconciled retry in scenario 5 completes using the **original, frozen** dependency
   snapshot, not a newly-resolved one — proven by changing upstream release/invalidation
   state between the crash and the retry and asserting the retry still uses the old snapshot.
   `automated: node --test tools/tests/orchestration-e2e.test.mjs`
7. A task records dependency consumption again on a later, declared-step work attempt
   (rework) — attempt 1 consumes epoch #1 of a dependency; after that dependency is
   invalidated and fixed (a fresh epoch #2), the reworked attempt 2 consumes epoch #2.
   `automated: node --test tools/tests/orchestration-e2e.test.mjs`
8. Invalidating epoch #2 (the authoritative record from scenario 7) discovers this consumer
   via `findConsumersOfEpoch`; invalidating the earlier, superseded epoch #1 does not.
   `automated: node --test tools/tests/orchestration-e2e.test.mjs`
9. Consumption record identity distinguishes different step/attempt pairs for the same task —
   proven by a fixture with two distinct declared-consuming steps (or two attempts of one)
   whose records persist independently with no path collision.
   `automated: node --test tools/tests/orchestration-e2e.test.mjs`
10. Remediation lookup respects a newer consumption snapshot superseding an older one — the
    scenario-7/8 fixture's task is never flagged as a remediation-group member when only the
    superseded epoch #1 is invalidated, only when epoch #2 is.
    `automated: node --test tools/tests/orchestration-e2e.test.mjs`
11. The fixture step with an arbitrary, custom name and `consumesDependencies: true` records
    consumption and participates in remediation identically to `implementation`, with zero
    step-name branching anywhere in the exercised call path.
    `automated: node --test tools/tests/orchestration-e2e.test.mjs`
12. A session created for a task whose `workflow step start` never actually runs (or fails
    before activation) produces no consumption record and no start-operation left `running`
    forever (it is either absent or itself reconcilable).
    `automated: node --test tools/tests/orchestration-e2e.test.mjs`
13. Two simultaneous `admitAgentExecution` requests for one spec result in at most one created
    execution.
    `automated: node --test tools/tests/orchestration-e2e.test.mjs`
14. A simulated session/execution-creation failure occurring after an admission claim is
    marked releases that claim — a subsequent admission request for the same spec succeeds.
    `automated: node --test tools/tests/orchestration-e2e.test.mjs`
15. The first explicit Start for a change with no resolved execution policy always opens the
    provider + mode picker.
    `automated: node --test tools/dashboard/tests/orchestration-e2e.test.mjs`
16. Reaching `human-verification` via reconciliation exposes the interaction preview with
    `change.yaml` byte-for-byte unchanged — no unowned dirty mutation from merely showing the
    interaction.
    `automated: node --test tools/tests/orchestration-e2e.test.mjs`
17. While T1 waits on its human interaction, T2 (a different, independently-eligible task in
    the same spec) runs its own agent-owned work and commits — T2's commit contains only T2's
    own changes, never any trace of T1's state.
    `automated: node --test tools/tests/orchestration-e2e.test.mjs`
- Release remains satisfied after a later, non-invalidating transition; a declared
  `invalidatesDependencyRelease: true` transition revokes a previously-valid release.
  `automated: node --test tools/tests/orchestration-e2e.test.mjs`
- `TaskProjection`/`projectTask()` remains provably pure even while a `suspensions` entry —
  read from a separate `SuspensionProjection` — blocks that task's `ExecutionReadiness`.
  `automated: node --test tools/tests/orchestration-e2e.test.mjs`
- **Standing invariant, re-asserted end to end:** for one spec/change, there is never more
  than one active agent execution created by deterministic orchestration at any inspected
  point, including while one or more human decisions are pending on other tasks.
  `automated: node --test tools/tests/orchestration-e2e.test.mjs`

## Verification

```bash
node --test tools/dashboard/tests/orchestration-e2e.test.mjs
node --test tools/tests/orchestration-e2e.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Any production code fix — this task only adds end-to-end regression coverage for tasks
24–32's own already-implemented behavior.
