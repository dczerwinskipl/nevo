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
    - tools/specs/workflow/human-verification-store.mjs
    - tools/specs/workflow/cli.mjs
    - tools/specs/workflow/compatibility.mjs
    - tools/specs/workflow/definitions/schema.mjs
    - tools/specs/workflow/definitions/loader.mjs
    - tools/specs/validation.mjs
    - tools/specs/store.mjs
  optional:
    - tools/specs/lifecycle-primitives.mjs
allowed_paths:
  - tools/specs/validation.mjs
  - tools/specs/workflow/step-runner.mjs
  - tools/specs/workflow/step-context.mjs
  - tools/specs/workflow/finish-operation.mjs
  - tools/specs/workflow/human-verification-store.mjs
  - tools/specs/workflow/cli.mjs
  - tools/specs/workflow/compatibility.mjs
  - tools/specs/workflow/definitions/schema.mjs
  - tools/specs/workflow/definitions/loader.mjs
  - tools/specs/workflow/index.mjs
  - tools/tests/workflow-next-step.test.mjs
  - tools/tests/workflow-finish-operation.test.mjs
  - tools/tests/workflow-cli.test.mjs
  - tools/tests/workflow-e2e.test.mjs
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/**
  - .nevo-ai/workflows/**
semantic_references:
  decisions: [D13, D14, D18, D19, D20, D23, D24, D25, D26, D27]
  constraints: [C14, C18, C20, C21, C22, C23, C24, C25, C26]
  dependency_contracts: [step-orchestration-and-next-step-service, cli-integration-and-vertical-poc]
---

# Task: Multi-step workflow engine foundations

## Goal

Generalize the engine from its current single-step assumption to real multi-step
progression, and close the identity/versioning/cardinality gaps a real multi-step
workflow exposes (`areas/multi-step-workflow-orchestration.md` §§1-3, 8-12):

1. **Persisted step progress (D18, approved — Git-tracked).** Add a `workflow_progress`
   schema block to a task's `change.yaml` entry — `current_step` plus an append-only
   `history` — distinct from and never overloading task lifecycle `status`.
2. **Generalized current/next-step resolution (D19).** Replace
   `resolveCurrentStepName`'s single-step assumption: read
   `task.workflow_progress.current_step` when present; when absent, resolve to the
   definition's entry step (D27 below). Resolve a step's one transition's `to` against
   the *current* definition's own step names first: a match advances
   `workflow_progress.current_step` (task `status` unchanged); no match is the terminal
   case — write `task.status` exactly as today and finalize `workflow_progress`. This
   must reproduce today's single-step behavior exactly as the degenerate case.
3. **Generalized `update-task` reconciliation (C18).** The persisted `intent` becomes a
   discriminated union — `{ kind: 'step', fromStep, toStep }` for an internal
   transition, or `{ kind: 'status', fromState, toState }` for a terminal one (today's
   only case) — reconciliation logic for each follows the same
   fromState/toState-vs-current-state comparison Task 06 already implemented.
4. **Step-aware finish-operation identity (D23).** The durable finish-operation record
   path becomes `.nevo-ai-local/workflow-operations/<change>/<task>/<step>.json` (was
   `<change>/<task>.json`) — `loadOperationRecord`/`saveOperationRecord` gain a `step`
   parameter; every call site (this module's own `planFinish`/`finishStep`, and
   `cli.mjs`) is updated. A completed operation from one step must never be reachable
   from, or short-circuit, another step's resolution.
5. **Step/gate-scoped human-verification identity (D24).** `FileHumanVerificationStore`
   (`human-verification-store.mjs`) keys its persisted signoff by
   `change`/`task`/`step`/gate identity (`gateDisplayId` or explicit gate `id`)/
   `requiredRole`, at path
   `.nevo-ai-local/human-verifications/<change>/<task>/<step>/<gate-id>.json`.
   `workflow verify-human` (`cli.mjs`) auto-resolves the current step as `step start`/
   `step finish` already do, adding an optional `--gate <id>` to disambiguate a step with
   more than one unmet human gate.
6. **Declarative per-step behavior contract — schema only (D25).** Extend
   `definitions/schema.mjs` to accept and validate three new optional per-step fields:
   `purpose` (string), `expectedWork` (object, at minimum a `summary` string),
   `hints` (array of `{ type: 'doc'|'skill'|'file', ref: string }`). This task
   validates the shape only — authoring real content (Task 10) and wiring it into
   `StepContext` (Task 11) are explicitly out of scope here.
7. **Fail-closed workflow-definition version compatibility (D26).** Add a check —
   callable from `cli.mjs`'s `resolveWorkflowRuntime` — asserting
   `change.workflow.version === definition.version` before any step resolution happens;
   mismatch throws an explicit `WorkflowDefinitionError` naming both versions.
8. **Transition cardinality and explicit entry step (D27).** `validateWorkflowDefinition`
   rejects a step declaring zero or more than one `transitions` entries (every step, not
   a "non-terminal" subset — see D27's note on why that distinction doesn't exist at
   schema time). Add an optional top-level `entryStep` field: when present, must name a
   real step and is used as the entry point for a task with no `workflow_progress` yet;
   when absent, the first declared `steps` key is used, exactly as today.

## Implementation constraints

- **Do not touch `.nevo-ai/workflows/**`** — this task only changes resolution/schema
  *logic*; authoring a real multi-step definition (including real `purpose`/
  `expectedWork`/`hints` content and an explicit `entryStep`) is Task 10's job, and
  removing `verify-task-output` is Task 09's job. This task's own tests use fixture
  definitions constructed inline, never editing the shipped `standard.yaml`.
- `workflow_progress` validation (`tools/specs/validation.mjs`) must reject a
  `current_step` value that names no step in the task's resolved workflow definition —
  fail closed (C6/C20) — and must be a no-op (never required, never validated) for a
  change whose `workflow.mode` is not `deterministic`.
- A workflow definition must not declare a step whose name collides with any terminal
  status value used as a `to` target elsewhere in the same definition — validate this at
  definition-load time (`definitions/schema.mjs`), not at transition-resolution time.
- Preserve every existing Task 06/07 behavior and test exactly: this is a strict
  generalization, not a rewrite. `node --test tools/tests/workflow-next-step.test.mjs
  tools/tests/workflow-finish-operation.test.mjs tools/tests/workflow-cli.test.mjs
  tools/tests/workflow-e2e.test.mjs` must all still pass unmodified (add new tests; do
  not delete or weaken existing ones). This includes the operation-record and
  human-verification path changes (4-5 above) — every existing test that asserted the
  old `<change>/<task>.json`/`<change>/<task>.json` (human-verification) paths updates
  its own assertions to the new step-aware paths, since those paths are this module's
  own internal implementation detail, not a public contract anything outside
  `tools/specs/workflow/` depends on.
- Reuse `tools/specs/store.mjs`'s existing `updateYamlFile`-based write path (the same
  one `setTaskStatus` uses) for writing `workflow_progress` — do not invent a second
  `change.yaml` write mechanism.
- The `update-task` finalize stage still writes both the implementation and the
  workflow-position update (step advance and/or terminal status) in the *same*
  `change.yaml` read-modify-write and the *same* progress commit (C14 unchanged).
- The version-compatibility check (7) is a guard, not a framework: one equality
  comparison, one error type, no migration tooling, no multi-version resolution.
- The step-behavior-contract schema fields (6) are validated but otherwise inert in this
  task — do not add any `StepContext` surfacing of them here (that is Task 11's scope,
  which depends on this task).

## Acceptance criteria

1. `change.yaml` accepts an optional per-task `workflow_progress: { current_step,
   history: [...] }` block; `node tools/specs.mjs validate` rejects a `current_step` that
   names no step in the task's resolved workflow definition, and rejects/ignores the
   field consistently on a non-deterministic-mode change. `automated: node --test tools/tests/workflow-next-step.test.mjs`
2. Given a ≥2-step fixture workflow definition, current-step resolution resolves the
   entry step for a task with no `workflow_progress`, and resolves whatever
   `current_step` names for a task that already has one. `automated: node --test tools/tests/workflow-next-step.test.mjs`
3. Finishing a step whose transition names another declared step advances
   `workflow_progress.current_step` (with a `history` entry appended), leaves
   `task.status` unchanged, and a subsequent `step start` resolves the new step.
   `automated: node --test tools/tests/workflow-finish-operation.test.mjs`
4. Finishing a step whose transition names no declared step writes `task.status` to that
   value and finalizes `workflow_progress` — byte-for-byte the same outcome today's
   single-step `standard.yaml` already produces via the unmodified Task 06/07 test
   suites. `automated: node --test tools/tests/workflow-finish-operation.test.mjs, tools/tests/workflow-e2e.test.mjs`
5. A step-advance `update-task` stage found `running` on recovery is reconciled via the
   generalized `{kind:'step', fromStep, toStep}` intent, covering "already happened"
   (completed), "never happened" (safe to redo), and "ambiguous" (`unknown`, blocked).
   `automated: node --test tools/tests/workflow-finish-operation.test.mjs`
6. Both the implementation and the workflow-position update land in the one progress
   commit — never a separate later commit (C14 preserved). `automated: node --test tools/tests/workflow-finish-operation.test.mjs`
7. **Step-aware operation identity (D23):** given a task that completes step A
   (`workflow step finish` succeeds, operation record for A shows `completed`), starting
   and finishing step B creates/runs a *distinct* operation for B — B's finish actually
   executes B's finalize sequence (produces its own commit/result), never returning A's
   cached completed result. Step A's own completed record file is untouched afterward.
   `automated: node --test tools/tests/workflow-finish-operation.test.mjs`
8. **Step/gate-scoped human verification (D24):** confirming the human gate on step A
   (via the CLI-facing store) does not satisfy an independently-configured human gate on
   step B — each requires its own `verify-human --confirm`. A step with two unmet human
   gates requires `--gate <id>` to disambiguate; confirming one does not affect the
   other. `automated: node --test tools/tests/workflow-cli.test.mjs`
9. **Step-behavior-contract schema (D25):** a step declaring `purpose`/`expectedWork`/
   `hints` loads and validates successfully; `hints` entries with an invalid `type` or
   missing `ref` fail validation. `automated: node --test tools/tests/workflow-next-step.test.mjs`
10. **Version compatibility (D26):** a change whose `workflow.version` does not match the
    loaded definition's own `version` fails `step start`/`step finish` with an explicit
    error naming both versions; a matching version proceeds normally. `automated: node --test tools/tests/workflow-cli.test.mjs`
11. **Transition cardinality (D27):** a definition declaring a step with zero or more
    than one `transitions` entries fails validation with an explicit error; a definition
    declaring exactly one per step (today's `standard.yaml` and every fixture) validates
    successfully. `automated: node --test tools/tests/workflow-next-step.test.mjs`
12. **Explicit entry step (D27):** a definition declaring `entryStep: <name>` uses it as
    the resolved step for a task with no `workflow_progress`; a definition omitting it
    falls back to the first declared `steps` key, unchanged from today; `entryStep`
    naming an undeclared step fails validation. `automated: node --test tools/tests/workflow-next-step.test.mjs`
13. A definition declaring a step name that collides with a terminal status value used
    elsewhere as a `to` target in the same definition fails to load, with an explicit
    error naming the collision. `automated: node --test tools/tests/workflow-next-step.test.mjs`
14. Every existing Task 06/07 test continues passing (with only the internal
    operation-record/human-verification path assertions updated to the new step-aware
    paths, per the implementation constraints) against the real, unchanged
    `.nevo-ai/workflows/standard.yaml`. `automated: node --test tools/tests/workflow-next-step.test.mjs tools/tests/workflow-finish-operation.test.mjs tools/tests/workflow-cli.test.mjs tools/tests/workflow-e2e.test.mjs`

## Verification

```text
node --test tools/tests/workflow-next-step.test.mjs
node --test tools/tests/workflow-finish-operation.test.mjs
node --test tools/tests/*.test.mjs
node tools/specs.mjs check
```
