# Area: Batch-finish operation

## Responsibility

Provide one atomic/logical boundary — "workflow batch finish" — that validates every task's
result before any of them becomes externally visible, persists the complete batch result
durably, applies each task's own transition idempotently, and only then recomputes/dispatches
continuations for the whole batch together. This is the mechanism that prevents "finish A →
A's continuation fires while the reviewer is still processing B/C."

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

- A new durable **batch-finish record**
  (`.nevo-ai-local/batch-finish/<changeSlug>/<batchExecutionId>.json`), written before any task
  mutation begins, holding: the reserved `taskIds`, the submitted per-task `{result, feedback?}`
  (validated per task against that task's own current step's `finishContract`, exactly as
  `workflow step finish` already validates a single task), the `crossTaskFindings` list, the
  shared report path, and a per-task status (`pending` | `applied`) plus an overall status
  (`validating` | `validated` | `applying` | `completed`).
- **Validate stage**: every task's submitted result is checked against its own current step's
  declared transition values before anything is written. **Any single invalid result rejects the
  whole batch-finish call — no partial acceptance (D10).**
- **Persist stage**: only after every result validates does the record get durably written with
  status `validated` — this is the point the prompt's "collect/validate all task outcomes"
  requirement is satisfied.
- **Apply stage**: for each task in the record, apply that task's own single-task `finishStep`
  transition (reusing `finish-operation.mjs`'s existing per-task mutation stages unchanged),
  attaching a durable reference (`batchExecutionId`, report path, task anchor) to that task's own
  `workflow_progress.history` entry. Idempotent: re-running against an already-`applied` task is
  a no-op, keyed off the record's own per-task status — crash-safe resume continues from
  whichever tasks still show `pending`.
- **Barrier stage**: only once every task in the record shows `applied` does the record move to
  `completed`, and only then — as a distinct, final step, never folded into stage-by-stage
  application — are continuations recomputed/dispatched for every affected task together (reusing
  the existing single-task continuation-dispatch function per task, called only from this final
  barrier).
- Crash recovery: resuming reads the durable record's per-task status and continues from wherever
  it left off; a record that never reached `validated` is simply abandoned (nothing was ever
  externally visible); a record `validated` or later resumes deterministically from stored state,
  never re-validating already-accepted results against possibly-changed current task state.

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
