---
review-of: task
change: deterministic-workflow-foundation
task: multi-step-workflow-progression
generated: 2026-09-09
verdict: pass
task_fingerprint: 629e1050723de4a5a087f708bfb9513ca55394669c338881802c05bb0368ca09
---

# Review: deterministic-workflow-foundation/multi-step-workflow-progression

## Verdict

`pass` — all 20 acceptance criteria are covered by real automated tests, scope is
fully compliant, and no unresolved findings remain after the corrective pass.

No reliable previous-file baseline is available. Performing a fresh review of the
current task implementation.

## Checklist

- [x] Acceptance criteria: 20/20
- [x] Scope: compliant
- [x] Findings: none unresolved

## Verification

- `node --test tools/tests/workflow-next-step.test.mjs` — passed (28 tests)
- `node --test tools/tests/workflow-finish-operation.test.mjs` — passed (18 tests)
- `node --test tools/tests/workflow-cli.test.mjs` — passed (13 tests)
- `node --test tools/tests/workflow-gates.test.mjs` — passed (30 tests)
- `node --test tools/tests/store.test.mjs` — passed (5 tests)
- `node --test tools/tests/*.test.mjs` — passed (1259 tests, 0 failures)
- `node tools/specs.mjs validate` — passed
- `node tools/specs.mjs check` — passed

## Notes (corrective pass, 2026-09-09)

This review follows a targeted correction of five concrete defects/gaps found in the
prior implementation revision (`d88cd0d`), each fixed with real regression coverage
rather than a narrative claim of coverage:

1. First-step internal-transition crash recovery (`finish-operation.mjs`'s
   `ensureUpdateTask`) compared the raw `task.workflow_progress?.current_step` against
   `intent.fromStep` instead of the *effective* position `resolveCurrentStepName` would
   report — misclassifying a crash on a task's very first internal transition (no
   `workflow_progress` yet) as an unrelated/ambiguous state instead of "never
   happened, safe to redo." Fixed to reconcile against `resolveCurrentStepName`; added a
   3-test suite in `workflow-finish-operation.test.mjs` covering the exact crash window,
   the already-advanced-to-toStep case, and the unrelated-position case.
2. Task 08's own `workflow_progress` validation contract (AC1/AC19) did not exist in
   `tools/specs/validation.mjs`'s `validateSpecs()` — the function `node tools/specs.mjs
   validate` actually calls. Added `validateWorkflowProgress`, wired into `validateSpecs`'s
   per-task loop (never a parallel entry point), plus a directory-injection seam
   (`validateSpecs({ activeDir, archiveDir })`, backward-compatible default) enabling a
   true end-to-end fixture-repository test alongside 8 focused unit tests, all in
   `workflow-compatibility.test.mjs`.
3. `workflow verify-human --confirm` persisted `role: 'owner'` unconditionally instead of
   the gate's own configured `role`, making a configured non-owner gate (e.g.
   `reviewer`) permanently unsatisfiable. Fixed in `cli.mjs`; added a CLI regression test
   with a `role: reviewer` gate proving the persisted signoff and subsequent
   `step start` both see the correct role.
4. D25's `expectedWork` contract allowed `expectedWork: {}` to validate (the `summary`
   check only fired when `summary` was present, not whenever `expectedWork` was declared
   at all). Fixed in `definitions/schema.mjs`; added the missing negative test plus full
   D25 coverage (8 tests) in `workflow-next-step.test.mjs`.
5. `tools/tests/store.test.mjs` (declared by AC18) did not exist. Added, covering
   `setTaskWorkflowState`'s atomic both-fields write, status-only/workflowProgress-only
   independence, the neither-supplied error, and an unknown-task-id error.

A full AC1-AC20 audit against actual automated tests (not just AC-label text matching,
since several already-existing "AC1"/"AC5" test labels in these shared files belong to
earlier tasks' own numbering) surfaced further genuine gaps beyond the five reported
findings, closed in the same pass:

- AC2 (multi-step entry-step/current-step resolution) and AC5 (terminal precedence
  across a multi-hop sequence) were previously only exercised against single-step
  fixtures. Added a real ≥2-step `resolveCurrentStepName` suite
  (`workflow-next-step.test.mjs`) and a full `stepA -> stepB -> stepC -> verified`
  end-to-end `finishStep` sequence (`workflow-finish-operation.test.mjs`) proving AC2,
  AC3, AC4, AC5, AC7 (one commit per hop), and AC8 (distinct per-step operation
  records, untouched after the fact) together.
- AC9 (extended human-verification query contract) had no test asserting the actual
  query object `HumanVerificationGate` builds. Added a spy-reader test in
  `workflow-gates.test.mjs` asserting `changeId`/`taskId`/`stepId`/`gateId` are passed
  alongside `scope`/`targetId`/`requiredRole`, plus a null-when-absent test and an
  additive-compatibility test against the pre-existing `MemoryHumanVerificationReader`.
- AC10's cross-step half (confirming step A's gate must never satisfy an
  independently-configured step B gate) was untested — only same-step multi-gate
  disambiguation was covered. Added a CLI-level cross-step isolation test.
- AC12 (safe identifiers), AC14 (transition cardinality), AC15 (entryStep), AC16 (step
  name colliding with a terminal status), and AC17 (D19-refined terminal-target
  correctness) had zero direct tests despite being enforced in `schema.mjs` — the
  behavior was real, but unverified. Added a 15-test schema-validation suite in
  `workflow-compatibility.test.mjs` covering all five.
- AC13 (fail-closed effective workflow-definition version compatibility) had zero
  tests. Added CLI-level tests for the mismatch (naming both versions, on both `step
  start` and `step finish`), the matching case, and the `workflow_mode: deterministic`
  shorthand's defaulted-version-1 comparison.

One test-authoring bug was found and fixed while writing the new multi-hop test: the
first draft reused one static, hand-built `task` object across three sequential
`finishStep` calls, silently masking the real behavior (since `findInFlightOperationRecord`
sidesteps `resolveCurrentStepName` whenever a craft, in-flight record exists — the
earlier per-crash-window tests never re-fetch the task either, but never needed to). The
corrected test re-fetches the task fresh via `requireTask(requireChange(...))` before
each call, mirroring exactly how the real CLI's `resolveWorkflowRuntime` reloads the
task on every invocation.

## Acceptance-criteria coverage

- [x] All 20 acceptance criteria covered.

## Scope compliance

Touched paths (union of live diff and persisted `implementation.changed_paths`):
`.nevo-ai/workflows/exploratory.yaml`, `tools/specs/store.mjs`,
`tools/specs/validation.mjs`, `tools/specs/workflow/cli.mjs`,
`tools/specs/workflow/compatibility.mjs`, `tools/specs/workflow/definitions/schema.mjs`,
`tools/specs/workflow/finish-operation.mjs`, `tools/specs/workflow/gates/human-gate.mjs`,
`tools/specs/workflow/human-verification-store.mjs`,
`tools/specs/workflow/step-context.mjs`, `tools/specs/workflow/step-runner.mjs`,
`tools/specs/workflow/templates/exploratory.yaml`, `tools/tests/store.test.mjs`,
`tools/tests/workflow-cli.test.mjs`, `tools/tests/workflow-compatibility.test.mjs`,
`tools/tests/workflow-e2e.test.mjs`, `tools/tests/workflow-finish-operation.test.mjs`,
`tools/tests/workflow-gates.test.mjs`, `tools/tests/workflow-next-step.test.mjs`,
`specs/active/deterministic-workflow-foundation/change.yaml`,
`specs/index.generated.json`.

Every path classifies `compliant` against Task 08's `allowed_paths` (amended by D33 to
add the three exact-file exceptions for the exploratory-workflow migration fallout).
None match `forbidden_paths`. No scope exception needed.

## Architecture and documentation

No architecture/ADR documentation impact — this is internal workflow-engine plumbing
plus test coverage, consistent with the task's own stated scope.

## Tests

All behavior changes (crash-window fix, validation rule, role propagation fix, schema
fix, plus the coverage-audit additions) have corresponding, passing automated tests —
see Verification and the corrective-pass notes above.
