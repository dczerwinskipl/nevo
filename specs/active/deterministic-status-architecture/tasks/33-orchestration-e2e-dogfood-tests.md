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
  decisions: [D33, D40, D41, D42, D43, D44, D45, D47, D48, D49]
---

# Task: Orchestration end-to-end dogfood tests

## Goal

Prove the exact flow that failed during real dogfooding now works end to end: sequential,
race-safe agent admission with rollback on failure; human interaction available without
mutation and finalized as one self-owned operation; dependency consumption recorded only at
real step activation with a multi-dependency shape; declarative release/invalidation; and a
pending human decision that never pauses other agent-owned work nor leaks dirty state into
another task's commit.

## Implementation constraints

- Test-only task — no production code changes. Compose the real modules from tasks 24–32
  against a realistic fixture change/definition.
- Include one fixture with a newly-authored, non-`implementation`/`review`-named agent step
  to prove no step-id dispatch survived anywhere in the new orchestration code.
- Do not implement behavior beyond whatever tasks 24–32 actually shipped.

## Acceptance criteria

1. Reaching `human-verification` via reconciliation exposes the interaction preview with
   `change.yaml` byte-for-byte unchanged — no unowned dirty mutation from merely showing the
   interaction.
   `automated: node --test tools/tests/orchestration-e2e.test.mjs`
2. While T1 waits on its human interaction (no mutation from that wait), T2 (a different,
   independently-eligible task in the same spec) runs its own agent-owned work and commits —
   T2's commit contains only T2's own changes, never any trace of T1's state.
   `automated: node --test tools/tests/orchestration-e2e.test.mjs`
3. Clicking Approve (or Request changes) performs `activateAndSubmitHumanStep` as one
   operation — the resulting workflow mutation and its commit are both attributable to that
   one user action, never split across two separately-owned steps.
   `automated: node --test tools/dashboard/tests/orchestration-e2e.test.mjs`
4. A dependency-consumption record is written only after `workflow step start` actually
   succeeds for a task's first step — never merely because a session was created for it.
   `automated: node --test tools/tests/orchestration-e2e.test.mjs`
5. A session created for a task whose `workflow step start` is never actually run (or fails)
   produces no consumption record.
   `automated: node --test tools/tests/orchestration-e2e.test.mjs`
6. One task's first-step activation, depending on two upstream tasks both currently satisfied
   via release epochs, records both epochs in one atomic consumption record.
   `automated: node --test tools/tests/orchestration-e2e.test.mjs`
7. Invalidating **either** of those two release epochs finds this same consumer via
   `findConsumersOfEpoch`.
   `automated: node --test tools/tests/orchestration-e2e.test.mjs`
8. Two simultaneous `admitAgentExecution` requests for one spec result in at most one created
   execution — the second is rejected/deferred, never a second session.
   `automated: node --test tools/tests/orchestration-e2e.test.mjs`
9. A simulated session/execution-creation failure occurring after an admission claim is
   marked releases that claim — a subsequent admission request for the same spec succeeds
   (retry works; no stale "occupied" state survives a failure).
   `automated: node --test tools/tests/orchestration-e2e.test.mjs`
10. The first explicit Start for a change with no resolved execution policy always opens the
    provider + mode picker — proven for a provider that would not have needed an explicit
    mode under the retracted conditional logic.
    `automated: node --test tools/dashboard/tests/orchestration-e2e.test.mjs`
- Release remains satisfied after a later, non-invalidating transition; a declared
  `invalidatesDependencyRelease: true` transition revokes a previously-valid release.
  `automated: node --test tools/tests/orchestration-e2e.test.mjs`
- A remediation group's membership is derived from persisted dependency-consumption records
  naming the invalidated epoch — including an already-`verified` consumer — never from
  current task state or timestamps; fixed one at a time through the sequential queue, reviewed
  by the combined cross-task pass, with `suspensions` cleared only once the whole non-terminal
  group passes.
  `automated: node --test tools/tests/orchestration-e2e.test.mjs`
- `TaskProjection`/`projectTask()` remains provably pure even while a `suspensions` entry —
  read from a separate `SuspensionProjection` — blocks that task's `ExecutionReadiness`.
  `automated: node --test tools/tests/orchestration-e2e.test.mjs`
- The fixture using a newly-authored, non-`implementation`/`review` step name completes
  through the same orchestration code with zero step-id-specific branches, and its declared
  `schedulingPriority` is honored.
  `automated: node --test tools/dashboard/tests/orchestration-e2e.test.mjs`
- **Standing invariant, re-asserted end to end:** for one spec/change, there is never more
  than one active agent execution created by deterministic orchestration at any inspected
  point, including while one or more human decisions are pending on other tasks.
  `automated: node --test tools/tests/orchestration-e2e.test.mjs`
- Publish's own commit is observable as a separate, correctly-attributed commit from the
  agent's own implementation commit, even when a concurrent agent turn is in flight for
  another task (proving the shared git-finalize lock, not merely non-overlapping timing).
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
