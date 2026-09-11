---
review-of: task
change: deterministic-workflow-foundation
task: step-context-knowledge-hints
generated: 2026-09-11
verdict: pass
task_fingerprint: 0ace8b373149b3cd1cab8c145195b488c10c069f1e7aebc34db0e7b2da2cdb88
---

# Review: deterministic-workflow-foundation/step-context-knowledge-hints

## Verdict

`pass` — all 7 acceptance criteria plus D38 single-source-of-truth routing/scope integration are
covered by real automated tests, scope is strictly compliant with amended `allowed_paths` (D38),
and no unresolved findings remain.

## Checklist

- [x] Acceptance criteria: 7/7 + D38
- [x] Scope: compliant (D38 amendment: `tools/specs/context.mjs` allowed)
- [x] Findings: none unresolved

## Acceptance Criteria Coverage

1. **AC1 (`expectedWork` matches task frontmatter):** `resolveTaskScope()` (shared with
   `tools/specs/context.mjs`, D38) extracts `allowedPaths` and `forbiddenPaths` from the task
   markdown file's frontmatter using `loadTaskFrontMatter()`, falling back cleanly to in-memory task
   properties when no file exists. Covered by tests `AC1: StepContext.expectedWork matches task frontmatter...`
   and `AC1 (in-memory): StepContext.expectedWork uses in-memory task allowedPaths...`.
2. **AC2 (structural `instructions`):** `deriveInstructions()` derives a concise summary
   reflecting entry-blocker count and paths in scope, changing deterministically without
   free-form AI text. Covered by test `AC2: StepContext.instructions is structurally derived...`.
3. **AC3 (routing-rule `relevantDocs` hints & D38 single owner):** `resolveRelevantDocs()` delegates
   to `matchRoutingRules()` from `tools/specs/context.mjs` (D38 single owner), projecting matched
   rules into structured entries (`ruleId`, `docRef`, `pathGlob`) and returning empty when no
   rules match (never fabricated). Covered by tests `AC3: StepContext.relevantDocs is populated...`,
   `AC3 (pure): relevantDocs matches via custom routingIndex...`, and D38 divergence regression tests.
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
8. **D38 (Single-source-of-truth routing and scope resolution):** Regression tests prove:
   - `buildContextPacket` and `compileStepContext` share `resolveTaskScope` with zero divergence.
   - `computeRoutingWarnings` and `compileStepContext` share `matchRoutingRules` with zero divergence.
   - Architectural boundary: `step-context.mjs` delegates to `context.mjs` and owns no duplicate glob/frontmatter code.

## Verification

- `node --test tools/tests/workflow-next-step.test.mjs` — passed (59 tests)
- `node tools/docs.mjs check` — passed (74 documents, indexes current)
- `node tools/specs.mjs check` — passed (23 changes, indexes current)
- `node --test tools/tests/*.test.mjs` — passed (1297 tests, 0 failures)

## Scope Compliance

Modified files (all strictly within amended `allowed_paths` per D38):
- `specs/active/deterministic-workflow-foundation/owner-decisions.md` (D38 recorded)
- `specs/active/deterministic-workflow-foundation/tasks/12-step-context-knowledge-hints.md` (scope amendment)
- `tools/specs/context.mjs` (shared pure helpers: `matchRoutingRules`, `loadTaskFrontMatter`, `resolveTaskScope`)
- `tools/specs/workflow/step-context.mjs` (delegation to shared helpers)
- `tools/tests/workflow-next-step.test.mjs` (regression coverage)
- `docs/development/workflow-engine.md` (documentation update)

`forbidden_paths` strictly respected:
- `src/**`: untouched
- `tests/NEvo.*/**`: untouched
- `tools/dashboard/**`: untouched
