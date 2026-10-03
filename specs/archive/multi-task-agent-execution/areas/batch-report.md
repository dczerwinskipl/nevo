# Area: Batch report

## Responsibility

Render the already-final `BatchContext` (built entirely by `batch-start-and-context-bootstrap`,
D32) into the one canonical shared batch report file. **This area builds nothing** — no context
resolution, no cross-task overlap detection, no lineage resolution. It consumes a finished
`BatchContext` and writes Markdown.

## Current state

- **Correction (D32):** an earlier draft of the spec had this area (then named
  `batch-context-and-report`) both consuming a "raw" `BatchContext` from
  `batch-start-and-context-bootstrap` *and* extending it with cross-task overlap/lineage — but
  nothing wired that extension back into the public `workflow batch start` operation, and the two
  tasks could not depend on each other without a cycle. That construction/extension split is
  removed: `batch-start-and-context-bootstrap` now owns the complete `BatchContext` (D15's
  StepContext-sourcing and D25's lineage resolution both live there). This area's only remaining
  job is rendering.
- `specs/active/<change>/reviews/` is the existing convention for review artifacts in this
  workflow (aggregate reports, audits) — this area's report file follows the same convention.

## Requirements

- **Render, not build.** Accepts the final `BatchContext` (shared docs/files with `usedBy`
  attribution, per-task specifics, `crossTask` overlap findings, per-task `predecessorSession`)
  as an input parameter — never re-resolves or re-derives any part of it.
- **One canonical shared batch report**: `specs/active/<change>/reviews/review-batch-<batchExecutionId>.md`,
  one section per task (verdict, feedback) plus one "Cross-task findings" section — matching the
  shape already used elsewhere in this workflow for aggregate reports.
- **Writes content only — never commits.** `batch-finish-operation` owns the file's Git commit,
  with an explicit report-path-only stage (D22/D30). This area's own write is the plain filesystem
  write that produces the uncommitted file the reviewer's own session leaves behind before calling
  batch finish.
- Each task's own durable history entry (written by `batch-finish-operation`) carries a
  reference — `{batchExecutionId, reportPath, taskAnchor}` — never a copy of the report content.
- **Cross-task findings** are batch-level, each entry carrying an explicit `affectedTaskIds:
  string[]` (D11) — never an unattributed batch-wide note. (The findings themselves are computed
  by `batch-start-and-context-bootstrap`; this area only renders them.)

## Constraints

- No context resolution, StepContext access, or lineage logic lives here — if an implementer
  finds themselves calling `resolveIncomingExecution` or building `BatchContext` fields from this
  module, that logic belongs in `batch-start-and-context-bootstrap` instead (D32).
- No Git commit call anywhere in this area (D22/D30) — `batch-finish-operation`'s job alone.

## Interfaces and boundaries

Exposes: the report-writing function (called once, by the reviewer session, before its
batch-finish call — writes content only). Consumes: the final `BatchContext` from
`batch-start-and-context-bootstrap`. Consumed by: `multi-task-review-skill` (calls this to produce
the report before batch-finish), `batch-finish-operation` (commits the file this area wrote,
attaches the reference to each task's history).

## Area-specific acceptance criteria

- Given a `BatchContext` already containing shared/task-specific attribution, `crossTask`
  findings, and per-task lineage, the report file renders one section per task plus one
  cross-task findings section, each finding naming its `affectedTaskIds` explicitly — using
  exactly the input `BatchContext`, no independent resolution.
- This area's own source contains zero calls to `buildContextPacket`, zero calls to
  `resolveIncomingExecution`, and zero Git commit calls — explicit, automated checks.

## Dependencies

`areas/batch-start-and-context-bootstrap.md` (the final `BatchContext` this area renders — this
area does not build any part of it).

## Out of scope

Building `BatchContext` in any form — dedup, cross-task overlap, lineage resolution (all
`batch-start-and-context-bootstrap`, D32). The reviewer's own behavior/judgment
(`multi-task-review-skill`). The batch-finish operation's own mutation logic and the report's Git
commit (`batch-finish-operation`, D22/D30).
