---
review-of: task
change: deterministic-workflow-foundation
task: step-active-completed-lifecycle
generated: 2026-09-11
verdict: pass
task_fingerprint: d1f6043f005c7414d3aa922642fb99a936614eb9357463f8e9de2afeccec7776
---

# Review: deterministic-workflow-foundation/step-active-completed-lifecycle

## Verdict

`pass` — all 17 acceptance criteria are covered by real automated tests, scope is fully
compliant, and no unresolved findings remain.

No reliable previous-file baseline is available. Performing a fresh review of the
current task implementation.

## Checklist

- [x] Acceptance criteria: 17/17
- [x] Scope: compliant
- [x] Findings: none unresolved

## Verification

- `node --test tools/tests/workflow-next-step.test.mjs` — passed (44 tests)
- `node --test tools/tests/workflow-finish-operation.test.mjs` — passed (18 tests)
- `node --test tools/tests/workflow-cli.test.mjs` — passed (14 tests)
- `node --test tools/tests/workflow-e2e.test.mjs` — passed (11 tests)
- `node --test tools/tests/store.test.mjs` — passed (5 tests)
- `node --test tools/tests/workflow-compatibility.test.mjs` — passed (73 tests)
- `node --test tools/tests/*.test.mjs` — passed (1279 tests, 0 failures)
- `node tools/specs.mjs validate` — passed
- `node tools/specs.mjs check` — passed
- `node tools/docs.mjs validate` — passed
- `node tools/docs.mjs check` — passed

## Acceptance-criteria coverage

All 17 acceptance criteria covered — mapped against `resolveWorkflowPosition`/
`resolveActiveStepName`/`resolveSemanticStatus` (`step-runner.mjs`),
`ensureStepActivated`/`compileStepContext` (`step-context.mjs`), `ensureUpdateTask`'s
`{fromState:'active', toState:'completed'}` reconciliation (`finish-operation.mjs`), the
required per-step `status` schema (`definitions/schema.mjs`), and the CLI-driven
multi-step sequence test (`workflow-cli.test.mjs`).

One informational note, not a finding: AC1 and AC13 name a specific `automated:` test
file each, but the exact StepContext/`runtimeState`/`semanticStatus` combination they
describe is exercised end-to-end in `workflow-cli.test.mjs`'s sequence test rather than
`workflow-next-step.test.mjs`/`workflow-e2e.test.mjs` as literally cited — the underlying
behavior is genuinely covered (confirmed by inspection), Task 10's own `## Verification`
block already runs every one of these files together as one combined gate, and no gap in
actual coverage exists.

## Scope compliance

Touched paths (live diff since baseline `80e76e5`, matching `implementation.changed_paths`):
`.nevo-ai/workflows/architectural.yaml`, `.nevo-ai/workflows/exploratory.yaml`,
`.nevo-ai/workflows/small.yaml`, `.nevo-ai/workflows/standard.yaml`,
`docs/development/workflow-engine.md`, `tools/specs/store.mjs`,
`tools/specs/validation.mjs`, `tools/specs/workflow/cli.mjs`,
`tools/specs/workflow/definitions/schema.mjs`,
`tools/specs/workflow/finish-operation.mjs`, `tools/specs/workflow/index.mjs`,
`tools/specs/workflow/step-context.mjs`, `tools/specs/workflow/step-runner.mjs`,
`tools/specs/workflow/templates/architectural.yaml`,
`tools/specs/workflow/templates/exploratory.yaml`,
`tools/specs/workflow/templates/small.yaml`,
`tools/specs/workflow/templates/standard.yaml`, `tools/tests/workflow-cli.test.mjs`,
`tools/tests/workflow-compatibility.test.mjs`, `tools/tests/workflow-e2e.test.mjs`,
`tools/tests/workflow-finish-operation.test.mjs`, `tools/tests/workflow-next-step.test.mjs`.

Every path classifies `compliant` against this task's own `allowed_paths`. No
`forbidden_paths` match — `gates/**`, `actions/**`, `contracts.mjs`, `registry.mjs`,
`engine.mjs`, `errors.mjs`, `compatibility.mjs`, `human-verification-store.mjs`, and
`definitions/loader.mjs` are all untouched, and `.nevo-ai/workflows/**` changes are
confined to the exact four files the migration names (mechanical `status:` block
additions only — no gate/transition/step-shape changes). No scope exceptions were
needed.

## Architecture and documentation

`docs/development/workflow-engine.md` updated: the `StepContext` example now includes
`runtimeState`/`semanticStatus`, the stale `resolveCurrentStepName` reference and the
already-obsolete `verify-task-output` filtering note are corrected, and a new "Multi-step
position" section documents the `step start`-activates/`step finish`-only-completes
model. `node tools/docs.mjs check` passes (routing/link integrity unaffected).

D37 (`owner-decisions.md`) is the governing decision; this task implements it without
further architectural deviation. No other ADR/architecture-doc impact.

## Tests

Every behavior change has corresponding, passing automated coverage: the four `step
start` cases (fresh/resume/activate-next/terminal), `step finish`'s corrected
internal-transition write, completed-step-retry non-actionability, the generalized
crash-reconciliation intent (all three outcomes: safe-to-redo/already-done/unknown), the
required per-step `status` schema (missing/invalid/valid), step-specific semantic-status
resolution across two distinct steps, the four-file shipped-definition migration
(including the exploratory `discovery`-not-`implementation` correction), and a full
CLI-driven multi-step sequence (`new -> active(A) -> completed(A) -> active(B) ->
completed(B) -> terminal`) — see Verification above for the full suite.
