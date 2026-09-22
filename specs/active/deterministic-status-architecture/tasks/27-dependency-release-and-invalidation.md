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
  - tools/specs/workflow/git-finalize-lock.mjs
  - tools/specs/workflow/cli.mjs
  - tools/specs/workflow/finish-operation.mjs
  - tools/tests/deterministic-dependency-satisfaction.test.mjs
  - tools/tests/deterministic-task-projection.test.mjs
  - tools/tests/git-finalize-lock.test.mjs
forbidden_paths:
  - tools/specs/workflow/task-projection.mjs
  - tools/specs/workflow/step-context.mjs
  - tools/dashboard/**
depends_on: [ workflow-continuation-schema ]
semantic_references:
  decisions: [D28, D31, D36, D37, D40, D44, D47, D48]
---

# Task: Dependency release and invalidation

## Goal

Implement D40's release-epoch model: `evaluateDependencySatisfaction` scans a task's **full**
history for the latest `releasesDependencies: true` transition and treats it as still
effective unless a **later** `invalidatesDependencyRelease: true` transition fired. Implement
D48's dependency-consumption record: written at successful **first-step activation** inside
workflow core (`handleWorkflowStepStart`, `cli.mjs`) — never at AI-session admission — with a
multi-dependency array shape covering every release-based dependency an attempt relies on.
Implement D31's evidence-based remediation-group derivation. Implement D44's separate
`SuspensionProjection` — `task-projection.mjs` (forbidden path) is untouched. Implement D47's
`git-finalize-lock.mjs` — a cross-process advisory lock — and insert its acquisition into
`finish-operation.mjs`'s own commit-producing stage.

## Implementation constraints

- **`dependency-satisfaction.mjs` — epoch-aware release (D40).** Alongside the existing
  terminal-transition-with-`outcome: success` check (unchanged), add: scan
  `workflow_progress.history` for the latest entry whose matched transition declares
  `releasesDependencies: true` (its `{step, attempt}` is the release epoch); a dependent is
  satisfied via this path if and only if no **later** history entry's matched transition
  declares `invalidatesDependencyRelease: true`. Return the resolved epoch alongside
  `satisfied: true`.
- **`tools/specs/workflow/dependency-consumption.mjs` (new).** Exports
  `recordDependencyConsumption({repoRoot, change, consumingTaskId, consumingStep,
  consumingAttempt, dependencies: [{taskId, releaseEpoch}]})` (one atomic
  temp-file-then-rename write per attempt, covering **every** release-based dependency that
  attempt relies on, to `.nevo-ai-local/dependency-consumption/<change>/<consumingTaskId>/
  attempt-<n>.json`) and `findConsumersOfEpoch({repoRoot, change, dependencyTaskId,
  releaseEpoch})` (scans all consumption records under the change, matching if **any** entry
  in a record's `dependencies[]` names the exact epoch).
- **Recording point: `cli.mjs`'s `handleWorkflowStepStart`, at first-step activation (D48,
  corrected — not admission).** Immediately after `ensureStepActivated` succeeds for a task's
  **first-ever** step (`phase: 'new'`, no prior `workflow_progress`), compute
  `checkTaskDependencies` (existing function) for the task's `depends_on` list, collect every
  dependency currently satisfied via a release epoch (not a terminal `outcome: success`), and
  — if any exist — call `recordDependencyConsumption` once with all of them. Do not record
  anything for a dependency satisfied via terminal success (out of scope, D48). Do not record
  anything on any subsequent step activation within the same task (dependencies are checked
  once, at first activation, never re-checked).
- **Remediation-group derivation, evidence-based (D31/D48).** When a release epoch is
  invalidated, derive the group as: the releasing task, plus every task id returned by
  `findConsumersOfEpoch` for that exact epoch — **regardless of that consumer's current
  state**. Create the durable record via `remediation-record.mjs` — never inferred from
  current task state or timestamps.
- **`suspensions`, not `blockedBy` (D37).** Unchanged from the prior pass.
- **`tools/specs/workflow/suspension-projection.mjs` (new, D44).** Unchanged from the prior
  pass — `projectTask()`'s signature and purity are unaffected.
- **`readiness-policy.mjs` — one additive check (D44).** Unchanged from the prior pass.
- **`tools/specs/workflow/git-finalize-lock.mjs` (new, D47).** Exports
  `withGitFinalizeLock(fn)`: acquire a cross-process advisory file lock at
  `.nevo-ai-local/locks/git-finalize.lock` (exclusive file creation; on `EEXIST`, retry with a
  short backoff up to a bounded timeout, then fail with a clear error naming the lock file —
  never hang indefinitely), run `fn`, then delete the lock file in a `finally` — safe even if
  `fn` throws. Insert one call site into `finish-operation.mjs`'s own commit-producing stage
  (wrap the existing commit call with `withGitFinalizeLock`, a small additive change — do not
  restructure `finishStep`'s own stage sequence). `human-step/operations.mjs`'s new combined
  operation (task 29) and `publish/operation.mjs` (task 31) import and acquire the same lock
  around their own commit-producing stages — this task only creates the primitive and wires
  its own `finish-operation.mjs` call site.

## Acceptance criteria

- A dependency released at `implementation → review` remains released after the further
  `review → human-verification` transition (no invalidation fired) — proven directly.
  `automated: node --test tools/tests/deterministic-dependency-satisfaction.test.mjs`
- A dependency released, then invalidated by `review`'s `fail → implementation` transition,
  no longer satisfies dependents via the release path.
  `automated: node --test tools/tests/deterministic-dependency-satisfaction.test.mjs`
- A task's `workflow step start` for its first step, where a dependency is satisfied only via
  a release epoch, produces exactly one consumption record naming that epoch. A subsequent
  `workflow step start` for that same task's *next* step produces no additional record.
  `automated: node --test tools/tests/deterministic-dependency-satisfaction.test.mjs`
- A task depending on **two** upstream tasks, both currently satisfied via release epochs,
  records both in the same `dependencies[]` array in one atomic write at its own first-step
  activation; invalidating **either** epoch is found by `findConsumersOfEpoch`.
  `automated: node --test tools/tests/deterministic-dependency-satisfaction.test.mjs`
- A task whose session is created but whose `workflow step start` never actually runs (or
  fails) produces **no** consumption record — proven by simulating exactly this ordering and
  asserting the record's absence.
  `automated: node --test tools/tests/deterministic-dependency-satisfaction.test.mjs`
- A fixture with one root task (release epoch, later invalidated) and three dependents whose
  consumption records name that exact epoch — one `active`, one `waiting`, one `terminal` —
  derives a remediation group of exactly those three plus the root.
  `automated: node --test tools/tests/deterministic-dependency-satisfaction.test.mjs`
- `task-projection.mjs`'s own existing test suite passes completely unchanged.
  `automated: node --test tools/tests/deterministic-task-projection.test.mjs`
- `readiness-policy.mjs`'s existing readiness tests for a non-suspended task pass unchanged; a
  new test proves a suspended task's readiness is refused with a reason naming the suspension.
  `automated: node --test tools/tests/execution-readiness-policy.test.mjs`
- `withGitFinalizeLock` serializes two concurrent callers: the second's `fn` only begins after
  the first's completes (or throws) and the lock file is removed.
  `automated: node --test tools/tests/git-finalize-lock.test.mjs`
- A stale lock file left after a hard crash (no process holds it) does not permanently
  deadlock future callers — the acquisition timeout/backoff eventually surfaces a clear,
  actionable error rather than hanging forever (exact timeout value is an implementation
  detail; the failure mode — clear error, not an infinite hang — is not).
  `automated: node --test tools/tests/git-finalize-lock.test.mjs`
- `finish-operation.mjs`'s own existing test suite passes unchanged except for the new
  lock-acquisition wrap around its commit stage, proven by a test that holds the lock
  externally and asserts `finishStep`'s commit stage waits for it.
  `automated: node --test tools/tests/workflow-finish-operation.test.mjs`

## Verification

```bash
node --test tools/tests/deterministic-dependency-satisfaction.test.mjs
node --test tools/tests/deterministic-task-projection.test.mjs
node --test tools/tests/execution-readiness-policy.test.mjs
node --test tools/tests/git-finalize-lock.test.mjs
node --test tools/tests/workflow-finish-operation.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Running the remediation group's fix attempts (`deterministic-sequential-queue`, task 28).
The combined cross-task-aware review and `suspensions`-clearing
(`dependency-invalidation-remediation-review`, task 30). The `releasesDependencies`/
`invalidatesDependencyRelease` schema fields themselves (`workflow-continuation-schema`,
task 25). The new combined human-decision operation itself and Publish's own lock-acquisition
call site (owned by tasks 29 and 31 respectively — this task only provides the primitive and
wires its own `finish-operation.mjs` call site). Reopening a terminal task's workflow.
