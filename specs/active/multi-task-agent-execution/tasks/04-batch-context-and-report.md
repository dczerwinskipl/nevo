---
id: multi-task-agent-execution.batch-context-and-report
status: draft
change: multi-task-agent-execution
context:
  required:
    - specs/active/multi-task-agent-execution/overview.md
    - specs/active/multi-task-agent-execution/areas/batch-context-and-report.md
    - specs/active/multi-task-agent-execution/owner-decisions.md
allowed_paths:
  - tools/specs/context.mjs
  - tools/specs/context/batch-context.mjs
  - tools/dashboard/server/ai/sessions/binding-service.mjs
  - tools/tests/context.test.mjs
  - tools/tests/batch-context.test.mjs
forbidden_paths:
  - src/**
  - tools/dashboard/ui/**
  - tools/specs/workflow/queue/**
depends_on: [ execution-scope-model ]
semantic_references:
  decisions: [D7, D8, D11]
  dependency_contracts: [execution-scope-model]
---

# Task: Batch context and report

## Goal

Build a deduplicated `BatchContext` for a batch session by calling the existing single-task
`buildContextPacket` once per member task and computing the union/dedup of shared docs/files with
explicit `usedBy` attribution; write one canonical shared batch report with per-task/cross-task
sections; add the additive `predecessorSessions` lineage field for `task-batch` sessions.

## Dependencies

`execution-scope-model` — the scope naming which tasks to build context for and to attribute
lineage against.

## Implementation constraints

- Call the existing `buildContextPacket(change, task)` once per member task — do not build a
  parallel context-resolution mechanism. Compute the shared/task-specific split by set
  intersection/difference over each task's own resolved `context.required`/routing-derived docs
  and files.
- Do not build a content-hash/context-refresh subsystem — this task's scope is the dedup/
  attribution shape above, nothing more.
- Reuse `attributeTouchedPaths`/`detectBatchIntegrationFindings` (`tools/specs/batch/operation.mjs`)
  for cross-task file-overlap detection rather than reimplementing it (read-only import from that
  module; this task does not modify legacy `tools/specs/batch/**`, which stays forbidden).
- Report file: `specs/active/<change>/reviews/review-batch-<id>.md`, one canonical shared report
  per batch (D7), one section per task plus one "Cross-task findings" section; each finding's
  affected tasks are explicit (`affectedTaskIds: string[]`, D11), never an unattributed
  batch-wide note.
- `predecessorSessions: {taskId, sessionId}[]` (D8) is populated only for `kind: "task-batch"` sessions,
  at creation time, one entry per member task naming that task's own most-recent agent-owned
  session. `parentSessionId` stays `null` for a batch session — do not populate it from any member
  task's own lineage.
- A refiner session created after a batch-reviewed task fails still sets its own
  `parentSessionId` to the batch session's id, using the existing single-scalar field unchanged —
  do not extend that specific case to use `predecessorSessions`.

## Acceptance criteria

- Given three tasks sharing one doc and one file, each also having a distinct task-specific file,
  the built `BatchContext` lists the shared doc/file once each with `usedBy` naming all three, and
  each task-specific file appears only under its own task. `automated: node --test tools/tests/batch-context.test.mjs`
- The report file renders one section per task plus one cross-task findings section, each finding
  naming its `affectedTaskIds`. `automated: node --test tools/tests/batch-context.test.mjs`
- A batch session's record has `parentSessionId: null` and a `predecessorSessions` entry per
  member task. `automated: node --test tools/tests/batch-context.test.mjs`
- A refiner session spawned after a batch-reviewed task's failure has `parentSessionId` equal to
  the batch session's id. `automated: node --test tools/tests/batch-context.test.mjs`
- Existing single-task context-packet behavior is unchanged. `automated: node --test tools/tests/context.test.mjs`

## Verification

```bash
node --test tools/tests/batch-context.test.mjs tools/tests/context.test.mjs
node tools/specs.mjs validate
```

## Documentation impact

Update `docs/development/ai-sessions.md`'s lineage/`parentSessionId` description to note the
additive `predecessorSessions` field and when it applies, in the same branch.

## Out of scope

The reviewer's own behavior (`multi-task-review-skill`). The batch-finish operation's own mutation
logic (`batch-finish-operation`) — this task only supplies the reference it attaches.
