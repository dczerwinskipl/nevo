---
review-of: task
change: deterministic-workflow-foundation
task: fail-closed-workflow-definition-resolution
generated: 2026-09-10
verdict: pass
task_fingerprint: 3300d25509f5c7b991d28b3ecb29636432542daac6c82d0648f8fdebde041e43
---

# Review: deterministic-workflow-foundation/fail-closed-workflow-definition-resolution

## Verdict

`pass` — all 6 acceptance criteria are covered by real automated tests, scope is fully
compliant (including the D34/D35/D36 exact-file amendments), and no unresolved findings
remain after the corrective pass.

No reliable previous-file baseline is available. Performing a fresh review of the
current task implementation.

## Checklist

- [x] Acceptance criteria: 6/6
- [x] Scope: resolved
  - 3 owner-approved exact-file scope amendments recorded (D34, D35, D36)
- [x] Findings: none unresolved

## Verification

- `node --test tools/tests/workflow-next-step.test.mjs` — passed
- `node --test tools/tests/workflow-finish-operation.test.mjs` — passed
- `node --test tools/tests/workflow-cli.test.mjs` — passed
- `node --test tools/tests/workflow-e2e.test.mjs` — passed
- `node --test tools/tests/workflow-compatibility.test.mjs` — passed (72 tests)
- `node --test tools/tests/*.test.mjs` — passed (1266 tests, 0 failures)
- `node tools/specs.mjs validate` — passed
- `node tools/specs.mjs check` — passed

## Notes (corrective pass, 2026-09-10)

This review follows a targeted correction of the initial implementation revision
(`5127be7`): the repository-initialization templates under
`tools/specs/workflow/templates/` still contained the exact dead/unregistered action ids
(`implement-task`, `discover-scope`, `verify-task-output`) the runtime-definition fix
(D35) had already removed from `.nevo-ai/workflows/*.yaml` — a repository scaffolded from
any of these templates would have had an immediately invalid, unloadable workflow
definition under this task's own fail-closed `loadWorkflowDefinition` contract. Fixed by
applying the identical mechanical cleanup already proven correct for the runtime side
(remove the dead `actions:` entries; drop `standard`/`architectural`'s stale
`verify-task-output` finalize reference; preserve every valid gate/transition/
`commit-and-push` reference unchanged).

The pre-existing "every built-in initialization template validates under the corrected
schema" test called `parseWorkflowDefinition(content)` with no `knownActions` at all, so
it never actually exercised this task's own registry-aware contract and was silently
passing invalid templates. Replaced/extended with registry-aware coverage
(`workflow-compatibility.test.mjs`) proving: every corrected template validates against
the real `defaultActionRegistry.list()` vocabulary; reintroducing any of the three dead
action ids into a template fails that same validation with an explicit "unknown action"
error; and the runtime/template pair for the exploratory workflow both terminate at a
real `TERMINAL_STATUSES` value (pre-existing coverage from D33, re-confirmed).

Recorded as D36 (owner-approved), same reasoning as D33/D35: migration fallout directly
caused by this task's own intentionally stricter, correct contract, not unrelated scope
expansion — fixed in the same task rather than deferred as a dedicated follow-up, since a
template that is invalid the moment it is copied into a real repository defeats the
entire purpose of "initialization template."

## Acceptance-criteria coverage

- [x] All 6 acceptance criteria covered.

## Scope compliance

Touched paths (persisted `implementation.changed_paths`, matching the corrective
revision's live diff): `.nevo-ai/workflows/architectural.yaml`,
`.nevo-ai/workflows/exploratory.yaml`, `.nevo-ai/workflows/small.yaml`,
`.nevo-ai/workflows/standard.yaml`, `tools/specs/workflow/definitions/loader.mjs`,
`tools/specs/workflow/step-context.mjs`,
`tools/specs/workflow/templates/architectural.yaml`,
`tools/specs/workflow/templates/exploratory.yaml`,
`tools/specs/workflow/templates/small.yaml`,
`tools/specs/workflow/templates/standard.yaml`, `tools/tests/workflow-cli.test.mjs`,
`tools/tests/workflow-compatibility.test.mjs`, `tools/tests/workflow-e2e.test.mjs`,
`tools/tests/workflow-finish-operation.test.mjs`,
`tools/tests/workflow-next-step.test.mjs`.

Every path classifies `compliant` against Task 09's `allowed_paths`, as amended by D34
(one-file test-registration fix), D35 (the four runtime workflow definitions), and D36
(the four matching initialization templates plus the template regression test). No
`forbidden_paths` match. Three scope exceptions were needed and are all recorded as
approved owner decisions before the corresponding code was written, not after the fact.

## Architecture and documentation

No architecture/ADR documentation impact — this is fail-closed validation plumbing plus
shipped-content (YAML) and test corrections, consistent with the task's own stated scope
and D20's existing constraint (C20).

## Tests

All behavior changes (the tolerant-filter removal, the loader's registry-aware default,
the four runtime definitions' and four templates' content fixes) have corresponding,
passing automated tests, including explicit positive and negative coverage for the
registry-aware contract itself — see Verification and the corrective-pass notes above.
