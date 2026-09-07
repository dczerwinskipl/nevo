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
this aggregation is the one place that happens. `finishContract.requiredInputs` is built
by flattening each finalize action's `requiredInputs` array (from `checkStep`'s per-action
output, Task 03) into one step-level map keyed by parameter `name` — dotted names like
`commit.title` are ordinary strings to this layer (Task 02's schema validator places no
character restriction on `name`, only non-empty). The finalize actions this foundation
defines (`verify-task-output`, `commit-and-push`) never declare colliding names; a future
step definition whose finalize actions do collide is out of scope here and would need
explicit per-action namespacing, not silent overwrite.

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

`transition` (the final stage, after push confirmation) never writes `change.yaml` again
— the task/spec status change already happened and was already committed by
`update-task`/`commit`. `transition` only marks the runtime operation record fully
`completed` and derives the next-step response; this is what keeps the worktree clean
even after this last stage runs (C17).

**This record is workflow execution/runtime state, not Git-tracked domain/specification
state (D14 correction).** The original design persisted it as an `execution.finish_operation`
field inside `change.yaml`, which created a circular problem: a commit cannot contain its
own resulting SHA, and every post-commit bookkeeping write (recording `push`/`transition`
completion) would leave the worktree dirty again immediately after a clean finalize —
directly violating C17. This finish-operation runtime record is instead persisted in
Nevo's local runtime storage at `.nevo-ai-local/workflow-operations/<change>/<task>.json`,
following the
existing git-ignored local-storage convention already used by
`tools/dashboard/server/ai/sessions/binding-service.mjs` (one JSON file per key, atomic
temp-file-then-rename writes) — reused as a *pattern*, not as a new code dependency from
`tools/specs/workflow/` on `tools/dashboard/`. No `tools/specs/validation.mjs` schema
change is needed for this — it is never part of `change.yaml`, so Task 01's own
task file/acceptance criteria are untouched. `change.yaml`'s existing
`execution.suspension` block is a separate, unaffected, task-lifecycle-level concept (why
the last attempted *action* stopped) — this new record is distinct and more granular:

```json
{
  "operationId": "...",
  "change": "deterministic-workflow-foundation",
  "task": "06-step-orchestration-and-next-step-service",
  "step": "implementation",
  "status": "running",
  "operations": [
    { "id": "verify-gates", "status": "completed" },
    { "id": "update-task", "status": "completed" },
    { "id": "commit", "status": "completed", "result": { "sha": "abc123" } },
    { "id": "push", "status": "unknown", "result": { "remote": "origin", "branch": "feature/foo", "expectedSha": "abc123" } },
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

**Required invariant (C17).** After a successful task-completing `workflow step finish`
with source control enabled: task/spec Git-tracked metadata reflects the completed
state; the implementation and that metadata update are contained in the one progress
commit; the expected commit is confirmed on the configured remote when push is enabled;
and the Git worktree is **not** left dirty solely because Nevo updated its own internal
finish-operation bookkeeping after the commit — that bookkeeping is the runtime-only
record above and produces no Git-visible change by itself.

## Human Verification: Reported, Never Self-Satisfied (D9 clarification)

When a `HumanVerificationGate` exit gate is unmet, `workflow step finish` reports it the
same way as any other unmet exit gate — via that gate's `inspect()` status in the finish
planning payload (the `gates`/`blockers` fields shown above) — and stops, performing no
mutation. This is distinct from `input-required` (missing semantic inputs like
`commit.title`): a gate block can be present with or without missing inputs, and both are
reported in the same payload rather than conflated into one status. Only the separate,
operator-facing `workflow verify-human <change> <task> --confirm` command can satisfy the
gate; the agent-facing `step start`/`step finish` calls have no path to do so (C8).

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
