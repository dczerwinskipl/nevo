# Area: Agent step bootstrap and context

## Responsibility

Extend `compileStepContext()` (`tools/specs/workflow/step-context.mjs`) so the
`workflow step start` payload is self-sufficient for an executing agent: it carries the
task's own document directly (D22), distinguishes task-declared `requiredContext` from
routing-derived `relevantDocs` (D23), and exposes only the source-control facts an agent
genuinely needs to act — never the full internal finalize-action context, and never two
field names for one shape (D24). This area owns `step-context.mjs` only — it does not touch
`finish-operation.mjs`'s own internal use of the same underlying facts, which is unaffected.

## Current state (grounded, 2026-09-21)

`compileStepContext()`'s `task` field is `effectiveTask.id` only — no file path or content.
`relevantDocs` is computed exclusively by `resolveRelevantDocs(allowedPaths, routingIndex)`
(routing-rule matches against affected paths); the task frontmatter's own
`context.required`/`optional` is never read by this function. `context.sourceControl` is
`CommitAndPushAction.check()`'s full factual context via the shared
`normalizeSourceControlFacts()` normalizer (also consumed, unchanged, by
`finish-operation.mjs`'s `planFinish`), including `existingCommits` (effectively full branch
history from `main`). `finishContract.parameters` and `finishContract.requiredInputs` are the
identical object reference (`requiredInputs: parameters`), not two shapes.

The legacy `buildContextPacket()` (`tools/specs/context.mjs`) already resolves `task.file`
(via `resolveWithinBase(changeDir, task.file)` + `parseFrontMatterFile`) and
`context.required`/`optional` for the legacy path — the resolution primitives this area needs
already exist in the codebase for a different consumer.

## Requirements

- Add `taskDefinition: {id, path, content}` to `compileStepContext()`'s return value (both
  the non-terminal and terminal-phase branches) — `path` repo-root-relative, `content` the
  task file's full raw text, resolved via the same `resolveWithinBase`/file-read pattern
  `buildContextPacket()`/`publish/operation.mjs` already use (D22).
- Add `requiredContext` — resolved from the task frontmatter's `context.required` (and
  `context.optional` if the loader already distinguishes them) — as a field distinct from
  `relevantDocs`. Evaluate, during implementation, whether to bundle each document's content
  inline (preferred, to avoid extra agent read calls) versus canonical paths only, against
  real payload-size impact (D23). `relevantDocs`'s existing computation and meaning are
  unchanged.
- Trim `context.sourceControl` to an agent-facing projection (at minimum `currentBranch`,
  `changedFiles`, `taskAffectedFiles`) distinct from the internal shape
  `normalizeSourceControlFacts()` already produces for `finish-operation.mjs` — do not change
  what `finish-operation.mjs` itself consumes (D24).
- Collapse `finishContract` to one canonical field, `parameters`; drop `requiredInputs` unless
  a real external consumer is found during implementation to still need the separate name, in
  which case fix that consumer instead of keeping the duplicate (D24).

## Constraints

- No change to `finish-operation.mjs`'s own internal use of `CommitAndPushAction.check()`/
  `normalizeSourceControlFacts()` — this area only changes what is exposed in the public
  `StepContext`, never the engine's own correctness-relevant internal facts.
- No change to `relevantDocs`'s existing routing-derived computation.
- Additive only: existing consumers reading `task`/`relevantDocs`/`context.sourceControl`
  unchanged fields keep working; only `finishContract.requiredInputs` is a removal, gated on
  confirming (by grep) that no real caller depends on it as a distinct value from
  `parameters`.

## Interfaces and boundaries

Exposes: the extended `StepContext` shape (`taskDefinition`, `requiredContext`, trimmed
`context.sourceControl`, single `finishContract.parameters`).

Consumed by: any agent session executing `workflow step start` (via
`tools/dashboard/server/ai/sessions/service.mjs`'s existing bootstrap mechanism, unchanged),
and by `areas/workflow-continuation-and-session-handover.md`'s orchestrator, which passes the
same `StepContext` through to a handed-off session unchanged.

## Area-specific acceptance criteria

- `workflow step start <change> <task>` (CLI) and the dashboard's equivalent session
  bootstrap both return a `taskDefinition.content` that is byte-for-byte the same as reading
  the task's own file directly from `change.yaml → tasks[].file`.
- `requiredContext` for `activity-core-model-and-contracts`-shaped tasks lists exactly the
  task frontmatter's declared `context.required` entries — never fewer, never routing-derived
  substitutes.
- `relevantDocs` and `requiredContext` can both be non-empty and disjoint in the same
  response — proving they are not merged or deduplicated against each other.
- `context.sourceControl.existingCommits` (or equivalent full-branch-history field) is absent
  from the agent-facing `StepContext`; `finish-operation.mjs`'s own internal finalize
  decision-making is unaffected (its own test suite passes unchanged).
- `finishContract` has no `requiredInputs` field, or (if a real consumer required keeping it)
  `requiredInputs` and `parameters` are documented as intentionally identical with a comment
  explaining why, not left as an unexplained duplicate.

## Dependencies

None among this change's own prior tasks (touches `step-context.mjs` directly); reuses
primitives already proven by `tools/specs/context.mjs`/`publish/operation.mjs`.

## Out of scope

Any change to `finish-operation.mjs`'s internal finalize logic. Any change to how
`relevantDocs`/routing rules are computed. The orchestration/continuation layer that consumes
this extended `StepContext` (`areas/workflow-continuation-and-session-handover.md`).
