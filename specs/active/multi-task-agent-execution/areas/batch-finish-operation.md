# Area: Batch-finish operation

## Responsibility

Provide the durable, resumable batch-finish saga — "workflow batch finish" (D3, corrected by D21) —
that prevalidates every task's result and Git provenance entirely in memory before any durable write,
persists the batch result durably, applies each task's own transition via its existing per-task finish
identity, and durably reaches `completed` once every referenced per-task finish is complete. This area is
**provider-neutral workflow-core only** — it never imports `tools/dashboard/**` and never dispatches
continuations itself (D16); continuation-barrier release and dispatch belong to the separate
`batch-completion-orchestration` area, which observes this area's durable `completed` state.

In git-backed repositories, member task finish operations commit and push individually. Because git
commits and remote pushes cannot be rolled back atomically across crashes without dangerous force-pushes,
this operation is designed not as an impossible distributed transaction, but as a durable, idempotent saga.

## Current state

- Single-task finish (`tools/specs/workflow/finish-operation.mjs`): `FINISH_STAGE_IDS`
  (`verify-gates, update-task, commit, push, transition`) — already a durable, resumable,
  per-task operation-record family; this area reuses its per-task mutation step unchanged, it
  does not reimplement it.
- The generic finish contract already validates a submitted result against the task's own
  current step's declared `transitions[].value` set (`standard-v1.yaml`'s `review` step:
  `value: pass -> human-verification`, `value: fail -> implementation`) — the same mechanism this
  area's batch payload reuses per task; no hardcoded `pass`/`fail` enum is introduced.
- Durable intent-then-derive convention already established elsewhere: `batch.json` (legacy
  batch intent, `tools/specs/lifecycle/batch.mjs`), `follow-ups.yaml` — both persist intent only,
  deriving progress from current `change.yaml` state at read time. This area's durable
  batch-finish record follows the same convention, corrected to derive per-task status from the
  referenced finish-operation records themselves (D21), not duplicate it.
- Server-side continuation (`tools/dashboard/server/ai/orchestration/reconciliation.mjs`,
  `reconcileContinuation`, lines 392–485) currently dispatches one task's continuation at a time,
  immediately after that task's own transition. **This module is explicitly out of this area's own
  path scope (D16)** — it belongs to `batch-completion-orchestration`.
- Single-task Start's own trusted-ambient-identity discipline (the sibling
  `deterministic-status-architecture` corrective pass) is the precedent D23's authorization check
  reuses — a client-supplied identity is never trusted over server-derived state.

## Requirements

The batch-finish operation follows the corrected D21 model — **prevalidate, then persist, then apply,
then derive**:

0. **Trusted authorization (D23)** — before anything else, verify the calling session's trusted
   ambient execution identity (canonical session id), the live workspace-writer claim, the
   persisted `AgentSession.executionScope`, the request's `batchExecutionId`, and the queue
   reservation all agree. Any mismatch (wrong session, `executionScope` mismatch,
   `batchExecutionId` mismatch, reservation mismatch, workspace-claim owner/session mismatch) is
   rejected outright — a bare `--batch <id>` CLI/API argument is never trusted as proof of scope
   on its own. No separate manual/operator recovery path exists in this pass; a batch that cannot
   authorize this way fails closed to recovery-required.
1. **Pure prevalidation (zero durable writes)** — every task's submitted result is checked against
   its own current step's declared transition values and `finishContract`; the complete task set
   is checked against the exact reserved `ExecutionScope`; read-only Git-provenance postconditions
   are checked (D22): current `HEAD == baseRevision` recorded at batch start, and every dirty
   tracked path is exactly and only the permitted review-report path — never a literally-clean-tree
   check, since the report itself is an expected uncommitted write at this point. **Any single
   invalid result, scope mismatch, or provenance violation rejects the whole call — nothing is
   written to disk yet (D10, D21).**
2. **Persist as `validated`** — only once prevalidation fully succeeds, the durable batch-finish
   record (`.nevo-ai-local/batch-finishes/<changeSlug>/<batchExecutionId>.json`) is written for the
   first time, with state `validated` (not `pending` — there is no durably-written pre-validation
   state), containing the target `taskIds`, per-task verdicts/feedback, `crossTaskFindings`, and
   report reference. This is the first durable write of the whole operation.
3. **Report commit (D22)** — the batch-finish operation, not any individual member task, commits
   the canonical shared report (`reviews/review-batch-<batchExecutionId>.md`) — one batch-level
   commit, created before or alongside the per-task commits in stage 4, so the report is never
   accidentally attributed to whichever member happens to finish first.
4. **Apply (sequential, idempotent, identity-referenced)** — for each task in the record, apply
   that task's finish transition using **that task's own existing single-task finish-operation
   identity** (`finish-operation.mjs`'s own durable operation-record family) — the batch record
   references that identity, it does not duplicate the mutation logic. `applied`/`completed`
   per-task status is *derived* from the referenced per-task finish operation's own authoritative
   state wherever feasible, rather than independently tracked in a way that could drift from it.
   Already-complete per-task finishes are skipped on resume.
5. **Reach `completed`** — the batch record reaches `completed` only once every referenced
   per-task finish is durably complete. This area's own responsibility ends here: it durably
   exposes `completed` plus the per-task facts `batch-completion-orchestration` needs — it does
   not itself recompute or dispatch any continuation, and it does not release the queue
   reservation (that is `batch-completion-orchestration`'s job, D16).
6. **Crash recovery** — a crash before stage 2 wrote anything is a clean retry from the original
   request (stage 0/1 re-run in full). A crash after stage 2 resumes by reading the per-task
   finish-operation identities the record already references and continuing only the ones not yet
   complete — the record's own state is never treated as authoritative over those per-task
   operations' own state.

## Constraints

- Zero durable writes occur before stage 2 (`validated`) — prevalidation (stage 1) is pure/in-memory.
- No `tools/dashboard/**` import anywhere in this area (C2) — continuation dispatch is not this
  area's responsibility (D16); it durably exposes `completed` and stops.
- Reuses `finish-operation.mjs`'s existing per-task mutation stages and their own durable
  operation-record identity — this area does not reimplement `verify-gates`/`commit`/`push`/
  `transition` per task, and does not duplicate their completion status independently (D21).
- Never trusts a bare `batchExecutionId`/`--batch` argument as authorization — always re-verifies
  against trusted ambient session identity, workspace claim, `executionScope`, and reservation
  (D23).
- Owns the one report commit; never lets an individual member task's own commit implicitly absorb
  the report (D22).

## Interfaces and boundaries

Exposes: `workflow batch finish <change> --batch <batchExecutionId> --input <json>` (naming
mirrors `workflow step finish`). Consumes: `execution-scope-model`'s `ExecutionScope` (a
batch-finish call naming a task outside the session's own scope is rejected) and trusted-identity
primitives (D23), `batch-queue-reservation`'s reservation/`batchExecutionId` (released on
`completed`, by `batch-completion-orchestration`, not here), `batch-start-and-context-bootstrap`'s
`baseRevision` (D22), the existing single-task `finishStep`/`finishContract` machinery. Consumed
by: `multi-task-review-skill` (the one call a reviewer session makes to submit its complete
result); `batch-completion-orchestration` (observes this area's durable `completed` state — the
only cross-area read, never a call into `tools/dashboard/**` from here).

## Area-specific acceptance criteria

- Given three tasks with valid results, the batch-finish record reaches `completed` and all three
  tasks show their own independent transition/history entry/feedback, and the report is committed
  exactly once, owned by this operation, not any member task.
- Given three tasks where one result is invalid (e.g. a `value` not in that task's own current
  transition set), **zero durable writes occur at all** — not just "no task's `change.yaml`
  entry changes" — and the call reports the specific invalid task.
- A prevalidation failure on Git provenance (dirty tree outside the permitted report path, or
  `HEAD != baseRevision`) is rejected the same way — zero durable writes, before any other check.
- Simulating a crash after stage 2 (`validated`) but before task B's own finish completes, then
  resuming, completes exactly the incomplete per-task finishes (reading their own finish-operation
  identity), without re-touching an already-complete task or double-committing the report.
- A batch-finish call whose trusted ambient identity/`executionScope`/`batchExecutionId`/
  reservation/workspace claim don't all agree is rejected outright — proven for each individual
  mismatch case (D23).
- No continuation for any task in the batch fires from *this area's own code* under any
  circumstance — continuation dispatch is entirely `batch-completion-orchestration`'s
  responsibility, proven by this area containing no call into `tools/dashboard/**`.

## Dependencies

`areas/execution-scope-model.md` (the scope and trusted-identity primitives a batch-finish call is
authorized against), `areas/batch-queue-reservation.md` (the reservation/`batchExecutionId` this
operation reads), `areas/batch-start-and-context-bootstrap.md` (`baseRevision` this operation
checks).

## Out of scope

Building the reviewer's own judgment/skill (`multi-task-review-skill`) — this area only defines
the durable operation a reviewer's finished judgment is submitted through. The `BatchContext`/
report *content* (`batch-start-and-context-bootstrap`, `batch-context-and-report`) — this area
only commits the already-written report file and stores the reference into each task's history.
Continuation-barrier release and dispatch, and releasing the queue reservation
(`batch-completion-orchestration`, D16) — this area's own responsibility ends at durable
`completed`.
