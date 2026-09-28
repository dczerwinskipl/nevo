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
  - tools/specs/context/batch-context.mjs
  - tools/dashboard/server/ai/sessions/binding-service.mjs
  - tools/tests/batch-context.test.mjs
forbidden_paths:
  - src/**
  - tools/dashboard/ui/**
  - tools/specs/workflow/queue/**
  - tools/specs/context.mjs
depends_on: [ execution-scope-model, batch-start-and-context-bootstrap ]
semantic_references:
  decisions: [D7, D8, D11, D15, D22, D25]
  dependency_contracts: [execution-scope-model, batch-start-and-context-bootstrap]
---

# Task: Batch context and report

## Goal

Extend the raw `BatchContext` `batch-start-and-context-bootstrap` already built (from resolved
deterministic `StepContext`s, D15 — never the legacy `buildContextPacket`) with cross-task overlap
findings and role-name-agnostic, fail-closed `predecessorSessions` lineage (D25); write the one
canonical shared batch report.

## Dependencies

`execution-scope-model` (`ExecutionScope`, `resolveIncomingExecution`),
`batch-start-and-context-bootstrap` (the resolved per-member `StepContext`s / raw `BatchContext`
this task extends — this task does not re-resolve context itself).

## Implementation constraints

- **Do not call `buildContextPacket` anywhere in this task** (D15) — `tools/specs/context.mjs` is
  explicitly forbidden for this task; it is the legacy lifecycle's own contract. This task extends
  the `StepContext`-sourced `BatchContext` `batch-start-and-context-bootstrap` already produced.
- Reuse `attributeTouchedPaths`/`detectBatchIntegrationFindings` (`tools/specs/batch/operation.mjs`,
  read-only import) for cross-task file-overlap detection — do not reimplement it.
- Report file: `specs/active/<change>/reviews/review-batch-<batchExecutionId>.md` — this task
  writes the file's **content only**; `batch-finish-operation` owns its Git commit (D22). Do not
  add a commit call in this task.
- Cross-task findings are batch-level, each carrying explicit `affectedTaskIds: string[]` (D11).
- **Lineage resolution must not reference any literal role/step name (D25)** — resolve "the exact
  predecessor agent execution for this task's incoming transition/history," generically, via
  `execution-scope-model`'s `resolveIncomingExecution` (D20), not a hardcoded `'implementer'`
  lookup:
  1. Check the task's authoritative exact history binding for its preceding step;
  2. Else inspect bindings for that task at its preceding step: exactly one match → use it;
     multiple (ambiguous) or none → fail closed to `sessionId: null`;
  3. Represent unresolved/ambiguous lineage explicitly as `predecessorSession: null` in
     `BatchContext` — never guess, never pick the newest.
- `predecessorSessions: {taskId, sessionId | null}[]` on `AgentSession`, populated only for
  `kind: "task-batch"` sessions. `parentSessionId` stays `null` for the batch session; a refiner
  session created after a batch-reviewed task fails still sets its own `parentSessionId` to the
  batch session's id, unchanged (D8).

## Acceptance criteria

- Given three tasks sharing one doc and one file plus distinct task-specific files, `BatchContext`
  lists the shared items once each with `usedBy` naming all three — sourced from the resolved
  `StepContext`s, not `buildContextPacket`. `automated: node --test tools/tests/batch-context.test.mjs`
- The report file renders one section per task plus one cross-task findings section with explicit
  `affectedTaskIds`. `automated: node --test tools/tests/batch-context.test.mjs`
- A batch session's record has `parentSessionId: null` and a `predecessorSessions` entry per
  member. `automated: node --test tools/tests/batch-context.test.mjs`
- A refiner session created after a batch-reviewed task's failure has `parentSessionId` equal to
  the batch session's id. `automated: node --test tools/tests/batch-context.test.mjs`
- Lineage resolution against a workflow definition using non-`implementer`/`reviewer`/`refiner`
  role names resolves identically — proven directly against a fixture using different role names,
  not merely asserted. `automated: node --test tools/tests/batch-context.test.mjs`
- This task's own source contains zero calls to `buildContextPacket` and zero Git commit calls —
  explicit, automated checks. `automated: node --test tools/tests/batch-context.test.mjs`

## Verification

```bash
node --test tools/tests/batch-context.test.mjs
node tools/specs.mjs validate
```

## Documentation impact

Update `docs/development/ai-sessions.md`'s lineage/`parentSessionId` description to note the
additive, role-name-agnostic `predecessorSessions` field, in the same branch.

## Out of scope

The reviewer's own behavior (`multi-task-review-skill`). Resolving `StepContext` or activating
steps (`batch-start-and-context-bootstrap`). The batch-finish operation's own mutation logic and
the report's Git commit (`batch-finish-operation`, D22).
