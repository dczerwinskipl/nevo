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
1. **Pure prevalidation** — every task's submitted result is checked against its own current
   step's declared transition values and `finishContract`; the complete task set is checked
   against the exact reserved `ExecutionScope`; read-only Git-provenance postconditions are
   checked against `batch-start-and-context-bootstrap`'s **post-bootstrap workspace-delta
   fingerprint** (D29/D39): current `HEAD == baseRevision` (recorded after activation), then
   recompute the complete repository-visible delta relative to that revision, excluding
   `.nevo-ai-local/**` and only the canonical report path. It must equal the frozen baseline
   exactly. This deliberately includes staged/unstaged tracked changes/deletions **and untracked
   files**, so unchanged bootstrap dirt such as `change.yaml` is accepted while any reviewer
   source/doc edit or newly-created untracked source artifact is rejected. **Any single invalid result, scope mismatch, or provenance
   violation rejects the whole call. Precisely stated (D21, sharpened by D34): before this stage
   succeeds, this operation performs zero control-plane/workflow-state durable mutation of its
   own — no batch-finish record, no `change.yaml` mutation from finish, no Git commit/push, no
   per-task finish operation starts. The report file the reviewer already wrote to disk before
   calling finish is not itself a durable write this operation performs, and is left untouched by
   a rejected call — never treated as though it never existed.**
2. **Persist as `validated`** — only once prevalidation fully succeeds, the durable batch-finish
   record (`.nevo-ai-local/batch-finishes/<changeSlug>/<batchExecutionId>.json`) is written for the
   first time, with state `validated` (not `pending` — there is no durably-written pre-validation
   state), containing the target `taskIds`, per-task verdicts/feedback, `crossTaskFindings`, and
   report reference. This is the first durable write of the whole operation.
3. **Report commit (D22, exact contract by D30)** — the batch-finish operation, not any
   individual member task, commits the canonical shared report
   (`reviews/review-batch-<batchExecutionId>.md`) with an **explicit `include` list containing
   only that exact path** — never a default "stage everything" behavior that could absorb
   `change.yaml`'s bootstrap dirt or another task's files. If `CommitAndPushAction` (or
   equivalent) is reused, invoke it with that explicit include and a context that tolerates the
   expected post-bootstrap workspace state (D29/D39) without staging any of it. The commit's own
   completion (recorded SHA) is a distinct, durable stage inside this record, ordered before the
   per-task apply stage below.
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
   reservation or the workspace-writer claim (that is `batch-completion-orchestration`'s job,
   D16/D35).
6. **Crash recovery follows frozen per-stage state, never a from-scratch re-check (D30).** A
   crash before stage 2 wrote anything is a clean retry from the original request (stage 0/1
   re-run in full). A crash after stage 2 resumes from the record's own frozen stage markers:
   if the report commit is already recorded complete, its SHA is reused and it is never
   re-committed — critically, resume in this case **never re-runs the original `HEAD ==
   baseRevision` prevalidation as though the operation had never started**, since `HEAD` has
   legitimately advanced by the report commit itself; if a per-task finish is already recorded
   complete, it is skipped. Only the genuinely incomplete stages re-run.

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
- Owns the one report commit, staged with an explicit report-path-only `include` — never a
  default include-all that could absorb `change.yaml`'s bootstrap dirt or another task's files
  (D30).
- Never re-runs the pre-report `HEAD == baseRevision` check on resume once the report commit is
  recorded complete (D30) — resume reasons from frozen per-stage state, not a fresh full
  re-validation.
- Checks Git provenance against the complete **post-bootstrap workspace-delta fingerprint**
  (D29/D39), never a pre-activation or "only files bootstrap touched" assumption.

## Interfaces and boundaries

Exposes: `workflow batch finish <change> --batch <batchExecutionId> --input <json>` (naming
mirrors `workflow step finish`). Consumes: `execution-scope-model`'s `ExecutionScope` (a
batch-finish call naming a task outside the session's own scope is rejected) and trusted-identity
primitives (D23), `batch-queue-reservation`'s reservation/`batchExecutionId` (queried, never
released here — released by `batch-completion-orchestration`, D16/D35),
`batch-start-and-context-bootstrap`'s `baseRevision` and complete post-bootstrap
workspace-delta fingerprint (D29/D39), the existing single-task `finishStep`/`finishContract` machinery. Consumed by:
`multi-task-review-skill` (the one call a reviewer session makes to submit its complete
result); `batch-completion-orchestration` (observes this area's durable `completed` state — the
only cross-area read, never a call into `tools/dashboard/**` from here).

## Area-specific acceptance criteria

- Given three tasks with valid results, on a fixture where batch start has already dirtied
  `change.yaml` (the realistic post-bootstrap case), the batch-finish record reaches `completed`
  and all three tasks show their own independent transition/history entry/feedback, and the
  report is committed exactly once, owned by this operation, staging only the report path.
- Given three tasks where one result is invalid (e.g. a `value` not in that task's own current
  transition set), no batch-finish record is created, no `change.yaml` mutation from finish
  occurs, and no per-task finish operation starts — while a report file the reviewer already
  wrote before the call remains present and untouched — and the call reports the specific invalid
  task.
- A prevalidation failure on provenance — `HEAD != baseRevision`, any tracked/index delta
  diverging from the frozen fingerprint, or any new/unexpected untracked repository-visible file
  other than the canonical report — is rejected the same way before any other durable effect.
- Simulating a crash **immediately after the report commit lands** (before any per-task finish),
  then resuming: resume does not reject on the grounds that `HEAD` advanced past `baseRevision`
  — it recognizes the report commit as its own recorded, completed stage — and the report is not
  committed a second time.
- Simulating a crash after the report commit **and** task A's finish, then resuming, completes
  exactly B and C, without re-touching A or re-committing the report.
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
report *content* (`batch-start-and-context-bootstrap` builds `BatchContext`; `batch-report`
renders it) — this area only commits the already-written report file and stores the reference
into each task's history. Continuation-barrier release, workspace-writer claim release, and
dispatch, and releasing the queue reservation (`batch-completion-orchestration`, D16/D35) — this
area's own responsibility ends at durable `completed`.
