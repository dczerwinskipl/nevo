---
id: multi-task-agent-execution.execution-scope-model
status: draft
change: multi-task-agent-execution
context:
  required:
    - specs/active/multi-task-agent-execution/overview.md
    - specs/active/multi-task-agent-execution/areas/execution-scope-model.md
    - specs/active/multi-task-agent-execution/owner-decisions.md
allowed_paths:
  - tools/specs/workflow/execution-scope.mjs
  - tools/dashboard/server/ai/sessions/binding-service.mjs
  - tools/dashboard/server/ai/sessions/service.mjs
  - tools/specs/workflow/workspace-writer.mjs
  - tools/dashboard/server/ai/orchestration/admission.mjs
  - tools/dashboard/server/ai/orchestration/reconciliation.mjs
  - tools/tests/execution-scope.test.mjs
  - tools/tests/agent-session-attach.test.mjs
  - tools/tests/workspace-writer.test.mjs
  - tools/tests/cli-workspace-execution.test.mjs
  - tools/tests/workspace-claim-reconciliation.test.mjs
  - tools/tests/deterministic-status-corrective.test.mjs
forbidden_paths:
  - src/**
  - tools/dashboard/ui/**
  - tools/specs/workflow/queue/**
  - tools/specs/batch/**
semantic_references:
  decisions: [D2]
  constraints: [C1, C3, C5]
---

# Task: Execution scope model

## Goal

Introduce the `ExecutionScope` type (`{kind: "task", taskId}` |
`{kind: "task-batch", taskIds: string[]}`) as a shared module, and thread it through
`AgentSession`, the workspace-writer claim, and `admitAgentExecution`'s candidate/
`activeExecutions` shape, so a batch execution's ownership/membership has one canonical,
explicit source of truth — never the existing singular `activeTaskId`/`claim.taskId` fields
promoted to stand in for a batch (D2).

## Implementation constraints

- `taskIds.length >= 2` for `kind: "task-batch"` — reject a size-1 batch as malformed input.
- For `kind: "task"` scopes, `activeTaskId`/`claim.taskId` continue to mirror the scope's single
  `taskId` exactly — zero behavior change for existing single-task sessions/claims.
- For `kind: "task-batch"` scopes, `activeTaskId` is never populated from any member task id, and
  the claim's replacement `scope` field is the only ownership reference — no dual `taskId`
  field, no silent fallback anywhere in `workspace-writer.mjs`/`admission.mjs`/
  `reconciliation.mjs`.
- Do not add a `primaryTaskId` or equivalent representative-task field — none is required by this
  task, and D2 explicitly forbids reusing the existing scalars for that purpose.
- `admitAgentExecution`'s `activeExecutions` map stays keyed by `specId`, holding at most one
  entry regardless of scope kind (D33 unchanged) — its stored value's `taskId` field is replaced
  by `scope: ExecutionScope`.
- Re-verify the exact current line numbers/shapes in `binding-service.mjs`/`workspace-writer.mjs`/
  `admission.mjs`/`reconciliation.mjs` before editing — this neighborhood received four corrective
  commits in the ~30 hours before this spec was written (C5); do not assume this task file's own
  citations are still exact.

## Acceptance criteria

- A single-task session/claim created through existing code paths is unchanged in observable
  behavior. `automated: node --test tools/tests/agent-session-attach.test.mjs tools/tests/workspace-writer.test.mjs tools/tests/cli-workspace-execution.test.mjs`
- Constructing a `kind: "task-batch"` session/claim never populates `activeTaskId`/legacy
  `claim.taskId` with any member task's id. `automated: node --test tools/tests/execution-scope.test.mjs`
- `admitAgentExecution` given a `task-batch` candidate yields exactly one `activeExecutions` entry
  for that spec; a second admission attempt for any task already covered by that scope is refused.
  `automated: node --test tools/tests/execution-scope.test.mjs`
- `tools/specs/workflow/queue/**` still contains zero imports of `tools/dashboard/**` (unaffected
  by this task — proven as a regression check, not merely assumed).
  `automated: node --test tools/tests/deterministic-task-queue.test.mjs`
- Existing corrective-suite coverage for admission/reconciliation still passes.
  `automated: node --test tools/tests/deterministic-status-corrective.test.mjs`

## Verification

```bash
node --test tools/tests/execution-scope.test.mjs tools/tests/agent-session-attach.test.mjs tools/tests/workspace-writer.test.mjs tools/tests/cli-workspace-execution.test.mjs tools/tests/workspace-claim-reconciliation.test.mjs tools/tests/deterministic-status-corrective.test.mjs
node tools/specs.mjs validate
```

## Documentation impact

Update `docs/development/ai-sessions.md`'s `AgentSession`/claim schema description to include
`executionScope`, and `docs/development/agent-workflow-protocol.md`'s workspace-writer claim
description to include `scope` replacing the bare `taskId` — in the same branch, per
`artifact-policy.md`'s "architecture docs describe current behavior" rule.

## Out of scope

The queue reservation mechanism, the batch-finish operation, batch context/report, the skill, and
any UI — every later task in this change depends on this one but implements none of it here.
