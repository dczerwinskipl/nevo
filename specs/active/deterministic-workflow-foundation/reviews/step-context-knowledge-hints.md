---
review-of: task
change: deterministic-workflow-foundation
task: step-context-knowledge-hints
generated: 2026-09-11
verdict: pass
task_fingerprint: 1cbd780e4da83fb4c0ffd2bb0fec40dfb05eccd2d4090352d7b3217da1fa462d
---

# Review: deterministic-workflow-foundation/step-context-knowledge-hints

## Verdict

`pass` — all 7 acceptance criteria are covered by real automated tests, scope is strictly
compliant with `allowed_paths`, and no unresolved findings remain.

## Checklist

- [x] Acceptance criteria: 7/7
- [x] Scope: compliant
- [x] Findings: none unresolved

## Acceptance Criteria Coverage

1. **AC1 (`expectedWork` matches task frontmatter):** `resolveTaskScope()` extracts
   `allowedPaths` and `forbiddenPaths` from the task markdown file's frontmatter using
   the same mechanism as the legacy context packet (`resolveWithinBase`,
   `parseFrontMatterFile`), falling back cleanly to in-memory task properties when no file
   exists. Covered by tests `AC1: StepContext.expectedWork matches task frontmatter...` and
   `AC1 (in-memory): StepContext.expectedWork uses in-memory task allowedPaths...`.
2. **AC2 (structural `instructions`):** `deriveInstructions()` derives a concise summary
   reflecting entry-blocker count and paths in scope, changing deterministically without
   free-form AI text. Covered by test `AC2: StepContext.instructions is structurally derived...`.
3. **AC3 (routing-rule `relevantDocs` hints):** `resolveRelevantDocs()` matches `allowedPaths`
   against `docs/routing.generated.json` via `tools/specs/context.mjs`'s `pathGlobsOverlap`.
   Surfaces structured entries (`ruleId`, `docRef`, `pathGlob`) and returns empty when no
   rules match (never fabricated). Covered by tests `AC3: StepContext.relevantDocs is populated...`
   and `AC3 (pure): relevantDocs matches via custom routingIndex...`.
4. **AC4 (`stepContract` reflects step configuration):** `buildStepContract()` extracts
   whichever of `purpose`, `expectedWork`, and `hints` (D25) the workflow definition declares
   for the step; omitted (absent from `StepContext`) when the step declares none. Covered by
   test `AC4: StepContext.stepContract reflects configured purpose/expectedWork/hints...`.
5. **AC5 (step-specific `stepContract`):** Two steps (`implementation` and `review`) in the
   same fixture definition produce different `StepContext.stepContract` payloads corresponding
   to the task's current step. Covered by test `AC5: Two steps in the same fixture definition...`.
6. **AC6 (pre-existing field regression check):** All fields `compileStepContext()` previously
   returned (`change`, `task`, `workflowMode`, `currentStep`, `stepStatus`, `runtimeState`,
   `semanticStatus`, `entryState`, `context`, `finishContract`, `nextStepGuidance`) maintain
   their exact shape and values. Covered by test `AC6: All pre-existing fields keep exact shape...`.
7. **AC7 (documentation update):** `docs/development/workflow-engine.md`'s `StepContext`
   example and documentation reflect the new fields (`instructions`, `expectedWork`,
   `relevantDocs`, and `stepContract`). Verified by `node tools/docs.mjs check`.

## Verification

- `node --test tools/tests/workflow-next-step.test.mjs` — passed (56 tests)
- `node tools/docs.mjs check` — passed (74 documents, indexes current)
- `node tools/specs.mjs check` — passed (23 changes, indexes current)
- `node --test tools/tests/*.test.mjs` — passed (1294 tests, 0 failures)

## Scope Compliance

Modified files (all strictly within `allowed_paths`):
- `tools/specs/workflow/step-context.mjs`
- `tools/tests/workflow-next-step.test.mjs`
- `docs/development/workflow-engine.md`

`forbidden_paths` strictly respected:
- `src/**`: untouched
- `tests/NEvo.*/**`: untouched
- `tools/dashboard/**`: untouched
- `tools/specs/context.mjs`: read only, never modified
