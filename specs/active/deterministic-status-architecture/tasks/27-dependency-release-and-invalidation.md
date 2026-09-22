---
id: deterministic-status-architecture.dependency-release-and-invalidation
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/dependency-release-and-invalidation.md
    - specs/active/deterministic-status-architecture/owner-decisions.md
allowed_paths:
  - tools/specs/workflow/dependency-satisfaction.mjs
  - tools/specs/workflow/remediation-record.mjs
  - tools/specs/workflow/dependency-consumption.mjs
  - tools/specs/workflow/suspension-projection.mjs
  - tools/specs/workflow/readiness-policy.mjs
  - tools/tests/deterministic-dependency-satisfaction.test.mjs
  - tools/tests/deterministic-task-projection.test.mjs
forbidden_paths:
  - tools/specs/workflow/task-projection.mjs
  - tools/specs/workflow/step-context.mjs
  - tools/specs/workflow/finish-operation.mjs
  - tools/dashboard/**
depends_on: [ workflow-continuation-schema ]
semantic_references:
  decisions: [D28, D31, D36, D37, D40, D43, D44]
---

# Task: Dependency release and invalidation

## Goal

Implement D40's release-epoch model: `evaluateDependencySatisfaction` scans a task's **full**
history for the latest `releasesDependencies: true` transition and treats it as still
effective unless a **later** `invalidatesDependencyRelease: true` transition fired — never
"last entry has the flag," never any wording based on the workflow moving "backward" or to
an "earlier step." Implement D43's durable dependency-consumption record (read/write
primitives — the orchestration layer, task 29, calls the write at admission). Implement D31's
evidence-based remediation-group derivation (read consumption records naming an invalidated
epoch, including already-terminal consumers). Implement D44: a new, separate
`SuspensionProjection` — `TaskProjection`/`task-projection.mjs` (forbidden path) is **not**
touched, stays exactly as pure as it is today.

## Implementation constraints

- **`dependency-satisfaction.mjs` — epoch-aware release (D40).** Alongside the existing
  terminal-transition-with-`outcome: success` check (unchanged), add: scan
  `workflow_progress.history` for the latest entry whose matched transition declares
  `releasesDependencies: true` (its `{step, attempt}` is the release epoch); a dependent is
  satisfied via this path if and only if no **later** history entry's matched transition
  declares `invalidatesDependencyRelease: true`. Return the resolved epoch alongside
  `satisfied: true` so callers (task 29, at admission) can record which epoch a consumer
  relied on.
- **`tools/specs/workflow/dependency-consumption.mjs` (new).** Exports
  `recordDependencyConsumption({repoRoot, change, consumingTaskId, consumingAttempt,
  dependencyTaskId, releaseEpoch})` (atomic temp-file-then-rename write to
  `.nevo-ai-local/dependency-consumption/<change>/<consumingTaskId>/attempt-<n>.json`) and
  `findConsumersOfEpoch({repoRoot, change, dependencyTaskId, releaseEpoch})` (scans all
  consumption records under the change for the exact epoch match). This task defines and
  tests these primitives; task 29 calls `recordDependencyConsumption` at the actual admission
  moment.
- **Remediation-group derivation, evidence-based (D31/D43).** When a release epoch is
  invalidated, derive the group as: the releasing task, plus every task id returned by
  `findConsumersOfEpoch` for that exact epoch — **regardless of that consumer's current
  state** (`active`, `waiting`, `completed`, `terminal`). Create the durable record via
  `remediation-record.mjs` (`{remediationId, rootTaskId, causeAttempt, members,
  discoveredMembers, state}`) with this evidence-based member set — never inferred from
  current task state or timestamps.
- **`suspensions`, not `blockedBy` (D37).** A non-terminal group member gets a `suspensions`
  entry (`{taskId, reason: 'dependency-invalidated', groupId}`); a terminal member gets the
  same entry, advisory only (no next step to enforce against) — never reopened, never
  reverted.
- **`tools/specs/workflow/suspension-projection.mjs` (new, D44).** Exports
  `projectSuspensions(task, change)` — reads the remediation-group/consumption records for
  that task and returns `{taskId, suspensions}`. This is a **new, separate** module — do not
  add a `suspensions` parameter, field, or file read to `task-projection.mjs` (forbidden
  path); `projectTask()`'s signature and purity are unchanged by this task.
- **`readiness-policy.mjs` — one additive check (D44).** `ExecutionReadiness` (already
  implemented/verified, task 13) composes `TaskProjection` with `SuspensionProjection`
  (this task's new module) and gains one new check: a task with a non-empty `suspensions`
  list fails readiness with a clear reason naming the suspension. This is the only edit to
  this already-verified file — an explicit, additive behavior change, not a silent one.

## Acceptance criteria

- A dependency released at `implementation → review` remains released after the further
  `review → human-verification` transition (no invalidation fired) — proven directly.
  `automated: node --test tools/tests/deterministic-dependency-satisfaction.test.mjs`
- A dependency released, then invalidated by `review`'s `fail → implementation` transition,
  no longer satisfies dependents via the release path.
  `automated: node --test tools/tests/deterministic-dependency-satisfaction.test.mjs`
- `recordDependencyConsumption`/`findConsumersOfEpoch` round-trip through the real filesystem
  and survive a simulated process restart.
  `automated: node --test tools/tests/deterministic-dependency-satisfaction.test.mjs`
- A fixture with one root task (release epoch, later invalidated) and three dependents whose
  consumption records name that exact epoch — one `active`, one `waiting`, one `terminal` —
  derives a remediation group of exactly those three plus the root, read from the consumption
  records, not from task state/timestamps.
  `automated: node --test tools/tests/deterministic-dependency-satisfaction.test.mjs`
- A dependent whose consumption record names a **different**, still-valid epoch of the same
  dependency is excluded from the group.
  `automated: node --test tools/tests/deterministic-dependency-satisfaction.test.mjs`
- `task-projection.mjs`'s own existing test suite passes completely unchanged — this task's
  diff touches none of its files.
  `automated: node --test tools/tests/deterministic-task-projection.test.mjs`
- `readiness-policy.mjs`'s existing readiness tests for a non-suspended task pass unchanged; a
  new test proves a suspended task's readiness is refused with a reason naming the suspension.
  `automated: node --test tools/tests/execution-readiness-policy.test.mjs`

## Verification

```bash
node --test tools/tests/deterministic-dependency-satisfaction.test.mjs
node --test tools/tests/deterministic-task-projection.test.mjs
node --test tools/tests/execution-readiness-policy.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Running the remediation group's fix attempts (`deterministic-sequential-queue`, task 28).
The combined cross-task-aware review and `suspensions`-clearing
(`dependency-invalidation-remediation-review`, task 30). The `releasesDependencies`/
`invalidatesDependencyRelease` schema fields themselves (`workflow-continuation-schema`,
task 25). Writing consumption records (owned by task 29, at admission time — this task only
defines the primitive). Reopening a terminal task's workflow.
