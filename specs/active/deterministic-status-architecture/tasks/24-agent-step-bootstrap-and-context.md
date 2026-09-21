---
id: deterministic-status-architecture.agent-step-bootstrap-and-context
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/agent-step-bootstrap-and-context.md
    - specs/active/deterministic-status-architecture/owner-decisions.md
allowed_paths:
  - tools/specs/workflow/step-context.mjs
  - tools/tests/workflow-step-context.test.mjs
forbidden_paths:
  - tools/specs/workflow/finish-operation.mjs
  - tools/dashboard/**
  - src/**
depends_on: []
semantic_references:
  decisions: [D22, D23, D24]
---

# Task: Agent step bootstrap and context

## Goal

Extend `compileStepContext()` so `workflow step start`'s payload is self-sufficient: the
task's own document (D22), task-declared `requiredContext` distinct from routing-derived
`relevantDocs` (D23), and an agent-facing source-control projection trimmed of
`CommitAndPushAction.check()`'s full internal context, with `finishContract` collapsed to one
canonical field (D24) — without touching `finish-operation.mjs`'s own, unaffected internal
use of the same underlying facts.

## Implementation constraints

- Add `taskDefinition: {id, path, content}` to both the non-terminal and terminal-phase
  return branches of `compileStepContext()`. Resolve `path`/`content` using the same
  `resolveWithinBase(changeDir, task.file)` + file-read pattern already proven by
  `tools/specs/context.mjs`'s `loadTaskFrontMatter()` and
  `publish/operation.mjs`'s `validateTaskDefinitionForPublish` — do not invent a second
  resolution helper.
- Add `requiredContext`, resolved from the task frontmatter's `context.required`/`optional`
  (reuse the existing frontmatter-loading path, not a new parser). Bundle each listed
  document's content inline unless doing so measurably bloats the payload for a realistic
  task (judge against the existing `relevantDocs`/`instructions` payload size as a baseline);
  if content is omitted, still return canonical repo-root-relative paths. Document whichever
  choice is made directly in this file's own code comments — do not leave it ambiguous for
  the next reader.
- `relevantDocs`'s existing computation (`resolveRelevantDocs`) is unchanged — `requiredContext`
  is additive, never a replacement, and the two fields must never be merged/deduplicated
  against each other in the return value.
- Introduce an agent-facing source-control projection (e.g. `pickAgentFacingSourceControl(facts)`)
  that keeps at least `currentBranch`, `changedFiles`, `taskAffectedFiles` and drops
  `existingCommits`/`unpushedCommits` (or any other full-history field) from what
  `compileStepContext()` returns in `context.sourceControl` — call it only at the point
  `compileStepContext()` builds its own return value; do not change
  `normalizeSourceControlFacts()`'s own output, which `finish-operation.mjs`'s `planFinish`
  still consumes unchanged.
- Grep the repository for `finishContract.requiredInputs` before removing it. If no real
  caller reads it as distinct from `.parameters`, delete the `requiredInputs` key entirely
  from `compileStepContext()`'s return value (both branches). If a real caller is found,
  keep both but add a one-line comment explaining they are intentionally identical, and note
  this deviation in the task's own completion notes for `owner-decisions.md` (D24) to record
  if it becomes material.

## Acceptance criteria

- `workflow step start <change> <task>` returns `taskDefinition.content` byte-for-byte
  identical to reading `change.yaml → tasks[].file` directly for that task.
  `automated: node --test tools/tests/workflow-step-context.test.mjs`
- `requiredContext` for a task whose frontmatter declares `context.required` lists exactly
  those entries; a task with no declared `context.required` returns an empty/absent
  `requiredContext`, never fabricated entries.
  `automated: node --test tools/tests/workflow-step-context.test.mjs`
- A response can carry a non-empty `relevantDocs` and a non-empty `requiredContext`
  simultaneously with no overlap-deduplication applied — both lists reflect their own
  independent source.
  `automated: node --test tools/tests/workflow-step-context.test.mjs`
- `context.sourceControl` in the returned `StepContext` contains no `existingCommits`/
  `unpushedCommits` (or equivalent full-history) field; `finish-operation.mjs`'s own existing
  test suite (`tools/tests/workflow-finish-operation.test.mjs` or equivalent) passes
  unchanged, proving its internal use of the full facts is unaffected.
  `automated: node --test tools/tests/workflow-step-context.test.mjs`
- `finishContract` has no `requiredInputs` field (or, if kept, is documented in-code as
  intentionally identical to `parameters`).
  `automated: node --test tools/tests/workflow-step-context.test.mjs`

## Verification

```bash
node --test tools/tests/workflow-step-context.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Any change to `finish-operation.mjs`'s internal finalize logic or `normalizeSourceControlFacts()`'s
own output shape. Any change to `relevantDocs`'s routing-derived computation. The
continuation/handover orchestrator that consumes this extended `StepContext`
(`agent-step-bootstrap-and-context` is a pure extension of the payload, not its consumer).
