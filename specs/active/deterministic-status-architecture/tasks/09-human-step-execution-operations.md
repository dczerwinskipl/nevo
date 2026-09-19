---
id: deterministic-status-architecture.human-step-execution-operations
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/step-executor-model.md
    - specs/active/deterministic-status-architecture/owner-decisions.md
allowed_paths:
  - tools/specs/workflow/human-step/**
  - tools/specs/workflow/cli.mjs
  - tools/tests/human-step-execution-operations.test.mjs
forbidden_paths:
  - tools/specs/approve/**
  - tools/specs/start/**
  - tools/specs/complete/**
  - tools/specs/verify/**
  - tools/specs/lifecycle-primitives.mjs
  - tools/dashboard/**
  - src/**
depends_on: [ workflow-definition-schema-extensions, step-executor-guard, deterministic-mutation-guard ]
semantic_references:
  decisions: [D12]
---

# Task: Human-step execution operations

## Goal

Build `startHumanStep`/`submitHumanStepResult` (D11, D12) — the legal activation and
generic-result-submission path for a human-owned step — as thin, executor-gated wrappers
over the engine's existing, unmodified `ensureStepActivated`/`finishStep`, replacing
`handleWorkflowVerifyHuman`'s `--approve`/`--request-changes` branch's hardcoded
`'human-verification'` step-name check and `pass`/`fail` mapping.

## Dependencies

`workflow-definition-schema-extensions` — reads `executor` to gate both operations.
`step-executor-guard` — reuses its exported guard function for the reverse
(reject-agent-owned-step) direction; does not reimplement it. `deterministic-mutation-guard`
— that task explicitly scoped itself to only `handleWorkflowStepStart`/
`handleWorkflowStepFinish` and deferred the mode guard for the human-step surface to this
task (its own "Out of scope" names this task explicitly) — this task's two new operations
must call `resolveWorkflowMode()` themselves, reusing that task's established pattern, not
skip it.

## Implementation constraints

- New module (e.g. `tools/specs/workflow/human-step/operations.mjs`) exposing:
  - `startHumanStep(change, task, definition, context)`: calls `resolveWorkflowMode()`
    first and fails, before any mutation, if the spec resolves to legacy (same guard
    pattern as `deterministic-mutation-guard`, reused not reimplemented); resolves the
    target step exactly as `handleWorkflowVerifyHuman` already does today (active→current,
    completed→next, new→entryStep); calls the executor-guard function from
    `step-executor-guard`, rejecting unless `executor === 'human'`; on success, calls
    `ensureStepActivated` directly (same function, same behavior, same clean-worktree/
    finish-operation-settled preconditions — D13, unmodified) and returns its result. Does
    **not** call `autoBindAgentSession` — no AI execution session is created or bound.
  - `submitHumanStepResult(change, task, definition, context, { result, feedback,
    artifacts })`: same mode guard first; resolves the currently active step; calls the
    executor-guard function, rejecting unless `executor === 'human'`. `result` is required
    only when the active step's own transitions are conditional (more than one, or a single
    transition declaring `value`) — omit it for a single unconditional transition, never
    fabricate one (D16, item 7); reject a call that supplies `result` for an unconditional
    step before calling `finishStep` (which would reject it anyway via
    `UNEXPECTED_TRANSITION_RESULT`, but this operation fails the same way for the same
    reason, not a silently different error). **Resolves the selected transition itself**
    (conditional: the one whose `value === result`; unconditional: the sole transition) and,
    when that transition's `action.feedback.required` is `true`, rejects a missing/blank
    `feedback` **before calling `finishStep`, before any mutation** (item 3 — this is the
    one authoritative server/domain validation path for this requirement; `HumanStepSurface`
    must not be relied on to enforce it, and this check is not folded into
    `buildFinishContract`, which stays UI-metadata-agnostic so agent `workflow step finish`
    never depends on `action.label`/`action.feedback`). Once resolved, calls `finishStep`
    directly with the caller's `{ result, feedback, artifacts }` — unmodified, same
    validation, same finalize stage sequence agent steps already use; this operation's own
    transition lookup is for the feedback-requirement check only, not a second, duplicate
    copy of `finishStep`'s own result-matching logic.
  - Neither function reimplements `ensureStepActivated`'s or `finishStep`'s own logic —
    they call them, unchanged, as already exported by `step-context.mjs`/
    `finish-operation.mjs`.
- Rewire `handleWorkflowVerifyHuman`'s `--approve`/`--request-changes` branch
  (`tools/specs/workflow/cli.mjs`) to call these two operations instead of its own inline
  `ensureStepActivated`/`finishStep` calls and literal `'human-verification'` check:
  `--approve`/`--request-changes` become CLI-level compatibility sugar translating to
  `submitHumanStepResult(..., { result: 'pass'/'fail', feedback })` — the domain operation
  itself never hardcodes "approve"/"pass" as its own concept, only validates `result`
  against the active step's declared transitions (via `finishStep`, unchanged). If the step
  is not yet active when `--approve`/`--request-changes` is invoked, the CLI still
  auto-activates via `startHumanStep` first (preserving today's one-call ergonomics) before
  calling `submitHumanStepResult` — both calls go through the same executor guard.
- `workflow verify-human --confirm` (the separate `entryGates`/`exitGates` gate-confirmation
  branch, `FileHumanVerificationStore.confirm`) is completely untouched — different code
  path, not modified by this task.
- Do not import `tools/specs/lifecycle-primitives.mjs` or any legacy mutation module.

## Acceptance criteria

- `startHumanStep`/`submitHumanStepResult` against a legacy spec each fail with a clear,
  legacy-aware error via `resolveWorkflowMode()`, before any mutation — matching the
  established mode-guard pattern.
  `automated: node --test tools/tests/human-step-execution-operations.test.mjs`
- `startHumanStep` against a step with `executor: human` succeeds, activates via
  `ensureStepActivated` (verified via its actual `workflow_progress` write), and does not
  create/bind an AI execution session. `automated: node --test tools/tests/human-step-execution-operations.test.mjs`
- `startHumanStep` against a step with `executor: agent` fails with the structured
  executor-mismatch error, before any mutation.
  `automated: node --test tools/tests/human-step-execution-operations.test.mjs`
- `submitHumanStepResult` with a `result` matching one of the active human step's
  transitions succeeds via `finishStep`, producing the identical `workflow_progress`/
  history write an agent's `workflow step finish` would produce for the same transition.
  `automated: node --test tools/tests/human-step-execution-operations.test.mjs`
- `submitHumanStepResult` with a `result` not matching any of the active step's transitions
  fails via `finishStep`'s own existing `INVALID_TRANSITION_RESULT` error — not a second,
  duplicate validation. `automated: node --test tools/tests/human-step-execution-operations.test.mjs`
- `submitHumanStepResult` against a step with `executor: agent` fails with the structured
  executor-mismatch error, before any mutation.
  `automated: node --test tools/tests/human-step-execution-operations.test.mjs`
- `submitHumanStepResult` called with `result: 'fail'` against a human step whose `fail`
  transition declares `action.feedback.required: true`, with `feedback` omitted or blank,
  fails **before any mutation** — `change.yaml`/`workflow_progress` byte-for-byte unchanged.
  Called with non-blank `feedback`, it succeeds. Called against a transition where feedback
  is optional (no `action.feedback` or `required: false`), it succeeds with or without
  feedback. `automated: node --test tools/tests/human-step-execution-operations.test.mjs`
- `submitHumanStepResult` called against a human step with a single unconditional
  transition, with `result` omitted, succeeds and completes that transition with no
  fabricated `result` ever reaching `finishStep`. Called with a `result` supplied for that
  same unconditional step fails, before any mutation.
  `automated: node --test tools/tests/human-step-execution-operations.test.mjs`
- `workflow verify-human --approve`/`--request-changes` against a not-yet-active
  `human-verification` step still succeeds in one call (auto-activates then submits), now
  driven by `startHumanStep`/`submitHumanStepResult` internally, with unchanged external
  behavior for that specific step name (regression, not a new requirement).
  `automated: node --test tools/tests/workflow-human-verification.test.mjs`
- `workflow verify-human --confirm` behavior is byte-for-byte unchanged.
  `automated: node --test tools/tests/workflow-human-verification.test.mjs`
- Neither `startHumanStep` nor `submitHumanStepResult` contains its own copy of
  `ensureStepActivated`'s or `finishStep`'s internal logic.
  `inspection: confirm both functions call the imported ensureStepActivated/finishStep directly, with no reimplemented activation or transition-matching logic`

## Verification

```bash
node --test tools/tests/human-step-execution-operations.test.mjs
node --test tools/tests/workflow-human-verification.test.mjs
node --test tools/tests/workflow-cli.test.mjs
node tools/specs.mjs validate
```

## Out of scope

`entryGates`/`exitGates`' own engine or the `--confirm` path (unchanged). The executor-guard
function's own implementation (task `step-executor-guard`, reused here). Any UI wiring
(owned by `human-step-surface-consolidation` and the dashboard mutation-split task).
