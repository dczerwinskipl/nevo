---
id: deterministic-workflow-foundation.step-context-knowledge-hints
status: draft
change: deterministic-workflow-foundation
context:
  required:
    - specs/active/deterministic-workflow-foundation/overview.md
    - specs/active/deterministic-workflow-foundation/owner-decisions.md
    - specs/active/deterministic-workflow-foundation/areas/multi-step-workflow-orchestration.md
    - tools/specs/workflow/step-context.mjs
    - tools/specs/context.mjs
  optional:
    - docs/development/workflow-engine.md
allowed_paths:
  - tools/specs/workflow/step-context.mjs
  - tools/specs/context.mjs
  - tools/tests/workflow-next-step.test.mjs
  - docs/development/workflow-engine.md
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/**
semantic_references:
  decisions: [D10, D22, D25, D37, D38]
  constraints: [C11, C25]
  dependency_contracts: [multi-step-workflow-progression, step-active-completed-lifecycle]
---

# Task: `StepContext` knowledge/skill/file hints and step behavior contract

## Goal

Add the `instructions`/`expectedWork`/relevant-docs fields `overview.md` §7's original
`StepContext` example already illustrated but Task 06 never implemented (D22,
`areas/multi-step-workflow-orchestration.md` §6), **and** surface each step's own
configured behavior contract (D25, `areas/multi-step-workflow-orchestration.md` §10) —
making `step start` the agent's actual primary discovery surface for both task-level and
step-level expectations, not merely a step/gate/finish-contract aggregator.

1. `expectedWork`: the current task's own `allowed_paths`/`forbidden_paths`.
2. `instructions`: a short, structurally-derived summary (entry-blocker count, which
   paths are in scope) — never a free-form AI-authored paragraph.
3. A relevant-docs hint field, populated from whatever deterministic routing-rule
   matching `tools/specs/context.mjs` already computes for the legacy context packet
   against the same task's `allowed_paths` — reused as-is, not reimplemented.
4. `stepContract`: whichever of the current step's own `purpose`/`expectedWork`/`hints`
   (D25, added to the schema by Task 08) the workflow definition declares — surfaced
   verbatim, alongside (never merged into or confused with) the task-level fields above.
   A step declaring none of these fields simply omits `stepContract`, never a fabricated
   default.

This task builds on Task 10's `runtimeState`/`semanticStatus` fields (D37) — already
present on `StepContext` by the time this task starts — without duplicating or
recomputing that resolution; it only adds the task-level/step-contract fields above.

## Implementation constraints

- **Single owner for context/routing logic (D38)**: `tools/specs/context.mjs` is included in
  `allowed_paths` via D38 scope amendment to export unified, reusable pure helpers
  (`loadTaskFrontMatter`, `resolveTaskScope`, `matchRoutingRules`). `compileStepContext`
  consumes these helpers directly — it does not independently parse task frontmatter or
  filter `routingIndex.rules` inside `tools/specs/workflow/`. `pathGlobsOverlap` remains
  owned in one place (`context.mjs`).
- No new prompt-generation surface: every value in the new fields must be traceable to
  an existing deterministic source (task frontmatter, routing-rule output) — if a
  desired hint has no such source today, leave it out rather than inventing one.
- Additive only: every field `compileStepContext()` already returns keeps its existing
  shape and meaning; this task only adds new top-level fields.
- Update `docs/development/workflow-engine.md`'s `StepContext` example to include the
  new fields.

## Acceptance criteria

1. `StepContext.expectedWork.allowedPaths`/`forbiddenPaths` match the current task's
   real frontmatter values (sourced via the same mechanism the legacy context packet
   already uses, not duplicated). `automated: node --test tools/tests/workflow-next-step.test.mjs`
2. `StepContext.instructions` is present and derived structurally (verified by asserting
   its content changes deterministically with entry-blocker count/allowed-paths, not by
   asserting exact prose). `automated: node --test tools/tests/workflow-next-step.test.mjs`
3. `StepContext` includes a relevant-docs hint field populated from
   `tools/specs/context.mjs`'s existing routing-rule matching for the task's
   `allowed_paths`, empty/absent when that matching produces nothing (never fabricated).
   `automated: node --test tools/tests/workflow-next-step.test.mjs`
4. `StepContext.stepContract` reflects the current step's own configured
   `purpose`/`expectedWork`/`hints` (D25) when the workflow definition declares them for
   that step, and is absent (not a fabricated empty object) when the step declares none.
   `automated: node --test tools/tests/workflow-next-step.test.mjs`
5. Two steps in the same fixture definition with different `purpose`/`expectedWork`/
   `hints` produce correspondingly different `StepContext.stepContract` values —
   confirming the field reflects the *current* step's own configuration, not a
   definition-wide constant. `automated: node --test tools/tests/workflow-next-step.test.mjs`
6. All fields `compileStepContext()` returned before this task are unchanged in shape
   and value — regression-checked against the existing Task 06/08/10 `StepContext`
   assertions (including Task 10's `runtimeState`/`semanticStatus`, D37).
   `automated: node --test tools/tests/workflow-next-step.test.mjs`
7. `docs/development/workflow-engine.md`'s `StepContext` example reflects the new
   fields, including `stepContract`. `automated: node tools/docs.mjs check`

## Verification

```text
node --test tools/tests/workflow-next-step.test.mjs
node tools/docs.mjs check
```
