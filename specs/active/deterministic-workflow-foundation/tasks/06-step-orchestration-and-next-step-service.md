---
id: deterministic-workflow-foundation.step-orchestration-and-next-step-service
status: draft
change: deterministic-workflow-foundation
context:
  required:
    - specs/active/deterministic-workflow-foundation/overview.md
    - specs/active/deterministic-workflow-foundation/owner-decisions.md
    - specs/active/deterministic-workflow-foundation/areas/workflow-engine-and-next-step.md
    - tools/specs/workflow/contracts.mjs
    - tools/specs/workflow/registry.mjs
    - tools/specs/workflow/engine.mjs
    - tools/lib/cli-errors.mjs
  optional:
    - docs/ai/specification-workflow.md
    - tools/specs/lifecycle.mjs
    - tools/dashboard/server/ai/sessions/binding-service.mjs
allowed_paths:
  - tools/specs/workflow/step-runner.mjs
  - tools/specs/workflow/step-context.mjs
  - tools/specs/workflow/finish-operation.mjs
  - tools/specs/workflow/definitions/**
  - tools/specs/workflow/index.mjs
  - tools/specs/lifecycle.mjs
  - tools/tests/workflow-next-step.test.mjs
  - tools/tests/workflow-finish-operation.test.mjs
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/**
semantic_references:
  decisions: [D5, D6, D7, D9, D10, D11, D13, D14, D15, D17]
  constraints: [C3, C4, C7, C8, C9, C10, C11, C12, C14, C15, C16, C17]
  dependency_contracts: [source-control-capability]
---

# Task: Step lifecycle orchestration — compiled `StepContext`, finish planning, and durable finish execution

## Goal

Implement the step lifecycle orchestration layer behind the agent-facing
`workflow step start` / `workflow step finish [--check]` surface (D9):

1. **`StepContext` compilation at start (D10):** aggregate action/gate contracts (reusing
   `WorkflowEngine.checkStep`, Task 03 — never re-implementing that aggregation) into one
   step-level payload: current step, task/spec identity, workflow state, step
   instructions, entry state/blockers, expected work, factual context (including
   source-control context when enabled), the finish contract (`requiredInputs` aggregated
   across finalize actions, e.g. `commit.title` required / `commit.message` optional),
   and next-step guidance.
2. **Non-mutating finish planning with happy-path `input-required` (D11):** a `--check`
   form that is strictly non-mutating (C12), and `workflow step finish` itself returning
   `status: "input-required"` (with the same factual planning payload, zero mutation) when
   required inputs are missing — never requiring a separate preflight call in the happy
   path.
3. **Durable, resumable finish execution (D14):** a fixed-order finalize sequence
   (`verify-gates → update-task → commit → push → transition`, per the finalize ordering
   invariant D13 — task/spec completion state is updated *before* the progress commit, and
   both land in the same commit) executed under a durable operation record with a fixed
   per-stage status vocabulary (`pending` / `running` / `completed` / `failed` /
   `unknown`) and reconciliation of `unknown` stages against real state on retry (never
   repeating a completed side effect, in particular never re-creating a commit). **This
   record is workflow execution/runtime state, not Git-tracked domain/specification
   state** — it is persisted at `.nevo-ai-local/workflow-operations/<change>/<task>.json`
   (git-ignored, never staged or committed), never inside `change.yaml`. Storing it in
   `change.yaml` (the original design) was a real defect: a commit cannot contain its own
   resulting SHA, and every post-commit bookkeeping write would leave the worktree dirty
   again right after a clean finalize (C17). `change.yaml`'s existing
   `execution.suspension` block is unaffected and remains a separate,
   task-lifecycle-level concept. A repeated `workflow step finish` after full success
   returns the already-completed result and current next step.
4. Current/next-step resolution — replacing the original `next-step` query design (D9)
   with this two-call surface; the underlying step-definition evaluation (entry/exit
   gates, transitions) is unchanged from the original design and is reused, not
   redesigned.

## Implementation constraints

- Support composing declarative steps with entry gates, actions, exit gates, finalize
  actions, and transitions (unchanged from the original design).
- `StepContext` compilation and finish planning must call gate `inspect()`, never
  `verify()` — read-only calls must never run verification commands (C7/C8, reaffirmed).
- The finish contract computed at `step start` and the `requiredInputs` reported by
  `step finish`/`step finish --check` must be the same aggregation, computed by the same
  code path — not two independently maintained implementations that could drift.
- Persist the finish-operation record (shape: `operationId`, `change`, `task`, `step`,
  `status`, `operations[]` each with `id`/`status`/optional `result`) to
  `.nevo-ai-local/workflow-operations/<change>/<task>.json` via a small, self-contained
  read/write helper inside `tools/specs/workflow/`, following the same on-disk convention
  (git-ignored directory prefix, atomic temp-file-then-rename writes) already established
  by `tools/dashboard/server/ai/sessions/binding-service.mjs` — read that file for the
  pattern, but do not import from `tools/dashboard/` (see `forbidden_paths`; this task
  adds no new dependency in that direction). No `tools/specs/validation.mjs` or
  `change.yaml` schema change is needed — this record is never part of the manifest, so
  Task 01's own already-verified acceptance criteria and task file are untouched.
- Reuse existing task/spec completion-state transition logic (`tools/specs/lifecycle.mjs`)
  for the `update-task` stage rather than duplicating status-transition logic inside the
  workflow module.
- The `commit`/`push` finish stages call the Task 04 source-control action and persist its
  `outputs.commit`/`outputs.push` shape (D15) directly into the operation record's stage
  results — no reshaping in between.
- The final `transition` stage must never write `change.yaml` a second time — the
  task/spec status change already happened via `update-task` and was already committed by
  `commit`. `transition` only marks the runtime operation record fully `completed` and
  derives the `nextStepGuidance` to return, preserving C17 even after this last stage.
- Reconciliation for an `unknown` `push` stage must use the Task 04 local-Git
  reconciliation primitive (`tools/lib/git.mjs`) to check whether the recorded commit SHA
  is already on the expected remote branch, and must never issue a second commit.
- Do not bake Standard-specific assumptions into the engine; allow pluggable workflow
  definitions (unchanged from the original design).

## Acceptance criteria

1. `workflow step start` returns a compiled `StepContext` containing current step,
   task/spec identity, workflow state, entry state/blockers, factual context, and a finish
   contract aggregating `requiredInputs` across the step's finalize actions, without
   requiring the caller to separately inspect individual actions. `automated: node --test tools/tests/workflow-next-step.test.mjs`
2. `workflow step finish --check` is verified non-mutating against filesystem, Git, and
   manifest state, and reports changed files, staged/untracked state, relevant commits,
   branch/HEAD, push status, planned operations, required inputs, and which are missing.
   `automated: node --test tools/tests/workflow-next-step.test.mjs`
3. `workflow step finish` called with missing required inputs returns
   `status: "input-required"` with the same planning payload as `--check` and performs
   zero mutation (no partial commit, no partial task-status update). `automated: node --test tools/tests/workflow-next-step.test.mjs`
4. If human verification is required and unrecorded, both `step start`'s `StepContext` and
   a `step finish` attempt report the blocking human-verification state; the transition is
   not performed. `automated: node --test tools/tests/workflow-next-step.test.mjs`
5. Given complete valid inputs, `workflow step finish` executes the fixed stage order
   (`verify-gates → update-task → commit → push → transition`), and the resulting commit
   contains both the implementation changes and the task/spec status update (D13).
   `automated: node --test tools/tests/workflow-finish-operation.test.mjs`
6. A finish operation interrupted after the `update-task` stage, when retried, does not
   re-run `update-task` and proceeds to `commit`. `automated: node --test tools/tests/workflow-finish-operation.test.mjs`
7. A finish operation interrupted after `commit` completes (SHA recorded) but before
   `push`, when retried, does not create a second commit and proceeds to `push`.
   `automated: node --test tools/tests/workflow-finish-operation.test.mjs`
8. A finish operation left with `push: unknown` (ambiguous push result), when retried,
   reconciles against real remote state: if the recorded SHA is already on the remote
   branch, `push` resolves to `completed` without re-pushing; if not, `push` resolves to
   `pending` and is performed. `automated: node --test tools/tests/workflow-finish-operation.test.mjs`
9. A finish operation interrupted after a successful `push` but before `transition`, when
   retried, does not re-push and completes only the `transition` stage.
   `automated: node --test tools/tests/workflow-finish-operation.test.mjs`
10. A `workflow step finish` call made after the operation record already shows full
    success returns the already-completed result and current next step without repeating
    any finalize action. `automated: node --test tools/tests/workflow-finish-operation.test.mjs`
11. Unit tests verify step progression and next-step resolution across multiple step
    configurations and states without executing test gates during inspection.
    `automated: node --test tools/tests/workflow-next-step.test.mjs`
12. The finish-operation record is written only to
    `.nevo-ai-local/workflow-operations/<change>/<task>.json` — never to `change.yaml` —
    and `node tools/specs.mjs validate` requires no schema for it. `automated: node --test tools/tests/workflow-finish-operation.test.mjs`
13. After a fully successful `workflow step finish` with source control enabled, the test
    fixture's Git worktree is verified clean (`git status --porcelain` empty) — no
    residual dirtiness from finish-operation bookkeeping performed after the progress
    commit (C17). `automated: node --test tools/tests/workflow-finish-operation.test.mjs`

## Verification

```text
node --test tools/tests/workflow-next-step.test.mjs
node --test tools/tests/workflow-finish-operation.test.mjs
```
