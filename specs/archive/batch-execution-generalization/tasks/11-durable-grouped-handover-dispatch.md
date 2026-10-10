---
id: durable-grouped-handover-dispatch
status: draft
change: batch-execution-generalization
context:
  required:
    - specs/active/batch-execution-generalization/overview.md
    - tools/dashboard/server/ai/orchestration/batch-completion-settlement.mjs
    - tools/specs/workflow/queue/reservation.mjs
    - tools/dashboard/server/ai/orchestration/admission.mjs
    - tools/dashboard/server/ai/orchestration/reconciliation.mjs
semantic_references:
  decisions: []
allowed_paths:
  - tools/dashboard/server/ai/orchestration/batch-completion-settlement.mjs
  - tools/tests/batch-completion-orchestration.test.mjs
  - tools/tests/batch-hook3-restart-recovery.test.mjs
forbidden_paths:
  - src/**
  - tools/dashboard/ui/**
  - tools/specs/workflow/**
  - tools/dashboard/server/ai/sessions/turns/routes.mjs
depends_on: [batch-admission-generalization, batch-completion-handover-partitioning, production-batch-admission-generalization]
---

# Task: Make grouped-handover dispatch durable, validated, and session-policy-correct

## Goal

Corrective task from the post-implementation review (`overview.md` § "Post-implementation
review correction", finding 3) — three connected gaps in `batch-completion-settlement.mjs`'s
Stage 4, all introduced or left unaddressed by task 05's own grouping logic:

1. **Only one group can ever actually be admitted.** When handover partitions members
   into 2+ distinct execution-contract groups, every group is processed in the same
   pass. The first group's `admitAgentExecution` call sets `admission.mjs`'s in-process
   `activeExecutions` guard for the spec (the existing, correct one-active-execution-
   per-spec invariant, D33). The second group's own `admitAgentExecution` call then
   immediately gets `{admitted: false, reason: 'ACTIVE_EXECUTION_EXISTS'}` — and is
   *still* recorded as `{status: 'completed', action: 'noop'}` in the settlement,
   permanently losing that group; there is no later point at which it is reconsidered.
2. **No compatibility/readiness validation before creating a grouped reservation.**
   Every other call site that creates a group reservation
   (`routes.mjs`/task 10, the manual `batch-start` CLI path) runs
   `validateBatchCompatibility` first; this one does not — `createGroupReservation` is
   called directly from the resolved destination tuple, so a group whose member has, for
   example, an external unsatisfied dependency can still get a reservation and an
   admission attempt.
3. **`sessionPolicy` is grouped on, then discarded.** The grouping key includes
   `destination.sessionPolicy` (task 05's own stated contract: continuation policy,
   target step/executor, role, session policy, resolved execution policy), but the
   admission candidate hardcodes `sessionPolicy: 'fresh'` regardless of what
   `destination.sessionPolicy` actually was for that group.

## Requirements

### Durable sequential admission (gap 1)

- Do not attempt to admit every pending group in the same pass. Persist the full set of
  determined, not-yet-admitted groups as durable pending state in the settlement record
  (or an equally durable, crash-survivable location already used by this saga — do not
  invent a new storage file; extend the existing settlement record's own shape).
- Admit at most one group per settlement pass, respecting the existing one-active-
  execution-per-spec invariant. The remaining groups stay recorded as durable, pending,
  *not* `'completed'`.
- Provide the mechanism by which a pending group becomes eligible once the active one
  settles — e.g. Hook 3 boot reconciliation, or the next `executeBatchCompletionSettlement`
  invocation for that spec, picking up the next pending group. Do not require a human to
  manually re-trigger it, and do not silently drop it.
- A group that genuinely cannot be admitted for a terminal reason (e.g. the destination
  has no agent executor at all, task 05's existing human-only case) is still correctly
  recorded as a completed no-dispatch — only a group blocked purely by
  `ACTIVE_EXECUTION_EXISTS` (or an equivalent transient admission contention) must remain
  pending, never `'completed'`.
- This is explicitly *not* a reintroduction of the removed generic queue
  (`tools/specs/workflow/queue/{store,evaluator}.mjs`, task 01) and must not become one:
  the persisted pending-group state represents only the already-determined handover
  groups from *this one* settlement's own grouping pass — it does not select, re-rank,
  or discover new work across unrelated batches/specs, and it is not a second scheduler
  under a different name.

### Compatibility validation before reservation (gap 2)

- Before calling `createGroupReservation` for a grouped-handover group, run the same
  canonical `validateBatchCompatibility` every other reservation-creation call site
  runs, passing that group's own member task ids.
- A group that fails this check must not get a reservation or an admission attempt —
  record it as a genuinely failed/blocked dispatch (not silently `'completed'`/`'noop'`
  as if nothing needed to happen), consistent with how a failed admission is already
  distinguished from a terminal no-dispatch elsewhere in this task.
- The existing same-batch-dependency exception (task 02) must keep working for a
  handover group exactly as it does for a manually started batch — a member depending
  on another member of the *same* handover group must not block; an external unsatisfied
  dependency must still block.

### Session-policy correctness (gap 3)

- Use `destination.sessionPolicy` on the admission candidate — do not hardcode
  `'fresh'`.
- If this change's own v1 scope only supports `'fresh'` for multi-member batch
  admission (confirmed in `discovery.md`/task 02), then a destination resolving to
  `'reuse'` must be handled *explicitly* — e.g. routed through the single-task
  continuation path (which already supports `session: reuse` via `parentSessionId`)
  rather than silently coerced into a fresh multi-member batch. Do not invent new
  multi-member-reuse semantics if none are specified elsewhere in this change; make the
  existing constraint explicit instead of silently violating it.
- If grouping ever needs to distinguish `'reuse'` destinations that resolve to
  *different* predecessor sessions (so they must not be merged into one group), include
  that predecessor-session identity in the grouping key, not only the literal string
  `'reuse'`.

## Implementation constraints

- Do not modify `tools/specs/workflow/queue/reservation.mjs` (`validateBatchCompatibility`
  itself) or anything else under `tools/specs/workflow/**` — call the existing function,
  do not change what it validates.
- Do not modify `routes.mjs` (task 10's own scope).
- Preserve crash/retry idempotency throughout: a crash between admitting one group and
  recording the next pending group's state must resume correctly, neither losing nor
  double-admitting any group — the existing `_crashAfterMemberDispatchTaskId` test-hook
  pattern in this file should be extended to cover the new pending-group transitions, not
  replaced.

## Acceptance criteria

- Two members sharing one continuation contract and a third member with a divergent
  contract: the review-batch pass produces two groups; the first eligible group is
  admitted; the second is recorded as durable pending, not `'completed'`/`'noop'`.
  `automated: node --test tools/tests/batch-completion-orchestration.test.mjs`
- After the first group's own batch settles (a subsequent, real settlement event for
  that group), the second, previously-pending group becomes eligible and is admitted —
  without any manual intervention and without re-processing the first group.
  `automated: node --test tools/tests/batch-completion-orchestration.test.mjs`
- A grouped-handover group whose member has an external unsatisfied dependency is
  rejected before any reservation is created for it — no reservation record, no
  admission attempt.
  `automated: node --test tools/tests/batch-completion-orchestration.test.mjs`
- A grouped-handover group whose members depend only on each other (same-batch
  dependency) is still accepted.
  `automated: node --test tools/tests/batch-completion-orchestration.test.mjs`
- A destination resolving to `sessionPolicy: 'reuse'` is dispatched via the reuse-
  capable path with the correct `parentSessionId` — never silently admitted as
  `'fresh'`.
  `automated: node --test tools/tests/batch-completion-orchestration.test.mjs`
- A crash between admitting the first group and persisting the second group's pending
  state resumes correctly on retry — no duplicate admission, no lost group.
  `automated: node --test tools/tests/batch-completion-orchestration.test.mjs`
- Existing hook3 restart-recovery scenarios (`batch-hook3-restart-recovery.test.mjs`)
  still pass unchanged.
  `automated: node --test tools/tests/batch-hook3-restart-recovery.test.mjs`

## Verification

```bash
node --test tools/tests/batch-completion-orchestration.test.mjs
node --test tools/tests/batch-hook3-restart-recovery.test.mjs
node tools/specs.mjs validate
```

## Out of scope

`BatchFinish` gate correctness (task 09), the manual production start route (task 10) —
this task is scoped to post-finish handover dispatch only. Any new general-purpose
scheduler, cross-batch task selection, or revival of the removed queue.
