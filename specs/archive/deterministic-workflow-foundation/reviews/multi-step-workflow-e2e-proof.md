---
review-of: task
change: deterministic-workflow-foundation
task: multi-step-workflow-e2e-proof
generated: 2026-09-11
verdict: pass
task_fingerprint: 768d38741dbad9655b5a4d41094fbb19cfc80f9ec475a8804261eaab56723fdc
---

# Review: deterministic-workflow-foundation/multi-step-workflow-e2e-proof

## Verdict

`pass` — all 14 acceptance criteria are fully satisfied by automated tests in `tools/tests/workflow-multi-step-e2e.test.mjs`, scope is strictly compliant with `allowed_paths` (tests and docs only; zero engine production code changed), full test suite passes with 1331/1331 tests passing, and no engine defects were discovered.

## Checklist

- [x] Acceptance criteria: 14/14
- [x] Scope: compliant (tests and docs only, no workflow engine production changes)
- [x] Findings: none unresolved

## Acceptance Criteria Coverage

1. **AC1 (`workflow step start` resolves step A on fresh task):** Tested against `primary-3step` fixture. Step start resolves `entryStep` (`step-a`), persisting `current_step: 'step-a', state: 'active'` (D37 case A), returning `runtimeState: 'active'`, `semanticStatus: 'authoring'`, `nextStepGuidance: { onSuccess: 'step-b' }`.
2. **AC2 (Active/completed checkpoint — D37):** Finishing A persists `current_step: 'step-a', state: 'completed'` in the same commit, with history recording `transitioned_to: 'step-b'`. Repeated `step start` before finish resumes without mutation (case B). Repeated `step finish` after completion returns `status: 'already-completed'` without re-running finalize. Only the next `step start` activates B (`current_step: 'step-b', state: 'active'`, no new history entry).
3. **AC3 (Gate isolation between steps):** Verified via a dedicated fixture where Step 2 has a failing command gate (`process.exit(1)`). Finishing Step 1 succeeds cleanly without being affected by Step 2's failing gate. Step 2 fails closed once activated.
4. **AC4 (Finishing B moves progress to C):** Finishing Step B records `current_step: 'step-b', state: 'completed'` with history entry `transitioned_to: 'step-c'`. Next `step start` activates Step C (`current_step: 'step-c', state: 'active'`).
5. **AC5 (Step C gated by `HumanVerificationGate`):** Step C has exit gate with `type: 'human'`, `required: true`, `id: 'owner-signoff'`. Step finish against C reports `status: 'blocked'` and mutates nothing. `workflow verify-human --confirm` satisfies the gate, allowing subsequent finish to complete C.
6. **AC6 (Terminal precedence, driven via CLI — D28, D37):** Finishing C reaches terminal transition (`to: 'verified'`). Atomically writes `task.status: 'verified'`, `workflow_progress.state = 'completed'`, and leaves `current_step: 'step-c'` populated (never cleared/nulled). Subsequent `workflow step start` reports workflow complete (`stepStatus: 'complete'`, `runtimeState: 'completed'`, `currentStep: null`), never re-resolving `entryStep`, and never consulting `task.status`. Repeated finish returns `already-completed`.
7. **AC7 (Step-level retry/resume and crash reconciliation):** An interruption crafted during Step B's finalize (in-flight finish-operation record) leaves Step A's already-committed progress and operation record (`step-a.json`) completely unaffected. Resuming Step B completes without duplicating Step A's side effects or repeating Step A's commit.
8. **AC8 (Strict CLI-only progression):** All transitions and steps are driven exclusively through `handleWorkflowStepStart`, `handleWorkflowStepFinish`, and `handleWorkflowVerifyHuman` with `{ activeDir, repoRoot }` against isolated fixture repos. No test hand-edits `change.yaml`/task files or calls internal gate/action APIs directly.
9. **AC9 (Second, differently-shaped fixture definition):** Tested against `custom-4step-pipeline` (`intake` -> `analysis` -> `execution` -> `signoff` -> `verified`). All 4 steps progress through the identical CLI code path with distinct step names, step count, and semantic statuses, proving that the engine is generic and has no hardcoded Standard-specific sequencing.
10. **AC10 (Step-aware operation identity — D23):** After Step A finishes, Step B's finish executes B's own finalize sequence, creating a distinct commit (`commitB !== commitA`) and persisting its own operation record (`step-b.json`) rather than returning A's cached completed result.
11. **AC11 (Step/gate-scoped human verification — D24):** Tested on a fixture with human gates on both `review-step` and `approval-step`. Confirming the human gate on `review-step` does not satisfy the gate on `approval-step`.
12. **AC12 (Safe, unique identifiers — D30):** Fixtures use valid `^[a-zA-Z0-9_-]+$` identifiers. Steps with multiple human gates require explicit, distinct IDs; `verify-human --gate <id>` confirms each gate independently; calling without `--gate` fails closed with disambiguation error. Schema validation rejects invalid step identifiers and colliding human gate IDs.
13. **AC13 (Fail-closed version compatibility — D26):** Fixture change declaring `workflow.version: 2` against definition with `version: 1` fails `handleWorkflowStepStart` and `handleWorkflowStepFinish` closed with `WorkflowDefinitionError` naming both versions.
14. **AC14 (Full repository test suite):** 1331/1331 tests pass with zero failures (`node --test tools/tests/*.test.mjs`).

## Verification

- `node --test tools/tests/workflow-multi-step-e2e.test.mjs` — passed (23 tests across 8 suites)
- `node --test tools/tests/*.test.mjs` — passed (1331 tests across 266 suites, 0 failures)
- `node tools/specs.mjs check` — passed (23 changes, indexes current)
- `node tools/docs.mjs check` — passed (74 documents, indexes current)
- `node tools/specs.mjs self-check deterministic-workflow-foundation multi-step-workflow-e2e-proof` — passed

## Scope Compliance

`allowed_paths` strictly followed:
- `tools/tests/workflow-multi-step-e2e.test.mjs` (created, 23 comprehensive E2E tests)
- `docs/development/workflow-engine.md` (updated CLI surface testing reference)

`forbidden_paths` strictly respected:
- `tools/specs/workflow/**`: untouched (zero engine changes)
- `tools/specs.mjs`: untouched
- `.nevo-ai/workflows/**`: untouched
- `src/**`: untouched
- `tests/NEvo.*/**`: untouched
- `tools/dashboard/**`: untouched
