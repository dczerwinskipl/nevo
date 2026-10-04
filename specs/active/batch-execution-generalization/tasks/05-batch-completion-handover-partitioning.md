---
id: batch-completion-handover-partitioning
status: draft
change: batch-execution-generalization
context:
  required:
    - specs/active/batch-execution-generalization/overview.md
    - specs/active/batch-execution-generalization/discovery.md
    - tools/dashboard/server/ai/orchestration/batch-completion-settlement.mjs
    - tools/dashboard/server/ai/orchestration/reconciliation.mjs
    - tools/dashboard/server/ai/sessions/execution-policy-service.mjs
    - tools/specs/workflow/queue/reservation.mjs
  optional:
    - tools/specs/workflow/batch-start/operation.mjs
semantic_references:
  decisions: []
allowed_paths:
  - tools/dashboard/server/ai/orchestration/batch-completion-settlement.mjs
  - tools/tests/batch-completion-orchestration.test.mjs
forbidden_paths:
  - src/**
  - tools/dashboard/ui/**
  - tools/specs/workflow/**
depends_on: [batch-finish-phase-neutral-generalization, intra-batch-dependency-consumption-materialization]
---

# Task: Partition batch-completion handover by full execution contract

## Goal

Fix `discovery.md` Gap 6's handover correction: `batch-completion-settlement.mjs`'s
Stage 4 today dispatches one independent fresh-refiner session per failed member
(`for (taskId of taskIds) { reconcileContinuation(...) }`) — N sessions, not one.
Replace with: group members by their actual resulting destination's full execution
contract — continuation policy, target step/executor, incoming role, session policy,
and resolved execution policy (provider/model/mode/`taskOverrides`) — and admit at
most one new agent session per distinct group. Human-only destinations (no agent
executor, or `continuation: owner-action`) never produce a session. This reuses data
already proven to exist and persist correctly
(`batch-finish-operation.test.mjs:218-247`'s mixed pass/fail case) — this is a
dispatch-logic change, not new workflow state.

## Requirements

- Replace Stage 4's per-member loop with: for each member, read its own
  just-persisted `workflow_progress` to determine its actual resulting step/executor/
  role/session-policy (same data `reconcileWorkflowPosition`'s single-task path
  already reads) and its resolved execution policy for that destination (reusing
  `executionPolicyService`, including any `taskOverrides`).
- Group members whose full tuple matches exactly. For each group:
  - If the destination has no agent executor (human-owned step, or
    `continuation !== 'auto'` with no automatic dispatch), do not admit anything —
    this group simply produces its human interaction(s), already handled by the
    per-task transition itself.
  - If the destination has exactly one member, admit it via the existing single-task
    continuation path (`reconcileWorkflowPosition`/direct admission from task 01's
    rework) — no batch machinery needed for a group of one.
  - If the destination has two or more members sharing the identical tuple, admit
    one new batch (reservation + `executeBatchStart`) for that group — a genuine new
    batch execution, with `parentSessionId` set to the just-completed batch's
    reviewer/implementer session id (preserving the existing lineage convention).
- Every member's own transition remains authoritative and untouched by this task —
  only the *dispatch* that happens after transitions are already persisted changes.

## Implementation constraints

- Do not alter `workflow_progress`/transition semantics, `executionPolicyService`'s
  resolution logic, or anything under `tools/specs/workflow/**` — this task only
  reads already-resolved data and changes how many/which sessions get admitted from
  it.
- A single failed member still gets exactly one refiner session (same outcome as
  today for the common case) — this task must not regress the simple case while
  fixing the N-sessions-for-a-group case.

## Acceptance criteria

- A review batch where all 3 members fail with the identical resulting contract
  (same role, same resolved provider/model, no `taskOverrides` differences) produces
  exactly **one** new refiner batch covering all 3 — not three independent sessions.
  `automated: node --test tools/tests/batch-completion-orchestration.test.mjs`
- A review batch where 2 members fail with identical contracts and 1 fails with a
  `taskOverrides`-diverged contract produces **two** groups: one 2-member refiner
  batch, one single-task refiner admission — not one 3-member batch, not three
  single sessions.
  `automated: node --test tools/tests/batch-completion-orchestration.test.mjs`
- A review batch where some members pass (→ human-verification) and others fail (→
  refiner) produces zero sessions for the passing group and the correctly-grouped
  session(s) for the failing group.
  `automated: node --test tools/tests/batch-completion-orchestration.test.mjs`
- A single failed member (batch of size 1 needing refinement) still gets exactly one
  session, via the single-task path, not a fabricated one-member batch.
  `automated: node --test tools/tests/batch-completion-orchestration.test.mjs`

## Verification

```bash
node --test tools/tests/batch-completion-orchestration.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Any change to transition/readiness logic itself — this task only changes post-
transition dispatch grouping.
