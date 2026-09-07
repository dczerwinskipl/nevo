# Area: Step Lifecycle Orchestration — `StepContext`, Finish Planning, and Durable Finish Execution

## Purpose

Define the step lifecycle orchestration layer that compiles a `StepContext` at
`workflow step start`, provides non-mutating finish planning (including happy-path
`input-required` reporting), and executes a durable, resumable multi-stage finish
operation — replacing the original "next-step query service" design (D9) with the
two-call agent-facing surface (`step start` / `step finish`) this specification's target
interaction model requires. The engine still evaluates declarative step definitions,
coordinates action execution, and enforces entry/exit gates using non-mutating inspection
for read-only calls; it now aggregates all of that into two agent-facing calls instead of
exposing per-primitive commands.

This area was originally titled "Workflow Engine and Next-Step Query Service." The
`next-step`/`execute-step` commands it originally proposed are superseded before ever
being implemented — see D9 in `owner-decisions.md`.

## Step Lifecycle and Orchestration (unchanged shape)

A workflow step still defines `id`, `entryGates`, `actions`, `exitGates`, `finalize`, and
`transitions`, exactly as established by Task 01's schema:
```yaml
steps:
  implementation:
    entryGates: []
    actions:
      - id: implement-task
    exitGates:
      - type: command
        action: test
      - type: human
        required: true
    finalize:
      - id: verify-task-output
      - id: commit-and-push
    transitions:
      - to: verified
```

## `workflow step start` — Compiled `StepContext` (D10)

```text
node tools/specs.mjs workflow step start <change> [task]
```
Resolves the current step from `change`/`task` state (an explicit step id remains
available for diagnostics/manual override, never required in the normal flow), then
compiles a `StepContext` by reusing `WorkflowEngine.checkStep`'s action/gate aggregation
(Task 03) — this layer aggregates, it does not re-implement, that check. At minimum:

- current workflow step, task/spec identity, current workflow state,
- step instructions/behavior, entry state and blockers,
- available/expected work (e.g. `allowed_paths`),
- factual runtime context, including source-control context when `sourceControl.enabled`,
- the **finish contract**: `requiredInputs` aggregated across the step's finalize actions
  (e.g. `commit.title` required / `commit.message` optional), and the gates that must
  pass,
- next-step guidance where meaningful.

```json
{
  "change": "deterministic-workflow-foundation",
  "task": "01-workflow-schema-and-compatibility",
  "workflowMode": "deterministic",
  "currentStep": "implementation",
  "stepStatus": "in-progress",
  "entryState": { "blockers": [] },
  "context": {
    "sourceControl": { "changedFiles": ["src/index.js"], "currentBranch": "feature/workflow-foundation" }
  },
  "finishContract": {
    "requiredInputs": {
      "commit.title": { "type": "string", "required": true, "description": "Commit title" },
      "commit.message": { "type": "string", "required": false, "description": "Commit body" }
    },
    "gates": [
      { "id": "test-suite", "type": "command" },
      { "id": "human-review", "type": "human" }
    ]
  },
  "nextStepGuidance": { "onSuccess": "verified" }
}
```
The agent must not need to inspect individual actions merely to discover their schemas —
this aggregation is the one place that happens.

## `workflow step finish` — Non-Mutating Planning and `input-required` (D11)

```text
node tools/specs.mjs workflow step finish <change> [task] [--check]
```
`--check` computes the current concrete finish plan without mutating anything (same
invariant as action `check`/gate `inspect`, C2/C12) by evaluating, in order: supplied
inputs against the (same) aggregated finish contract, gate `inspect()` results, and
current source-control facts. `workflow step finish` without `--check` runs the identical
planning step first — if any required input is missing, it returns the same
`status: "input-required"` payload and performs zero mutation; only when every required
input is present does it proceed to actual execution. This is what keeps a separate
preflight call optional rather than mandatory (C12).

```json
{
  "status": "input-required",
  "requiredInputs": { "commit.title": { "required": true }, "commit.message": { "required": false } },
  "sourceControl": { "changedFiles": [], "existingCommits": [], "unpushedCommits": [] },
  "plannedOperations": ["verify-gates", "update-task-status", "commit-progress", "push", "transition"],
  "blockers": []
}
```

## Durable, Resumable Finish Execution (D14)

When inputs are complete, `workflow step finish` executes the finalize sequence under one
durable operation record — this is the layer specification requirement 6 (resumability)
lives in. Fixed stage order, matching the finalize ordering invariant (D13):

```text
verify-gates → update-task → commit → push → transition
```

Persisted per task, alongside the existing `execution.suspension` block (same
orthogonal-to-lifecycle-status pattern, same `change.yaml` task entry) as a new
`execution.finish_operation` block — schema support added to `tools/specs/validation.mjs`
(extending that shared module; Task 01's own task file/acceptance criteria are untouched):

```json
{
  "operationId": "...",
  "status": "running",
  "operations": [
    { "id": "verify-gates", "status": "completed" },
    { "id": "update-task", "status": "completed" },
    { "id": "commit", "status": "completed", "result": { "sha": "abc123" } },
    { "id": "push", "status": "unknown" },
    { "id": "transition", "status": "pending" }
  ]
}
```

Per-stage status: `pending` / `running` / `completed` / `failed` / `unknown`. On retry:

1. Load the existing operation record (never start a fresh one while one is in progress
   for the same task).
2. Treat every `completed` stage's side effect as already achieved — never repeat it.
3. Reconcile any `unknown` stage against real state. For `push`: check (via the Task 04
   local-Git reconciliation primitive) whether the recorded `commit.sha` is already
   present on the expected remote branch; `completed` if yes, `pending` if not. A commit
   is never re-created once its SHA is known.
4. Continue from the first stage that still needs work.

A repeated `workflow step finish` after the record shows full success returns the
already-completed result and current next step rather than repeating finalize actions —
this is what makes the whole sequence safely idempotent from the agent's point of view.

Required acceptance coverage for interruption/retry (specification requirement 6),
matching Task 07's vertical PoC Scenario G:
- interrupted after task-metadata update,
- interrupted after commit creation,
- interrupted with an ambiguous (`unknown`) push result,
- interrupted after a successful push but before workflow transition/result delivery.

## Push Completion State (D15)

The `commit`/`push` stage results persist achieved state, not just invocation success,
so "has this been pushed" is answerable deterministically at any later time:
```json
{
  "commit": { "sha": "abc123", "status": "completed" },
  "push": { "remote": "origin", "branch": "feature/foo", "expectedSha": "abc123", "status": "completed" }
}
```

## Deferred Extension Point: Progress Checkpoint (D17)

Not implemented in this foundation. Because the source-control action and the durable
finish-operation mechanism are already separated from gate verification and the
task-completion transition, a future `workflow step save` / `workflow save-progress`
command could reuse both directly — commit/push per source-control configuration, no
exit-gate requirement, no task-completion transition, no move to next step, safely
retryable via the same operation-record mechanism above. This is recorded here as an
explicit extension point; the command itself is out of scope for this foundation.

## Multi-Workflow Support (unchanged)

The engine still evaluates declarative step definitions without baking Standard-specific
or Architectural-specific logic into code — changing step order or adding gates remains a
definition-YAML change, enforced dynamically by the engine.
