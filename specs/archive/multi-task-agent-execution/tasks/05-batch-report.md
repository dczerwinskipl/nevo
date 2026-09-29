---
id: multi-task-agent-execution.batch-report
status: draft
change: multi-task-agent-execution
context:
  required:
    - specs/active/multi-task-agent-execution/overview.md
    - specs/active/multi-task-agent-execution/areas/batch-report.md
    - specs/active/multi-task-agent-execution/owner-decisions.md
allowed_paths:
  - tools/specs/reviews/batch-report.mjs
  - tools/tests/batch-report.test.mjs
forbidden_paths:
  - src/**
  - tools/dashboard/ui/**
  - tools/specs/workflow/**
  - tools/specs/context.mjs
  - tools/specs/context/batch-context.mjs
depends_on: [ batch-start-and-context-bootstrap ]
semantic_references:
  decisions: [D7, D11, D32]
  dependency_contracts: [batch-start-and-context-bootstrap]
---

# Task: Batch report

## Goal

Render the already-final `BatchContext` (built entirely by `batch-start-and-context-bootstrap`,
D32) into the one canonical shared batch report file. This task builds nothing — no context
resolution, no cross-task overlap detection, no lineage resolution; it consumes a finished
`BatchContext` and writes Markdown.

## Dependencies

`batch-start-and-context-bootstrap` (the final `BatchContext` this task renders — never rebuilds).

## Implementation constraints

- New module (e.g. `tools/specs/reviews/batch-report.mjs`) exporting a single render function
  taking the already-final `BatchContext` as a plain input parameter.
- **Do not resolve or extend `BatchContext` in any way** — no calls to `resolveIncomingExecution`,
  no cross-task overlap computation, no lineage resolution. If a report field seems to be missing,
  that is a `batch-start-and-context-bootstrap` gap to fix there, not something to compute here
  (D32).
- Report file: `specs/active/<change>/reviews/review-batch-<batchExecutionId>.md`, one section per
  task (verdict, feedback) plus one "Cross-task findings" section, each finding rendering its
  input `affectedTaskIds` verbatim (D11) — matching the shape already used elsewhere in this
  workflow for aggregate reports.
- **Writes content only — no Git commit call anywhere in this task** (D22/D30) —
  `batch-finish-operation` owns the commit.
- `tools/specs/workflow/**` and `tools/specs/context/batch-context.mjs` are forbidden paths for
  this task — a genuine need to touch either means the change belongs in
  `batch-start-and-context-bootstrap` instead, not here.

## Acceptance criteria

- Given a `BatchContext` already containing shared/task-specific attribution, `crossTask`
  findings, and per-task lineage, the report file renders one section per task plus one cross-task
  findings section, each finding naming its `affectedTaskIds` explicitly — using exactly the input
  `BatchContext`. `automated: node --test tools/tests/batch-report.test.mjs`
- This task's own source contains zero calls to `buildContextPacket`, zero calls to
  `resolveIncomingExecution`, and zero Git commit calls.
  `automated: node --test tools/tests/batch-report.test.mjs`
- One canonical report file per `batchExecutionId` — rendering the same `BatchContext` twice
  produces byte-identical output (no hidden nondeterminism, e.g. unsorted map iteration).
  `automated: node --test tools/tests/batch-report.test.mjs`

## Verification

```bash
node --test tools/tests/batch-report.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Building `BatchContext` in any form — dedup, cross-task overlap, lineage resolution (all
`batch-start-and-context-bootstrap`, D32). The reviewer's own behavior/judgment
(`multi-task-review-skill`). The batch-finish operation's own mutation logic and the report's Git
commit (`batch-finish-operation`, D22/D30).
