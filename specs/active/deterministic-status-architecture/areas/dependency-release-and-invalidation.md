# Area: Dependency release and invalidation

## Responsibility

Make the dependency-satisfaction release point declarative (D28) as a **release epoch that
remains valid until an explicit, declarative invalidation transition fires** (D40 — not "the
last history entry has the flag," which breaks the moment any further, non-invalidating
transition happens). A release means a downstream task may **enter the sequential queue's
runnable set** (D33) — never that it starts concurrently with the releasing task's own
continued execution. When a release is explicitly invalidated, this area derives the
automatic remediation group using durable dependency-consumption provenance (D43) — never
guessed from `workflow_progress` state or timestamps — **including consumers that have
already reached a terminal transition** (D31, corrected). Group membership persists durably
(D36) since cross-task review can extend it. This area also owns `SuspensionProjection`
(D44), kept strictly separate from the pure `TaskProjection` (D10, unchanged). The cross-
task-aware review of a remediation group's fix is a separate area
(`areas/dependency-invalidation-remediation-review.md`), which consumes this area's signals.

## Current state (grounded, 2026-09-22)

`evaluateDependencySatisfaction` (`dependency-satisfaction.mjs`) reads only
`history.at(-1)` — confirmed by reading the function directly — so a release recorded by an
earlier transition appears to lapse the moment any later, non-invalidating transition occurs
(e.g. `review → human-verification` after `implementation → review` released dependents).
`projectTask()` (`task-projection.mjs`) takes only in-memory `(task, change, options)` and
does no file I/O — confirmed pure, must stay that way. No dependency-consumption provenance,
no release-epoch concept, and no `stale`/`suspend` concept of any kind exists yet in this
file or `task-projection.mjs`. `blockedBy` is a plain `string[]` of task ids, read directly
by three UI call sites (`status-board.tsx`, `task-dialog.tsx`) — must not be overloaded.

## Requirements

- **Release epoch, not a last-entry flag (D40).** `evaluateDependencySatisfaction`'s release
  path scans the **full** `workflow_progress.history` for the latest entry whose matched
  transition declares `releasesDependencies: true` (its `{step, attempt}` is the release
  epoch), then checks whether any **later** entry's matched transition declares
  `invalidatesDependencyRelease: true`. No later invalidation → still released, regardless of
  how many intervening non-invalidating transitions occurred. A later invalidation → not
  released via this path (a subsequent new `releasesDependencies` transition starts a fresh
  epoch). No wording or logic anywhere references a transition going "backward" or to an
  "earlier step" — only which declared transitions fired, and in what order.
- **Durable dependency-consumption provenance, recorded at successful step activation, not
  admission (D48, corrected).** A new module, `tools/specs/workflow/dependency-consumption.mjs`,
  persists `.nevo-ai-local/dependency-consumption/<change>/<consumingTaskId>/attempt-<n>.json`
  with a **multi-dependency** shape covering every release-based dependency an attempt relies
  on, written atomically as one file:
  ```
  { consumingTaskId, consumingStep, consumingAttempt,
    dependencies: [ { taskId, releaseEpoch: { step, attempt } } ] }
  ```
  Recorded by this area's own call-site insertion into `handleWorkflowStepStart`
  (`tools/specs/workflow/cli.mjs`), immediately after a successful **first-step**
  (`phase: 'new'`) activation — never at AI-session admission, since an admitted session does
  not guarantee `workflow step start` will ever actually run or succeed. This keeps the write
  entirely within `tools/specs/workflow/**`.
- **Shared git-finalize lock (D47).** This area owns `tools/specs/workflow/git-finalize-lock.mjs`
  (`withGitFinalizeLock(fn)`), a cross-process advisory file lock
  (`.nevo-ai-local/locks/git-finalize.lock`, exclusive-create + retry-with-backoff +
  delete-on-release — same atomic-file family as the rest of `.nevo-ai-local/**`) — needed
  because an agent's `workflow step finish` runs in its own CLI subprocess, not the dashboard
  server's process, so an in-process mutex (unlike D41's admission lock) cannot serialize
  against it. This area inserts its acquisition into `finish-operation.mjs`'s own
  commit-producing stage (a small, additive wrap around the existing call, not a redesign);
  `human-step/operations.mjs`'s new combined operation (task 29) and `publish/operation.mjs`
  (task 31) import and acquire the same lock around their own commit-producing stages.
- **Remediation-group derivation is evidence-based (D31 corrected, D48).** When a release
  epoch is invalidated, the remediation group is: the releasing task, plus every task whose
  durable consumption record has **any** `dependencies[]` entry naming that exact
  `releaseEpoch` — **regardless of that consumer's current state** (`active`, `waiting`,
  `completed`, or already `terminal`). A terminal consumer is never reopened or reverted —
  flagged via `suspensions` (below) as advisory only.
- **`suspensions`, not `blockedBy` (D37).** Every non-terminal group member is marked via a
  new, separate field, `suspensions: [{taskId, reason: 'dependency-invalidated', groupId}]`
  — additive, never merged into `blockedBy`, which keeps its unchanged `string[]` shape.
- **Durable, extensible remediation record (D36).** `.nevo-ai-local/remediation-groups/
  <change>/<remediationId>.json` (`remediationId, rootTaskId, causeAttempt, members,
  discoveredMembers, state`) — orchestration state, distinct from `workflow_progress`. This
  area owns creating/reading the initial derivation; only
  `areas/dependency-invalidation-remediation-review.md` extends `discoveredMembers`.
- **`SuspensionProjection` is separate from `TaskProjection` (D44).** A new function,
  `projectSuspensions(task, change)` (`tools/specs/workflow/suspension-projection.mjs`), reads
  the remediation-group and dependency-consumption records and returns a task's
  `suspensions`. `projectTask()` itself is **not modified** — no new parameter, no new field,
  no file I/O added to it. `ExecutionReadiness` (`readiness-policy.mjs`, already
  verified/implemented by task 13) composes `TaskProjection` + `SuspensionProjection` and
  gains an explicit new check: a suspended task's readiness is refused.

## Constraints

- No destructive rollback of a downstream task's already-completed work, and no reopening of
  a terminal task's workflow.
- `releasesDependencies`/`invalidatesDependencyRelease` are mutually exclusive on any one
  transition and legal only on internal transitions (D25/D28/D40).
- `blockedBy`'s shape and meaning are never changed by this area.
- `projectTask()`/`task-projection.mjs` gain no new parameters, fields, or file I/O — pure,
  unchanged (D44). Suspension data is composed only at the `ExecutionReadiness` layer or
  above, never inside `TaskProjection`.
- Remediation-group membership is never inferred from current task state or timestamps —
  only from durable consumption records naming the exact invalidated epoch (D43).

## Interfaces and boundaries

Exposes: `evaluateDependencySatisfaction`'s epoch-aware release logic;
`dependency-consumption.mjs`'s write/read primitives; the remediation-group derivation
function and its durable record read/create primitives (`remediation-record.mjs`); the new
`suspensions` field; `projectSuspensions(task, change)`.

Consumed by: `tools/specs/workflow/cli.mjs` (calls the consumption-recording function right
after a successful first-step activation), `automatic-workflow-continuation` (task 29 — reads
release/invalidation state to decide eligibility; imports the git-finalize lock and the new
combined human operation's dependency on it), `publish/operation.mjs` (task 31 — imports the
git-finalize lock), `readiness-policy.mjs` (composes `SuspensionProjection` into
`ExecutionReadiness`), `areas/deterministic-sequential-queue.md` (respects `suspensions` when
computing eligibility), `areas/dependency-invalidation-remediation-review.md` (reads and may
extend the durable remediation record).

## Area-specific acceptance criteria

- A dependency released at `implementation → review` remains released after the further,
  non-invalidating `review → human-verification` transition — proven directly, not merely
  asserted for the single-transition case.
- A dependency released, then invalidated by `review`'s `fail → implementation` transition,
  no longer satisfies dependents via the release path (though it may still satisfy them via a
  fresh release epoch or a terminal `outcome: success`, checked independently).
- A fixture with one root task (release epoch, later invalidated) and three dependents whose
  durable consumption records name that exact epoch — one still `active`, one `waiting`, one
  already `terminal` — derives a remediation group containing exactly those three plus the
  root, proven from the consumption records, not from task state/timestamps.
- A dependent whose consumption record names a **different**, still-valid epoch of the same
  dependency is excluded from the group even though it depends on the same task.
- One consuming attempt whose task depends on **two** upstream tasks, both currently
  satisfied via release epochs, records both in the same `dependencies[]` array in one
  atomic write; invalidating **either** epoch finds this consumer.
- A session admitted for a task, where the agent never actually runs (or fails)
  `workflow step start`, produces **no** consumption record — proven directly, not merely
  absent evidence.
- `withGitFinalizeLock` serializes two concurrent callers (simulated) attempting their own
  mutate-then-commit sequence — the second caller's critical section only begins once the
  first's commit has fully landed.
- `projectTask()`'s existing test suite is unaffected — it gains no new parameters, return
  fields, or file reads.
- `readiness-policy.mjs`'s existing readiness checks are unaffected for a non-suspended task;
  a suspended task's readiness is refused with a clear reason naming the suspension.
- The durable remediation record and consumption records both survive a simulated process
  restart with identical content.

## Dependencies

`tasks/25-workflow-continuation-schema.md` (schema carrier for `releasesDependencies`/
`invalidatesDependencyRelease`).

## Out of scope

Retrying, rolling back, or reopening a task's own completed work. The cross-task-aware
review pass that determines when a remediation group's fix is complete and whether it must
grow (`areas/dependency-invalidation-remediation-review.md`). Running the group's actual fix
implementation attempts (`areas/deterministic-sequential-queue.md`). The new combined
human-decision operation itself (`automatic-workflow-continuation`, task 29 — this area only
provides the lock it acquires).
