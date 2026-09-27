# Area: Batch context and report

## Responsibility

Build a deduplicated context packet for a batch session, produce one canonical shared batch
report with per-task durable references (never a full copy per task), attribute cross-task
findings to explicit affected task IDs, and add the additive per-task predecessor lineage field
a batch session needs.

## Current state

- `buildContextPacket(change, task)` (`tools/specs/context.mjs`, lines 208–249) is single-task
  only — no batching/deduplication logic exists. `StepContext.relevantDocs`
  (`tools/specs/workflow/step-context.mjs`) is likewise resolved per single task/step.
- `attributeTouchedPaths`/`detectBatchIntegrationFindings`/`computeBatchReviewVerdict`
  (`tools/specs/batch/operation.mjs`, imported lines 16–18) already implement cross-task
  file-overlap detection for the legacy gating batch review — this area reuses that precedent for
  its own overlap detection rather than reimplementing it.
- `parentSessionId` is a single scalar on `AgentSession`; `reconcileWorkflowPosition`
  (`tools/dashboard/server/ai/orchestration/reconciliation.mjs`, lines 142–180) resolves it by
  scanning one task's own history backward.
- No existing ADR or decision record was found describing a "postponed general session-context
  delivery architecture" — the scope constraint below is a design instruction, not a cited prior
  decision.

## Requirements

- **`BatchContext`** (new, e.g. `tools/specs/context/batch-context.mjs`), built by calling the
  existing single-task `buildContextPacket` once per member task and computing the union/dedup of
  `context.required`/routing-derived docs and files across them:

  ```text
  BatchContext
    shared: { docs: [{path, usedBy: [taskId, ...]}], files: [{path, usedBy: [taskId, ...]}] }
    tasks: { [taskId]: { taskDefinition, acceptanceCriteria, taskSpecificDocs, taskSpecificFiles,
      changedPaths } }
    crossTask: { overlappingChangedPaths, sharedContracts? }
  ```

  A shared item is delivered once with `usedBy` attribution; nothing is flattened into an
  unattributed union — the reviewer must always be able to tell which context belongs to which
  task.
- Explicitly reuses the existing single-task context-packet mechanism — this area does not build
  a new content-hash/context-refresh subsystem, and does not reopen that broader, previously
  deferred architecture.
- **One canonical shared batch report**: `specs/active/<change>/reviews/review-batch-<id>.md`,
  sections per task (verdict, feedback) plus one "Cross-task findings" section — matching the
  shape already used elsewhere in this workflow for aggregate reports.
- Each task's own durable history entry (written by `batch-finish-operation`) carries a
  reference — `{batchExecutionId, reportPath, taskAnchor}` — never a copy of the report content.
- **Cross-task findings** are batch-level, each entry carrying an explicit `affectedTaskIds:
  string[]` (D11) — never an unattributed batch-wide note.
- **Lineage (D8)**: a new, additive, optional `predecessorSessions: {taskId, sessionId}[]` field
  on `AgentSession`, populated only for `kind: "task-batch"` sessions at creation time — one entry
  per member task, naming that task's own most-recent agent-owned session before the batch.
  `parentSessionId` stays `null` for a batch session (consistent with the existing "don't
  fabricate cross-task lineage into one scalar" behavior already in `reconciliation.mjs`). A
  refiner session spawned after a batch-reviewed task fails sets its own `parentSessionId` to the
  batch session's id — a genuinely singular predecessor, using the existing scalar unchanged.

## Constraints

- No new external dependency for context delivery (no content-hashing library, no new caching
  layer) — reuses `buildContextPacket` as-is per task.
- The report file is the one exception to "this operation doesn't otherwise write source/spec
  files" — same convention every other review artifact in this repository already follows.

## Interfaces and boundaries

Exposes: `BatchContext` (consumed by `multi-task-review-skill` as the reviewer session's input),
the report-writing function (called once by the reviewer session before its batch-finish call),
`predecessorSessions` (read by lineage-resolution code, e.g. a future task-review inspecting a
refiner's ancestry). Consumes: `execution-scope-model`'s `ExecutionScope` (which tasks to build
context for), the existing `buildContextPacket`, `attributeTouchedPaths`/
`detectBatchIntegrationFindings`.

## Area-specific acceptance criteria

- Given three tasks sharing one doc and one file plus each having a distinct task-specific file,
  the built `BatchContext` lists the shared doc/file exactly once each, with `usedBy` naming all
  three tasks, and each task's own specific file appears only under that task.
- The report file renders one section per task plus one cross-task findings section, each finding
  naming its `affectedTaskIds` explicitly.
- A batch session's `AgentSession` record has `parentSessionId: null` and a `predecessorSessions`
  entry for each member task naming that task's own last agent-owned session.
- A refiner session created after a batch-reviewed task fails has `parentSessionId` equal to the
  batch session's id.

## Dependencies

`areas/execution-scope-model.md` (the scope naming which tasks to build context for and to
attribute lineage against).

## Out of scope

The reviewer's own behavior/judgment (`multi-task-review-skill`) — this area only builds the
input it consumes and the report structure it writes. The batch-finish operation itself
(`batch-finish-operation`) — this area only supplies the reference the operation attaches, it
does not perform the task mutation.
