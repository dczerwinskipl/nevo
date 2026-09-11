---
review-of: task
change: deterministic-workflow-foundation
task: step-active-completed-lifecycle
generated: 2026-09-11
verdict: pass
task_fingerprint: c43e5fa80380647192ae1cf9a8925a2a01ee4e6d1d29697e23184106f6b3d762
---

# Review: deterministic-workflow-foundation/step-active-completed-lifecycle

## Verdict

`pass` — all 19 acceptance criteria (17 original + 2 added by the corrective revision)
are covered by real automated tests, scope is fully compliant, and no unresolved
findings remain.

## Baseline

The prior review (`2026-09-11`, this same file, verdict `pass`) is the baseline. An
owner review conducted independently of `/nevo-ai:task-review` — direct code inspection,
not this mechanism's own re-review pass — found four real correctness gaps the prior
pass missed. All four are fixed in the corrective revision (commit `408a117`, self-check
refreshed at `c9a9b6b`) and are treated here as newly-verified, not as carried-forward
findings, since they were never entries in this file's own findings list to begin with.

## Corrective findings — verified fixed

1. **P1 (activation race with an unsettled finish operation).** `step start`'s case-C
   activation (`completed` A → `active` B) previously consulted only
   `workflow_progress`, never whether A's own durable finish operation had actually
   settled — a crash between `update-task` (persists `state: 'completed'`) and
   `commit`/`push`/`transition` would let `step start` silently activate B while A's
   finish was unresolved. **Fixed:** `ensureStepActivated` (`step-context.mjs`) now
   checks the just-completed step's own operation record before activating; if it
   exists and isn't `completed`, it throws (`WorkflowError`,
   `code: 'FINISH_OPERATION_UNRESOLVED'`) — it never resumes commit/push itself, only
   guards activation. Verified by the exact crash-window regression named in the owner's
   review (`workflow-finish-operation.test.mjs`, "P1 (D37 corrective revision)"): active
   → operation with `update-task` completed / commit pending → `step start` refused,
   `change.yaml` byte-identical → retry `step finish` settles the operation → subsequent
   `step start` activates B. The operation-record persistence/query functions were
   extracted from `finish-operation.mjs` into a new, narrowly-scoped
   `operation-record.mjs` (no architectural cycle: `step-context.mjs` reads it directly;
   `finish-operation.mjs` re-exports the same functions unchanged for every existing
   caller).
2. **AC7 (repeated-finish response shape).** A repeated `workflow step finish` against
   an already-completed step now returns `status: 'already-completed'` — distinct from
   the `'completed'` a first-time success returns — instead of the ambiguous,
   identically-shaped `'completed'` both cases previously returned. Verified in
   `workflow-finish-operation.test.mjs`'s multi-hop test, `workflow-cli.test.mjs`'s
   sequence test, and `workflow-e2e.test.mjs`'s Scenario H1 — all now assert the exact
   status string, not just the absence of side effects (as the owner's review
   specifically required).
3. **AC10 (distinct semantic statuses).** `definitions/schema.mjs` now rejects a step
   whose `status.active`/`status.completed` are equal, in addition to the pre-existing
   safe-identifier/non-empty checks. Verified by a new negative schema regression test.
4. **Fail-closed on invalid persisted `state`.** `resolveWorkflowPosition` previously
   treated any `state` value other than `'completed'` as `'active'`; it now accepts
   exactly `'active'`/`'completed'` and throws `INVALID_WORKFLOW_PROGRESS_STATE` on
   anything else (missing, empty, misspelled), independent of whether
   `node tools/specs.mjs validate` already ran. Verified both as a direct resolver test
   (five invalid values) and as a CLI-path test against a hand-crafted `change.yaml`
   (`workflow step start`/`step finish --check` both reject it).

## Checklist

- [x] Acceptance criteria: 19/19
- [x] Scope: compliant
- [x] Findings: none unresolved

## Verification

- `node --test tools/tests/workflow-next-step.test.mjs` — passed (48 tests)
- `node --test tools/tests/workflow-finish-operation.test.mjs` — passed (19 tests)
- `node --test tools/tests/workflow-cli.test.mjs` — passed (16 tests)
- `node --test tools/tests/workflow-e2e.test.mjs` — passed (11 tests)
- `node --test tools/tests/store.test.mjs` — passed (5 tests)
- `node --test tools/tests/workflow-compatibility.test.mjs` — passed (73 tests)
- `node --test tools/tests/*.test.mjs` — passed (1286 tests, 0 failures)
- `node tools/specs.mjs validate` — passed
- `node tools/specs.mjs check` — passed
- `node tools/docs.mjs validate` — passed
- `node tools/docs.mjs check` — passed

## Scope compliance

Touched paths (live diff since baseline `80e76e5`): the 23 files already covered by the
prior review's scope-compliant list, plus the new `tools/specs/workflow/operation-record.mjs`
(extracted per the owner's explicit instruction to avoid a circular import — the task's
own `allowed_paths`/`context.required` were updated to name it, matching the D33-D36
precedent of a task recording its own narrow scope amendments in place). No
`forbidden_paths` match — `gates/**`, `actions/**`, `contracts.mjs`, `registry.mjs`,
`engine.mjs`, `errors.mjs` (the new error surfaced via `WorkflowError`'s existing
`details`/`code` fields, not a new error class), `compatibility.mjs`,
`human-verification-store.mjs`, and `definitions/loader.mjs` are all untouched.
`change.yaml`, this review file, the task file's own corrective note, and
`specs/index.generated.json` are the expected self-referential/generated artifacts, not
scope violations.

## Architecture and documentation

`docs/development/workflow-engine.md` updated: the repeated-finish paragraph now states
the exact `already-completed` status string, and the "Multi-step position" section
gained an explicit "Activation guard" bullet describing the P1 fix. `node tools/docs.mjs check` passes.

The task file itself records a corrective-revision note (owner review, 2026-09-11)
summarizing all four fixes and adds AC18 (activation guard)/AC19 (fail-closed state) —
AC7 and AC10's original wording already specified the correct behavior; only the
implementation and its tests were gapped, now closed.

## Tests

Every corrective fix has direct, passing automated coverage — see the four numbered
items above and Verification. No unresolved finding remains.
