---
id: deterministic-workflow-foundation.multi-step-workflow-progression
status: draft
change: deterministic-workflow-foundation
context:
  required:
    - specs/active/deterministic-workflow-foundation/overview.md
    - specs/active/deterministic-workflow-foundation/owner-decisions.md
    - specs/active/deterministic-workflow-foundation/areas/multi-step-workflow-orchestration.md
    - tools/specs/workflow/step-runner.mjs
    - tools/specs/workflow/step-context.mjs
    - tools/specs/workflow/finish-operation.mjs
    - tools/specs/workflow/definitions/schema.mjs
    - tools/specs/validation.mjs
    - tools/specs/store.mjs
  optional:
    - tools/specs/lifecycle-primitives.mjs
allowed_paths:
  - tools/specs/validation.mjs
  - tools/specs/workflow/step-runner.mjs
  - tools/specs/workflow/step-context.mjs
  - tools/specs/workflow/finish-operation.mjs
  - tools/specs/workflow/definitions/schema.mjs
  - tools/specs/workflow/index.mjs
  - tools/tests/workflow-next-step.test.mjs
  - tools/tests/workflow-finish-operation.test.mjs
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/**
  - .nevo-ai/workflows/**
semantic_references:
  decisions: [D13, D14, D18, D19]
  constraints: [C14, C18, C21, C22]
  dependency_contracts: [step-orchestration-and-next-step-service, cli-integration-and-vertical-poc]
---

# Task: Persisted multi-step workflow progress and generalized transition resolution

## Goal

Generalize the engine from its current single-step assumption to real multi-step
progression (`areas/multi-step-workflow-orchestration.md` §§1-3):

1. Add a `workflow_progress` schema block to a task's `change.yaml` entry (D18) —
   `current_step` plus an append-only `history` — persisted, Git-tracked, distinct from
   and never overloading task lifecycle `status`.
2. Replace `resolveCurrentStepName`'s single-step assumption with real resolution: read
   `task.workflow_progress.current_step` when present; when absent, resolve to the
   workflow definition's entry step (the first declared key in `steps` — an ordering
   convention, not a hardcoded name).
3. Resolve a step's `transitions[].to` against the *current* definition's own step names
   first (D19): a match advances `workflow_progress.current_step` (task `status`
   unchanged); no match is the terminal case — write `task.status` exactly as today and
   finalize `workflow_progress`. This must reproduce today's single-step behavior
   exactly as the degenerate case (`to: verified` matches no step in `standard.yaml`,
   so it stays terminal, unchanged).
4. Extend the `update-task` finalize stage (and its C18 crash-window reconciliation) to
   this generalized model: the persisted `intent` becomes a discriminated union —
   `{ kind: 'step', fromStep, toStep }` for an internal transition, or
   `{ kind: 'status', fromState, toState }` for a terminal one (today's only case) —
   reconciliation logic for each case follows the same fromState/toState-vs-current-state
   comparison Task 06 already implemented, just applied to whichever field the intent
   names.

## Implementation constraints

- **Do not touch `.nevo-ai/workflows/**`** — this task only changes resolution *logic*;
  authoring a real multi-step definition is Task 10's job, and removing
  `verify-task-output` is Task 09's job. Verify this task's own tests use fixture
  definitions constructed inline (as Task 06/07's own tests already do), never editing
  the shipped `standard.yaml`.
- `workflow_progress` validation (`tools/specs/validation.mjs`) must reject a
  `current_step` value that names no step in the task's resolved workflow definition —
  fail closed, matching this specification's existing standard (C6/C20) — and must be a
  no-op (never required, never validated) for a change whose `workflow.mode` is not
  `deterministic`.
- A workflow definition must not declare a step whose name collides with any terminal
  status value used as a `to` target elsewhere in the same definition — validate this at
  definition-load time (`definitions/schema.mjs`), not at transition-resolution time,
  so the ambiguity is caught before any task can hit it.
- Preserve every existing Task 06/07 behavior and test exactly: this is a strict
  generalization, not a rewrite. `node --test tools/tests/workflow-next-step.test.mjs
  tools/tests/workflow-finish-operation.test.mjs tools/tests/workflow-cli.test.mjs
  tools/tests/workflow-e2e.test.mjs` must all still pass unmodified (you may add new
  tests to these files; do not need to and should not delete or weaken existing ones).
- Reuse `tools/specs/store.mjs`'s existing `updateYamlFile`-based write path (the same
  one `setTaskStatus` uses) for writing `workflow_progress` — do not invent a second
  `change.yaml` write mechanism.
- The `update-task` finalize stage still writes both the implementation and the
  workflow-position update (step advance and/or terminal status) in the *same*
  `change.yaml` read-modify-write and the *same* progress commit (C14 unchanged).

## Acceptance criteria

1. `change.yaml` accepts an optional per-task `workflow_progress: { current_step,
   history: [...] }` block; `node tools/specs.mjs validate` rejects a `current_step` that
   names no step in the task's resolved workflow definition, and rejects/ignores the
   field consistently on a non-deterministic-mode change (pick one, document which, and
   enforce it — never silently accept it as meaningless data). `automated: node --test tools/tests/workflow-next-step.test.mjs`
2. Given a ≥2-step fixture workflow definition, `resolveCurrentStepName`'s replacement
   resolves the entry step for a task with no `workflow_progress`, and resolves whatever
   `current_step` names for a task that already has one. `automated: node --test tools/tests/workflow-next-step.test.mjs`
3. Finishing a step whose `transitions[].to` names another declared step advances
   `workflow_progress.current_step` to it (with a `history` entry appended) and leaves
   `task.status` unchanged; a subsequent `step start` resolves the new step. `automated: node --test tools/tests/workflow-finish-operation.test.mjs`
4. Finishing a step whose `transitions[].to` names no declared step writes `task.status`
   to that value and finalizes `workflow_progress` — byte-for-byte the same outcome
   today's single-step `standard.yaml` already produces via the unmodified Task 06/07
   test suites. `automated: node --test tools/tests/workflow-finish-operation.test.mjs, tools/tests/workflow-e2e.test.mjs`
5. A step-advance `update-task` stage found `running` on recovery is reconciled via the
   generalized `{kind:'step', fromStep, toStep}` intent, using the same
   current-state-vs-intent comparison Task 06 already proved for the status case —
   covering "the step advance already happened" (mark completed), "it never happened"
   (safe to redo), and "ambiguous" (`unknown`, blocked for reconciliation). `automated: node --test tools/tests/workflow-finish-operation.test.mjs`
6. Both the implementation and the workflow-position update (step advance or terminal
   status) land in the one progress commit — never a separate later commit (C14
   preserved). `automated: node --test tools/tests/workflow-finish-operation.test.mjs`
7. `StepContext.currentStep`/`nextStepGuidance` and finish planning's response correctly
   reflect the resolved current/next step for a ≥2-step fixture definition. `automated: node --test tools/tests/workflow-next-step.test.mjs`
8. Every existing Task 06/07 test (`workflow-next-step`, `workflow-finish-operation`,
   `workflow-cli`, `workflow-e2e`) continues passing unmodified against the real,
   unchanged `.nevo-ai/workflows/standard.yaml`. `automated: node --test tools/tests/workflow-next-step.test.mjs tools/tests/workflow-finish-operation.test.mjs tools/tests/workflow-cli.test.mjs tools/tests/workflow-e2e.test.mjs`
9. A definition declaring a step name that collides with a terminal status value used
   elsewhere as a `to` target in the same definition fails to load, with an explicit
   error naming the collision. `automated: node --test tools/tests/workflow-next-step.test.mjs`

## Verification

```text
node --test tools/tests/workflow-next-step.test.mjs
node --test tools/tests/workflow-finish-operation.test.mjs
node --test tools/tests/*.test.mjs
node tools/specs.mjs check
```
