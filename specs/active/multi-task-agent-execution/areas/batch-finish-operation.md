# Area: Batch-finish operation

## Responsibility

Provide a durable resumable batch-finish saga and continuation barrier — "workflow batch finish" (D3) —
that validates every task's result before mutations begin, persists intent durably, applies each task's
own transition and commit idempotently, and enforces a continuation barrier preventing any downstream
continuations from firing until all member tasks are durably completed.

In git-backed repositories, member task finish operations commit and push individually. Because git
commits and remote pushes cannot be rolled back atomically across crashes without dangerous force-pushes,
this operation is designed not as an impossible distributed transaction, but as a durable, idempotent saga
with a strict continuation barrier.

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
  batch-finish record follows the same convention.
- Server-side continuation (`tools/dashboard/server/ai/orchestration/reconciliation.mjs`,
  `reconcileContinuation`, lines 392–485) currently dispatches one task's continuation at a time,
  immediately after that task's own transition.

## Requirements

The batch-finish operation executes as a **durable resumable saga and continuation barrier**:

1. **Intent & Pre-condition Validation Stage**:
   - Every task's submitted result is validated against its current step's declared transition values
     and `finishContract`. Any single invalid result rejects the whole batch-finish call before any
     writes (D10).
   - Control-plane read-only verification: verifies working tree contains no uncommitted source changes
     and no git commits modifying paths outside the canonical review report (`reviews/review-batch-<id>.md`).
   - A durable batch-finish record (`.nevo-ai-local/batch-finishes/<changeSlug>/<batchExecutionId>.json`)
     is written with status `pending`, containing the target `taskIds`, per-task verdicts/feedback,
     `crossTaskFindings`, and report reference.
2. **Apply Stage (Sequential & Idempotent)**:
   - For each task in the record, applies that task's single-task finish transition (updating `change.yaml`,
     committing and pushing per-task artifacts, and recording the batch report anchor in `workflow_progress.history`).
   - Marks each task `applied` in the durable record as it succeeds. Already-`applied` tasks are skipped on resume.
3. **Continuation Barrier Stage**:
   - Only once **all** member tasks in the batch reach `applied` is the record marked `completed`.
   - The continuation barrier guarantees that **no downstream continuations or queue advancements are dispatched**
     until the batch-finish record reaches `completed`.
   - Once `completed`, continuations are recomputed and dispatched for all affected tasks together, and the
     queue reservation is released.
4. **Crash Recovery**:
   - If interrupted or crashed mid-saga, recovery inspects the durable record and resumes unfinished tasks
     from their recorded status, completing remaining tasks before releasing the continuation barrier.

## Constraints

- No task's `workflow_progress`/`change.yaml` mutation may occur before the batch-finish record
  reaches `validated`.
- No continuation dispatch may occur before every task in the record reaches `applied`.
- Reuses `finish-operation.mjs`'s existing per-task mutation stages — this area does not
  reimplement `verify-gates`/`commit`/`push`/`transition` per task, only adds the outer
  validate-then-persist-then-apply-then-barrier envelope around calls to it.

## Interfaces and boundaries

Exposes: `workflow batch finish <change> --batch <id> --input <json>` (naming mirrors `workflow
step finish`). Consumes: `execution-scope-model`'s `ExecutionScope` (the batch session's scope
names the exact `taskIds` this operation must cover — a batch-finish call naming a task outside
the session's own scope is rejected), `batch-queue-reservation`'s reservation (released on
`completed`), the existing single-task `finishStep`/`finishContract` machinery. Consumed by:
`multi-task-review-skill` (the one call a reviewer session makes to submit its complete result).

## Area-specific acceptance criteria

- Given three tasks with valid results, the batch-finish record reaches `completed` and all three
  tasks show their own independent transition/history entry/feedback.
- Given three tasks where one result is invalid (e.g. a `value` not in that task's own current
  transition set), no task's `change.yaml` entry changes at all, and the call reports the specific
  invalid task.
- Simulating a crash between `applied` for task A and task B (durable record shows A `applied`, B
  `pending`) and resuming completes exactly B, without re-touching A or re-dispatching A's
  continuation twice.
- No continuation for any task in the batch fires before every task in the batch shows `applied`.

## Dependencies

`areas/execution-scope-model.md` (the scope a batch-finish call is authorized against),
`areas/batch-queue-reservation.md` (the reservation this operation releases on completion).

## Out of scope

Building the reviewer's own judgment/skill (`multi-task-review-skill`) — this area only defines
the durable operation a reviewer's finished judgment is submitted through. The shared context
delivery and report file itself (`batch-context-and-report`) — this area only writes the
reference into each task's history, not the report content.
