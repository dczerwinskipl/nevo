# Area: Batch context and report

## Responsibility

Build a deduplicated context packet for a batch session, produce one canonical shared batch
report with per-task durable references (never a full copy per task), attribute cross-task
findings to explicit affected task IDs, and add the additive per-task predecessor lineage field
a batch session needs.

## Current state

- **Correction (D15):** an earlier draft of this area proposed building `BatchContext` by calling
  `buildContextPacket(change, task)` (`tools/specs/context.mjs`, lines 208–249) once per member
  task. `buildContextPacket` is the **legacy** lifecycle's own context contract, not the
  deterministic engine's, and is explicitly not reused for this purpose. `BatchContext` is instead
  built from the authoritative deterministic `StepContext`s `batch-start-and-context-bootstrap`
  already resolved for each member (`taskDefinition`, `requiredContext`, `relevantDocs`,
  `stepContract`, `previousTransition`, `expectedWork`, allowed/forbidden paths, `finishContract`)
  — this area extends/attributes that already-resolved input, it does not re-resolve context
  itself. `StepContext.relevantDocs` (`tools/specs/workflow/step-context.mjs`) is the deterministic
  per-task/step source these `StepContext`s already came from.
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

- **`BatchContext`** (new, e.g. `tools/specs/context/batch-context.mjs`), built from the
  per-member `StepContext`s `batch-start-and-context-bootstrap` already resolved (D15) — this area
  computes the union/dedup of `requiredContext`/`relevantDocs`/shared files across them:

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
- Explicitly reuses `batch-start-and-context-bootstrap`'s already-resolved `StepContext`s (D15) —
  this area does not build a new content-hash/context-refresh subsystem, does not call
  `buildContextPacket`, and does not reopen that broader, previously deferred architecture.
- **One canonical shared batch report**: `specs/active/<change>/reviews/review-batch-<batchExecutionId>.md`,
  sections per task (verdict, feedback) plus one "Cross-task findings" section — matching the
  shape already used elsewhere in this workflow for aggregate reports. This area owns the report's
  **content and the function that writes it**; `batch-finish-operation` owns the **Git commit** of
  that same file (D22) — the two are deliberately separate concerns so the report is never
  accidentally attributed to whichever member task happens to finish first.
- Each task's own durable history entry (written by `batch-finish-operation`) carries a
  reference — `{batchExecutionId, reportPath, taskAnchor}` — never a copy of the report content.
- **Cross-task findings** are batch-level, each entry carrying an explicit `affectedTaskIds:
  string[]` (D11) — never an unattributed batch-wide note.
- **Lineage (D8, wording corrected by D25 — generic, not role-name-hardcoded)**: a new, additive,
  optional `predecessorSessions: {taskId, sessionId | null}[]` field on `AgentSession`, populated
  only for `kind: "task-batch"` sessions at creation time.
  - **Fail-closed resolution semantics**, resolving *"the exact predecessor agent execution for
    this task's incoming transition/history"* generically — never a literal step name or reserved
    role string such as `'implementer'`:
    1. For each member task, check if its current step has an authoritative exact history binding
       (e.g. `history.sessionId` naming the session that completed the task's own preceding
       incoming transition — whatever role that transition declares, resolved via
       `execution-scope-model`'s `resolveIncomingExecution`, D20);
    2. If not, inspect `stepBindings` / durable session index for sessions bound to that task at
       its preceding step:
       - If exactly one active/completed session exists for that task at that step, use its
         `sessionId`;
       - If multiple exist (ambiguous lineage) or none exists: fail closed to `sessionId: null`
         rather than guessing or picking the newest session;
    3. In `BatchContext`, any task whose predecessor lineage could not be unambiguously resolved is
       explicitly marked as having `predecessorSession: null` (unavailable), so the reviewer knows
       implementation dialogue history is incomplete rather than hallucinating or assuming a wrong
       predecessor.
  - `parentSessionId` stays `null` for a batch session (consistent with the existing "don't
    fabricate cross-task lineage into one scalar" behavior already in `reconciliation.mjs`). A
    refiner session spawned after a batch-reviewed task fails sets its own `parentSessionId` to the
    batch session's id — a genuinely singular predecessor, using the existing scalar unchanged.
  - A future workflow using different role names (not `implementer`/`reviewer`/`refiner`) must work
    with this primitive unmodified — role names are free-form workflow data, never baked into the
    lineage resolver itself (D25).

## Constraints

- No new external dependency for context delivery (no content-hashing library, no new caching
  layer) — extends the `StepContext`s `batch-start-and-context-bootstrap` already resolved,
  never re-resolves context itself.
- The report file is the one exception to "this operation doesn't otherwise write source/spec
  files" — same convention every other review artifact in this repository already follows. This
  area writes the file's content; it does not commit it (D22, `batch-finish-operation`'s job).
- The lineage resolver never references a literal role/step name (D25).

## Interfaces and boundaries

Exposes: `BatchContext` (extended with `crossTask` overlap findings and per-task
`predecessorSession`), the report-writing function (called once by the reviewer session before
its batch-finish call — writes content only, does not commit), `predecessorSessions` (read by
lineage-resolution code, e.g. a future task-review inspecting a refiner's ancestry). Consumes:
`execution-scope-model`'s `ExecutionScope`/`resolveIncomingExecution`,
`batch-start-and-context-bootstrap`'s resolved per-member `StepContext`s (D15),
`attributeTouchedPaths`/`detectBatchIntegrationFindings`.

## Area-specific acceptance criteria

- Given three tasks sharing one doc and one file plus each having a distinct task-specific file,
  the built `BatchContext` lists the shared doc/file exactly once each, with `usedBy` naming all
  three tasks, and each task's own specific file appears only under that task — sourced from the
  resolved `StepContext`s, not from `buildContextPacket`.
- The report file renders one section per task plus one cross-task findings section, each finding
  naming its `affectedTaskIds` explicitly.
- A batch session's `AgentSession` record has `parentSessionId: null` and a `predecessorSessions`
  entry for each member task naming that task's own last agent-owned session at its preceding
  step, resolved without any literal role-name check.
- A refiner session created after a batch-reviewed task fails has `parentSessionId` equal to the
  batch session's id.
- Constructing the same scenario against a workflow definition using different (non-`implementer`/
  `reviewer`/`refiner`) role names resolves lineage identically — proven directly, not merely
  asserted.

## Dependencies

`areas/execution-scope-model.md` (`ExecutionScope`, `resolveIncomingExecution`),
`areas/batch-start-and-context-bootstrap.md` (the resolved per-member `StepContext`s this area
extends into `BatchContext`).

## Out of scope

The reviewer's own behavior/judgment (`multi-task-review-skill`) — this area only builds the
input it consumes and the report structure it writes. The batch-finish operation itself and the
report's Git commit (`batch-finish-operation`, D22) — this area only supplies the reference and
writes the report's content, it does not perform the task mutation or the commit.
