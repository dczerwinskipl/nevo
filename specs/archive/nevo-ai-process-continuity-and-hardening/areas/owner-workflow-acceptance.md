# Area: Owner-workflow acceptance scenarios

> New area, added 2026-08-06 (seventh refinement pass) per owner decisions D34/D35. The
> final task in this refinement pass — depends on tasks 14-20, validates D34's
> ten-property bar across complete owner-facing flows, not only the helper functions
> each of tasks 14-20 already unit-tests on its own.

## Responsibility

Own end-to-end regression coverage proving the whole owner-facing workflow — not just
its individual mechanisms — actually satisfies D34's bar once tasks 14-20 are
implemented. Every scenario below exercises a real, owner-shaped flow (a whole
`spec-approve` turn, a whole `implementation-review` run, a whole `spec-review --changed`
call) rather than calling an internal function directly, the same distinction task 10
(`workflow-e2e-tests`) already drew for tasks 01-09.

## Current state

Tasks 14-20 each carry their own unit/integration-level acceptance criteria, proving
their own mechanism works in isolation. Nothing yet proves the *composition* — that a
real "approve and start" turn actually begins implementation with no further prompt
(task 18's mechanism, exercised end-to-end), that a real multi-task
`implementation-review` run actually stays silent between tasks and surfaces exactly one
consolidated decision stage (tasks 12/16's mechanisms, composed), or that a real
one-person batch, start to finish, requires only the request, genuine owner decisions,
and one final confirmation (D34's bar, as a single measurable outcome).

## Requirements

Each requirement below is one required regression scenario, restated from the owner's
own list, mapped to the mechanism(s) it exercises:

1. **Approve and start implementation begins work without another confirmation** — a
   full `spec-approve` "approve and start" turn against a real approved task, asserting
   implementation has begun by the end of the turn (task 18).
2. **Passing review produces only minimal result rows** — a full `task-review` turn
   against a fully-passing task, asserting the response body is exactly the title plus
   three rows (acceptance criteria, scope, findings), and that none of the four
   internal-only gates (verification, forbidden-path, docs, owner decision) renders as
   its own row (task 14, corrected in the final pre-approval review pass — proves the
   actual minimal shape, not only a line-count ceiling a differently-shaped body could
   also satisfy).
3. **Failing review expands only failed checks** — a full `task-review` turn against a
   task with exactly one failed acceptance criterion, asserting only that criterion is
   expanded, every other checklist item stays compact (tasks 13/14, regression).
4. **Multi-task review uses bounded per-task context** — a full `implementation-review
   --tasks <N>` run across 3+ tasks, asserting per-task context does not accumulate
   across tasks (task 12, area requirement 5, regression under task 16's extended
   per-task data).
5. **No owner questions appear between task reviews** — the same run as scenario 4,
   asserting zero prompts occur before the final consolidated stage (tasks 12/16).
6. **Semantic integration detects a real contract mismatch** — a full
   `implementation-review` run over a fixture pair where one task's change actually
   breaks another's declared dependency contract, asserting exactly one integration
   finding is surfaced at the consolidated stage (task 16).
7. **Path overlap alone does not create a defect** — the same kind of run as scenario 6,
   but with two tasks touching the same file with no real semantic conflict, asserting
   zero findings (tasks 12/16, restates area 12 requirement 15/18).
8. **Two tasks modifying one shared file retain independent provenance** — a full,
   sequential two-task run against the same file, asserting each task's own
   `implementation.changed_paths`/fingerprint stays independently correct after the
   second task's edit (task 15).
9. **Scoped spec review evaluates a new task in old context without re-grading old
   tasks** — a full `spec-review --changed` turn against a change with 3+ already-
   reviewed tasks and one new task, asserting the older tasks' `task_fingerprints`/
   verdict/status are byte-for-byte unchanged after the run (task 17).
10. **Dependency-aware status never proposes an unstartable task** — a full `status`
    turn against a fixture where the first `approved` task's dependency isn't yet
    satisfied, asserting the reported next action is genuinely startable (task 18).
11. **Legitimate unowned drift follows the named correction process** — a full
    unowned-drift scenario (a path outside every task's scope, needing a real fix),
    asserting the three-option menu is presented and the chosen path's record persists
    correctly (task 19).
12. **Accepted scope exceptions remain visible and narrow** — a full re-review turn
    against a task carrying an accepted `scope_exceptions` entry, asserting the
    exception is still visible in the compact report and still scoped to exactly its
    one recorded path (task 13, regression, composed with task 14's tighter line
    budget).
13. **Global HEAD advancement does not stale earlier evidence** — a full sequential
    batch/multi-task run where `HEAD` advances after each task, asserting an earlier
    task's own evidence (`self_check`, D33; `implementation` provenance, task 15) is
    never reported stale purely because `HEAD` moved (D33/task 15, regression).
14. **Aggregate reports cannot contradict canonical per-task reports** — a full
    `implementation-review` run where an aggregate verdict would otherwise disagree with
    a selected task's own `reviews/<task-id>.md`, asserting
    `validateAggregateAgainstCanonicalReviews` (already shipped, commit `c000905`)
    rejects it — regression only, this mechanism is not rebuilt by task 21.
15. **A normal one-person batch requires only: the initial request, genuine owner
    decisions, and one final review/status confirmation** — the composite scenario: a
    full run from `spec-approve` "approve and start" through implementation through a
    multi-task `implementation-review` to one bulk status transition, counting the
    total number of owner-facing turns required and asserting it equals exactly: one
    initial request, N genuine owner/scope decisions actually present in the fixture (a
    real, gated decision — never a rubber-stamp confirmation of something already
    authorized), and one final confirmation. This is D34's own bar, as a single
    measurable acceptance criterion.

## Constraints

- Every scenario exercises a real, owner-shaped command turn — never only the internal
  function each of tasks 14-20 already unit-tests. A scenario that only calls an
  internal function directly does not satisfy this area's own requirement, even if it
  happens to exercise the same code path.
- Scenario 14 is regression coverage for an already-shipped mechanism
  (`validateAggregateAgainstCanonicalReviews`) — this area does not rebuild or modify
  it, only proves it still holds once tasks 14-20 are composed on top of it.
- No scenario reopens or rewrites tasks 01-13's own task/area files or already-written
  `reviews/*.md` content.

## Interfaces and boundaries

Exposes: nothing new — this area is pure regression/acceptance coverage over tasks
14-20's own mechanisms, composed.

Consumes: every mechanism built by tasks 14 (minimal reports), 15 (provenance), 16
(semantic integration/consolidated decisions), 17 (scoped review), 18 (compound
actions/dependency-aware status), 19 (unowned-drift), and 20 (fixture-backed handler
testability — this area's own end-to-end scenarios are themselves built using task 20's
fixture-repo helper, so they too never mutate the real repository).

## Area-specific acceptance criteria

Identical to the "Requirements" list above — each of the fifteen scenarios is itself a
testable acceptance criterion, restated as such in the task file's own "Acceptance
criteria" section rather than duplicated here.

## Dependencies

`review-report-minimization` (task 14), `deterministic-implementation-provenance` (task
15), `semantic-cross-task-integration-and-consolidated-decisions` (task 16),
`scoped-and-incremental-spec-review` (task 17),
`compound-actions-and-dependency-aware-status` (task 18), `unowned-drift-correction-flow`
(task 19), `repository-bound-handler-testability` (task 20) — every scenario exercises a
mechanism owned by one or more of these; this area cannot exist before all seven do.

## Out of scope

- Any new production mechanism — this area is tests/regression coverage only, over
  already-specified behavior from tasks 14-20.
- Modifying `validateAggregateAgainstCanonicalReviews` or any other already-shipped
  mechanism from before this refinement pass.
- Reopening or rewriting tasks 01-13's own artifacts.
