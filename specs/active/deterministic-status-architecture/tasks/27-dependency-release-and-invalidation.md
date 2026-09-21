---
id: deterministic-status-architecture.dependency-release-and-invalidation
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/dependency-release-and-invalidation.md
    - specs/active/deterministic-status-architecture/owner-decisions.md
allowed_paths:
  - tools/specs/workflow/dependency-satisfaction.mjs
  - tools/specs/workflow/task-projection.mjs
  - tools/specs/workflow/remediation-record.mjs
  - tools/tests/deterministic-dependency-satisfaction.test.mjs
  - tools/tests/deterministic-task-projection.test.mjs
forbidden_paths:
  - tools/specs/workflow/step-context.mjs
  - tools/specs/workflow/finish-operation.mjs
  - tools/dashboard/**
depends_on: [ workflow-continuation-schema ]
semantic_references:
  decisions: [D28, D31, D36, D37]
---

# Task: Dependency release and invalidation

## Goal

Implement D28's declarative release: `evaluateDependencySatisfaction` reads a matched
internal transition's `releasesDependencies: true` (task 25's schema) as an alternate
satisfaction path. Implement D31's remediation-group derivation, **including consumers that
have already reached a terminal transition** (corrected — a terminal consumer is not
retroactively correct merely because it finished), persisted durably (D36) in a new
`tools/specs/workflow/remediation-record.mjs` module, with a `suspensions` field distinct
from `blockedBy` (D37).

## Implementation constraints

- `evaluateDependencySatisfaction`: alongside the existing terminal-transition-with-
  `outcome: success` check, also satisfy a dependent when the dependency's last
  `workflow_progress.history` entry matches an *internal* transition declaring
  `releasesDependencies: true`. Do not change the existing terminal-transition path's
  behavior.
- `tools/specs/workflow/remediation-record.mjs` (new): owns the durable record convention
  `.nevo-ai-local/remediation-groups/<change>/<remediationId>.json` (atomic
  temp-file-then-rename writes, same family as `operation-record.mjs`), shape
  `{remediationId, rootTaskId, causeAttempt: {step, attempt}, members: string[],
  discoveredMembers: string[], state: 'open'|'fixing'|'reviewing'|'resolved'}`. Exports
  `createRemediationGroup`, `loadRemediationGroup`, `addDiscoveredMember` (the one function
  `dependency-invalidation-remediation-review`, task 30, is allowed to call to extend a
  group).
- Remediation-group derivation function: given a task whose `workflow_progress.history` shows
  a `releasesDependencies` transition followed by a later entry for an earlier step, walk the
  change's other tasks' `depends_on` to find **every** dependent that reached `active` on any
  step while the release was in effect — regardless of whether that dependent is now `active`,
  `waiting`, `completed`, or already `terminal`. Create the durable record via
  `remediation-record.mjs` with this full member set.
- `TaskProjection` gains a new, separate `suspensions?: {taskId, reason:
  'dependency-invalidated', groupId}[]` field — additive, never merged into or replacing the
  existing `blockedBy: string[]` field, whose shape and meaning are unchanged (D37). Every
  non-terminal group member gets a `suspensions` entry blocking its own next step start; a
  terminal group member gets the same entry, understood as advisory only (no next step to
  enforce against) — it must never be reopened, re-executed, or have its
  `workflow_progress.history` altered.

## Acceptance criteria

- A dependency whose matched transition declares `releasesDependencies: true` satisfies its
  dependents immediately, before its own workflow reaches a terminal transition.
  `automated: node --test tools/tests/deterministic-dependency-satisfaction.test.mjs`
- Every existing terminal-transition-`outcome: success` test continues passing unchanged.
  `automated: node --test tools/tests/deterministic-dependency-satisfaction.test.mjs`
- A fixture with one root task (released dependents, then moved backward) and three
  dependents — one `active`, one `waiting`, one already `terminal` (`verified`) — derives a
  remediation group containing the root task and all three dependents.
  `automated: node --test tools/tests/deterministic-dependency-satisfaction.test.mjs`
- The durable record created for that group persists to
  `.nevo-ai-local/remediation-groups/<change>/<remediationId>.json` and reloads with an
  identical member set after a simulated process restart (fresh module load reading the same
  file).
  `automated: node --test tools/tests/deterministic-dependency-satisfaction.test.mjs`
- Every non-terminal group member's `TaskProjection.suspensions` contains a
  `dependency-invalidated` entry and is excluded from `blockedBy`'s existing set (proving
  `blockedBy` is untouched); the terminal member's `workflow_progress.history` is unchanged
  byte-for-byte.
  `automated: node --test tools/tests/deterministic-task-projection.test.mjs`
- `addDiscoveredMember` appends to a group's `discoveredMembers` and the change is visible on
  the next `loadRemediationGroup` call.
  `automated: node --test tools/tests/deterministic-dependency-satisfaction.test.mjs`

## Verification

```bash
node --test tools/tests/deterministic-dependency-satisfaction.test.mjs
node --test tools/tests/deterministic-task-projection.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Running the remediation group's fix attempts (`deterministic-batch-orchestrator`, task 28).
The combined cross-task-aware review and `suspensions`-clearing
(`dependency-invalidation-remediation-review`, task 30). The `releasesDependencies` schema
field itself (`workflow-continuation-schema`, task 25). Reopening a terminal task's workflow.
