---
id: spec.deterministic-workflow-foundation
type: change
title: "Deterministic workflow foundation"
status: draft
change: deterministic-workflow-foundation
---

# Deterministic workflow foundation

## Context

Today Nevo operates in a semi-deterministic model. While CLI commands, task states, approval mechanisms, and git safety checks exist, AI agents still carry a significant amount of process orchestration knowledge in system prompts, skill instructions, and markdown conventions. Agents currently deduce what step should happen next, what checks are required before completing a task, which commands to invoke, what context to inspect, whether human verification is required, and what parameters to pass.

The target architecture reverses this relationship:
**The workflow engine decides what happens next; the agent performs bounded work requested by the workflow.**

AI must transition from being the workflow orchestrator to being a bounded executor of discrete steps. The CLI/runtime should deterministically tell the agent:
1. What the current step is,
2. What actions belong to that step,
3. What conditions and gates must be satisfied,
4. What information the action requires (via explicit input schemas),
5. What runtime context the agent should inspect (factual repo state),
6. Whether human verification is required,
7. What command can be executed,
8. What the next valid transition is.

This specification builds the foundation for configurable deterministic workflows. Rather than postponing workflow definitions to a future stage, this specification establishes a real, executable declarative workflow definition model, composable action contracts, non-mutating checks with parameter schemas, factual context extraction, deterministic gate contracts with separate inspection and execution, machine-readable human verification, and a complete vertical proof-of-concept, while preserving the existing legacy workflow during migration.

**Status after Tasks 01-07 (corrected 2026-09-08, revised 2026-09-08, further corrected 2026-09-11 — see D18-D37).** Tasks 01-07 deliver and prove, end-to-end, exactly **one** workflow step's full lifecycle: entry gates, an action, exit gates (command + human verification), a durable multi-*stage* finalize sequence (`verify-gates -> update-task -> commit -> push -> transition`), and a single terminal transition — plus the composable action/gate contracts, the `workflow step start`/`step finish [--check]`/`verify-human --confirm` CLI surface, and legacy coexistence, all of which are sound and are built upon, not redesigned, below. They do **not** yet prove an agent moving through *several distinct, differently-configured workflow steps* in one deterministic run (e.g. `implementation -> review -> quality -> human-approval -> complete`) — `resolveCurrentStepName` (Task 06) explicitly assumes exactly one step exists. Tasks 08-13 (added by this correction, then hardened twice more after further review found first five, then six more, identity/versioning/cardinality/validation gaps, then corrected a fourth time — D37 — to add a runtime `active`/`completed` step-state axis so `step finish` no longer immediately advances `current_step`) close that gap: owner-approved, Git-tracked multi-step progress with an explicit, unambiguous terminal/completed precedence (D18/D19/D28, position resolution corrected by D37 to no longer consult `task.status`), step-aware finish-operation identity (D23) and step/gate-scoped human-verification identity backed by an extended trusted query contract (D24/D29) so one step's or gate's state can never be mistaken for another's, fail-closed resolution of configured actions/gates (D20), workflow-definition versions compared as their effective (not raw) value (D26), exactly-one-transition-per-step with a real-status-only terminal target and an explicit entry step (D27, D19 refined — the internal-transition write itself corrected by D37 to no longer move `current_step` at `finish` time), safe/unique step and gate identifiers validated at schema time (D30), a declarative per-step behavior contract (D25) and the task-level `StepContext` knowledge/hint fields the original design already called for but Task 06 never implemented (D22), a runtime `active`/`completed` step-state axis making `step start` the sole point that advances `current_step` (Task 10, D37), a production-quality multi-step `standard` definition gated on explicit owner approval of its step decomposition (Task 11, D31), and a real multi-step end-to-end proof (Task 13). The change is **not** complete merely because Tasks 01-07 are implemented.

## Goal

Provide a robust, modular foundation for migrating Nevo from agent-orchestrated semi-deterministic workflows to CLI-driven deterministic workflows using configurable declarative workflow definitions, composable actions, non-mutating checks, structured parameter schemas, factual runtime context, deterministic gates with separate inspection and execution, explicit machine-readable human verification, and fail-closed file selection, while preserving legacy flow compatibility.

## Non-goals

- Full migration of all four specification workflows in this specification (the engine supports all four classes, but only one vertical path is proven end-to-end here).
- Removing existing semi-deterministic CLI commands or task lifecycle commands (they remain operational; see D16's migration map for what's superseded, not removed).
- Rewriting all agent skills or Claude/Cursor command adapters in this change.
- Automatic migration or rewriting of existing active/archived specification files.
- Full GitHub/GitLab PR-automation abstraction, and any GitLab implementation, remain out of scope — but the minimal local-Git-plus-configurable-remote-provider boundary required by deterministic finalization (D12) is explicitly **in** scope, narrowing (not repeating) the earlier broader exclusion. Live chat session tracking remains deferred to a dedicated follow-up specification.
- Replacing Git wrappers with a complex third-party Git framework.
- Redesigning unrelated dashboard UI/UX or adding speculative plugin systems.
- Implementing an optional progress-checkpoint command (`workflow step save` / `workflow save-progress`, D17) — the source-control/action boundary is designed to support it later; the command itself is left for a follow-up specification.
- Batch execution (`batch-*`) is not given a deterministic-workflow equivalent in this foundation (D16).

## Classification

| Signal | Rating | Reason |
|---|---|---|
| Behavioral clarity | GREEN | Core contracts (`check`, `execute`, input schemas, gates, human verification state, workflow definition parser) are explicit and bounded. |
| Public surface impact | YELLOW | Introduces new internal workflow abstractions and CLI subcommands under `workflow` without breaking existing public CLI interfaces. |
| Package boundary impact | GREEN | All additions are contained within repository-local Node tooling under `tools/specs/workflow/`. |
| Blast radius | GREEN | Additive architecture; legacy specifications and existing lifecycle handlers run completely untouched. |
| Reversibility | GREEN | Additive design with explicit `workflow.mode` in manifest ensures zero impact on existing specifications. |

**Classification: T — Standard.** (This change establishes an incremental foundation and vertical proof-of-concept without forcing architectural migration across active workflows).

## Constraints

- **C1.** Legacy workflow commands (`start`, `complete`, `verify`, `approve`, `finalize`, `self-check`, `batch-*`) and specifications without explicit `workflow` configuration must continue to work unchanged with zero regressions.
- **C2.** The `--check` operation must be strictly non-mutating; it must never modify filesystem files, repository refs, Git index/worktree state, or manifest metadata.
- **C3.** Action parameter schemas (`requiredInputs`) must explicitly define name, type, required/optional flag, human-readable description, and allowed constraints; agents must not be forced to infer semantics from parameter names alone.
- **C4.** Action runtime context (`context`) must provide read-only facts (e.g. changed files, staged files, branch, existing commits) and remain strictly separated from required input definitions; action boundaries must be preserved in aggregated output.
- **C5.** Aggregated check outputs across multi-action steps must preserve distinct action boundaries and payloads; multiple actions must never be collapsed into an ambiguous flat bag of properties.
- **C6.** Action execution (`execute`) must fail closed: if required inputs are omitted or invalid, execution must immediately fail with an explicit precondition error rather than guessing or heuristic defaulting. Specifically, `commit-and-push` must require an explicit file selection (e.g. explicit `include` list or `include: "*"` with `exclude: [...]`) and must never fall back to committing all dirty files implicitly.
- **C7.** Gate inspection (`inspect`) must be non-mutating and must never automatically run expensive test suites or commands; gate execution (`verify`) must be an explicit, separate operation.
- **C8.** Human verification must be a first-class, machine-readable workflow state (`status: blocked`, `reason: human-verification-required`); an agent cannot self-satisfy or bypass a human verification gate.
- **C9.** Workflow definitions must be configurable and declarative (expressing steps, actions, entry/exit gates, and finalize actions), with support for the four specification classes (Standard, Architectural, Small, Exploratory).
- **C10.** Implementation must follow horizontal slices: all new workflow infrastructure lives in cohesive modules under `tools/specs/workflow/` with dedicated unit and integration tests; existing large command files must not grow into larger god objects.
- **C11.** `workflow step start` must return a compiled `StepContext` (D10) aggregating action/gate contracts into one step-level payload — the agent must not be required to inspect individual actions to discover their input schemas. The finish contract exposed at start must be the same aggregation `step finish`/`step finish --check` later report (D10's consequence).
- **C12.** `workflow step finish --check` (or an equivalent dry-run form) must be strictly non-mutating (same invariant as C2). `workflow step finish` itself, called with missing required inputs, must return `status: "input-required"` plus the same factual planning payload without performing any mutation (D11) — a separate preflight call is never mandatory in the happy path.
- **C13.** Source control is a workflow capability, split into a local Git layer (repository/worktree state, changed/staged files, current branch, commit, push, and reconciliation facts such as "is commit X already on the configured remote branch") and a separately configured remote provider (currently `github` only), both built on the existing `tools/lib/git.mjs`/`tools/lib/github.mjs` rather than new abstractions (D12). Configuration is hierarchical, not independent: `sourceControl.enabled` gates everything; `push` (meaningful only when `sourceControl.enabled: true`) controls whether commits are pushed; `remote.enabled`/`remote.provider` (meaningful only when `push: true`) controls whether provider-specific capability is available. The four valid combinations (no automation / local-commit-only / commit+push-no-provider / commit+push+provider) are enumerated in D12; `remote.enabled: true` with `sourceControl.push: false` is invalid and must be rejected as an explicit configuration validation error — never silently normalized to a different, unspecified configuration.
- **C14.** For a task-completing step, the progress commit must include both the agent's implementation and Nevo's own task/spec completion-state update — task metadata must never be left dirty immediately after a successful finalize (D13).
- **C15.** Every mutating multi-stage finish operation must be durably resumable: a stable `operationId`, a fixed per-stage status vocabulary (`pending`/`running`/`completed`/`failed`/`unknown`), and reconciliation of `unknown` external side effects against real state before retrying — never blind repetition of a completed side effect, and never a claim of full distributed-transaction semantics (D14). This durable record is workflow execution/runtime state and must be persisted outside Git-tracked specification metadata (`change.yaml`) — never as a field that must itself be committed for the operation it describes to be considered durable.
- **C16.** Push completion must persist achieved state, not just command invocation: the expected commit SHA alongside remote/branch/status, so "has this been pushed" is answerable deterministically at any later time (D15).
- **C17.** After a successful task-completing `workflow step finish` with source control enabled: (a) task/spec Git-tracked metadata reflects the completed state, (b) the implementation and that tracked metadata update are contained in the one progress commit (C14), (c) the expected commit is confirmed on the configured remote when push is enabled (C16), and (d) the Git worktree is not left dirty solely because Nevo updated its own internal finish-operation bookkeeping after the commit — that bookkeeping is runtime-only state (C15/D14) and never itself produces a Git-visible change.
- **C18.** A mutating stage found in `running` state during recovery is never trusted at face value and never blindly reset to `pending` — it is always reconciled first, using persisted pre-mutation intent (D14's `update-task`/`commit` intent, D15's `push` `expectedSha`) plus real current state, exactly like an `unknown` stage. When reconciliation cannot prove the outcome either way, the stage is reported as `unknown` and the operation blocks for reconciliation rather than guessing or repeating the side effect.
- **C19.** The caller's resolved finish inputs (`commit.title`/`commit.message`/`include`/`exclude`, or the applicable subset) are persisted into the operation record once, before the first mutating stage executes. A resumed `workflow step finish` for an existing in-flight operation uses these persisted inputs without requiring resupply; supplying inputs that conflict with what is already persisted for that `operationId` is a deterministic, reported error — never a silent substitution of the operation's established intent (D14).
- **C20.** A workflow definition step that references an action id with no registered `ActionContract`, or a gate configuration whose type has no registered `GateContract`, must fail closed with an explicit, reported error at load/resolution time — never silently drop the reference and proceed with a smaller, different workflow than the one declared (D20).
- **C21.** A task's current position within a multi-step workflow definition is durable, deterministic, cross-session state — persisted as `workflow_progress` on the task's `change.yaml` entry, distinct from and never overloading the task's legacy lifecycle `status` (D18). It is written in the same progress commit as the implementation and any terminal `status` change (C14's existing invariant, generalized), via one atomic, store-owned mutation (D32) rather than two independent writes. `workflow_progress` is valid only on a `workflow.mode: deterministic` change — its presence on any other change is an explicit, fail-closed validation error, never a silently-ignored or silently-accepted field (D18's consequence).
- **C22.** *(Corrected by D37 — see below.)* A step transition's `to` value is resolved against the workflow definition's own declared step names first: a match is the **internal case** — `workflow step finish` does **not** advance `workflow_progress.current_step`; it sets `workflow_progress.state = completed` on the step that just finished and appends a `history` entry recording `transitioned_to: <to>` (task `status` unchanged). `current_step` only advances to `<to>` on the *next* `workflow step start` call, which also sets `state = active` on it (D37; see C29). No match is the **terminal case**: `workflow step finish` atomically writes `task.status` to that value **and** `workflow_progress.state = completed` on the current step (`current_step` unchanged, naming the final step), in the one write — and the target must be a real member of the repository's canonical `TERMINAL_STATUSES` (`tools/specs/lifecycle-primitives.mjs`: `implemented`/`verified`/`archived`/`abandoned`) — **not** the broader `TASK_STATUSES` (which also includes non-terminal states like `draft`/`approved`/`in-implementation`, none of which a finalize transition may legitimately target). A `to` value that is neither a declared step name nor a `TERMINAL_STATUSES` member (a typo, or a non-terminal status like `approved`) is a definition validation error, never a value that reaches `setTaskStatus` (D19 refinement). A workflow definition must not declare a step whose name collides with a terminal status value used as a terminal transition target — this is a definition validation error, not a silently-ambiguous resolution. Every step declares exactly one `transitions` entry — zero or more than one is a definition validation error, never silently-truncated to index 0 (D27). A definition's entry step is named by an optional top-level `entryStep` field when present, falling back to the first declared `steps` key when absent (D27).
- **C23.** A durable finish-operation record (C15/D14) belongs to exactly one workflow step, identified by its own storage path — a `completed` record from one step must never be reachable from, or short-circuit, another step's finish resolution; retrying the same step resumes the same record, advancing to a different step resolves a distinct one, and a previous step's record is never deleted or overwritten by a later step's operation (D23).
- **C24.** A persisted human-verification sign-off is scoped to the exact configured gate it was given for — `change` + `task` + `step` + gate identity + required role — never reusable to silently satisfy a different, independently-configured human gate on the same task (D24). The trusted human-verification query contract itself (`HumanVerificationGate.inspect`/`.verify`, not just the persisted storage) must carry this full identity for the scoping to be reachable end-to-end — an extension a reader may ignore, but the gate must offer (D29).
- **C25.** A workflow step's behavior contract (`purpose`/`expectedWork`/`hints`) is structured, declarative data authored once in the workflow definition — never generated, inferred, or synthesized by engine code at runtime (D25, generalizing D22's task-level version of the same principle).
- **C26.** A change's *effective* workflow version (`resolveWorkflowMode(change).version` — not necessarily a raw `change.workflow.version` field, which the `workflow_mode: deterministic` shorthand manifest shape never has) must match its resolved workflow definition's own `version` before any step resolution proceeds — a mismatch is an explicit, fail-closed error, never a silent continuation against a possibly-incompatible definition (D26).
- **C27.** *(Corrected by D37 — no longer consults `task.status`; see below.)* Workflow position — and the semantic status derived from it — is resolved **only** from `(workflow_progress, definition)`; task lifecycle `status` is never read to determine current step or semantic status. Resolution: no `workflow_progress` → the workflow is `new` (never started); `state: active` → the named `current_step` is in progress, semantic status = that step's `status.active`; `state: completed` and that step's one transition names another declared step → done, awaiting the next `workflow step start`'s activation of the named target, semantic status = that step's `status.completed`; `state: completed` and that step's one transition is terminal → the workflow is complete, semantic status = that step's `status.completed`. `workflow_progress` is never cleared or nulled at terminal completion; `current_step`/`state` remain as historical evidence, inert to further resolution once the terminal case has fired — a completed task must never be indistinguishable from one that never started the workflow, which this state-first resolution guarantees structurally (D28's original goal, achieved by D37 without consulting `task.status`). Terminal `task.status` is still written atomically by `finish`'s terminal case, together with `workflow_progress.state = completed` (C14/D13), but remains the separate, independently-written, coarse repository lifecycle axis (`depends_on` satisfaction, `approve`, archival) — never read back for position resolution.
- **C28.** Every workflow-definition-declared step key, `entryStep` value, and step-name-shaped transition target, plus any gate's explicit `id`, must match a safe identifier pattern (`^[a-zA-Z0-9_-]+$`, non-empty, no path separators) — validated at definition-schema time, never sanitized ad hoc where a step-aware storage path is built. A step with more than one human-verification gate must give each an explicit, mutually distinct `id` — two human gates silently sharing a default identity is a definition validation error (D30).
- **C29.** *(D37.)* `workflow step start` is the sole operation that ever advances `workflow_progress.current_step`, and every mutation it performs is exactly one atomic `workflow_progress` write with no other durable side effect: no `workflow_progress` → persist `current_step: entryStep, state: active` (fresh); `state: active` → resume, return the existing `StepContext`, write nothing; `state: completed` and the step's transition names another step → persist `current_step: <target>, state: active`, appending no `history` entry (`history` records completions only, never activations); `state: completed` and the step's transition is terminal → report the workflow complete, write nothing. Every step's declared `status: { active: <identifier>, completed: <identifier> }` (both required, safe identifiers, D30) is what `StepContext.semanticStatus` resolves to for its `runtimeState` — never a separately persisted third field (C21 extended, not duplicated).

## Affected Areas

- **Manifest Schemas & Validation:** `tools/specs/validation.mjs`, `tools/specs/service.mjs`, `change.yaml` schema updates for `workflow` mode/version/definition only — the durable finish-operation record is explicitly **not** a manifest field (D14 correction); no new `change.yaml` schema is added for it.
- **Workflow Definitions & Loader:** Repository-local configuration in `.nevo-ai/workflows/` with loader/schema in `tools/specs/workflow/definitions/` and scaffolding templates in `tools/specs/workflow/templates/`; extended with the `sourceControl` capability configuration (D12).
- **Composable Actions:** `tools/specs/workflow/contracts.mjs`, `tools/specs/workflow/registry.mjs`, source-control action(s) in `tools/specs/workflow/actions/` built on `tools/lib/git.mjs`/`tools/lib/github.mjs`, `tools/specs/workflow/actions/verify-output.mjs`.
- **Deterministic Gates:** `tools/specs/workflow/gates/` implementing `GateContract` with `inspect` vs `verify` separation, `CommandGate`, `MarkdownGate`, and `HumanVerificationGate`.
- **Step Lifecycle Orchestration:** `tools/specs/workflow/step-runner.mjs` and successor modules compiling `StepContext` at start, non-mutating finish planning, and the durable/resumable finish operation (D10, D11, D14) — reusing `WorkflowEngine.checkStep`/`executeStep` (Task 03) rather than re-implementing aggregation.
- **Runtime Execution State:** `.nevo-ai-local/workflow-operations/<change>/<task>.json`, following the existing git-ignored local-storage convention already used by `tools/dashboard/server/ai/sessions/binding-service.mjs` (atomic temp-file-then-rename JSON writes) — reused as a pattern, not as a code dependency between `tools/specs/workflow/` and `tools/dashboard/`.
- **CLI Dispatch:** `tools/specs.mjs` integration delegating to the new workflow engine and exposing `workflow step start` / `workflow step finish [--check]` (D9, agent-facing) and `workflow verify-human <change> <task> --confirm` (operator-facing) as the complete public surface.
- **Test Infrastructure:** `tools/tests/` comprehensive test suites for contracts, engine, gates, actions, step start/finish, the operator human-verification command, durable-finish retry/reconciliation, and compatibility.
- **Multi-Step Workflow Orchestration (Tasks 08-13, D18-D37):** `tools/specs/validation.mjs` (new `workflow_progress` schema block, extended with `state`), `tools/specs/workflow/step-runner.mjs`/`step-context.mjs`/`finish-operation.mjs` (generalized step/transition resolution, fail-closed action/gate resolution, step-aware operation identity, knowledge/hint and step-contract fields, runtime `active`/`completed` state axis and the mutating `step start`, D37), `tools/specs/workflow/human-verification-store.mjs` (step/gate-scoped sign-off identity), `tools/specs/workflow/cli.mjs` (version-compatibility guard, `--gate` disambiguation), `tools/specs/workflow/definitions/loader.mjs`/`schema.mjs` (load-time fail-closed action/gate validation, transition cardinality, `entryStep`, step-behavior-contract schema, per-step `status.active`/`status.completed` schema), `.nevo-ai/workflows/*.yaml` and matching templates (real multi-step Standard definition, `verify-task-output` removed, `status.active`/`status.completed` added to every shipped definition), `docs/development/workflow-engine.md` (updated). See `areas/multi-step-workflow-orchestration.md`.

## Proposed Architecture

### 1. Dual-Track Migration & Manifest Schema

To ensure backward compatibility and prevent cross-contamination between legacy and deterministic modes:
- `change.yaml` gains an optional `workflow` configuration object:
  ```yaml
  workflow:
    mode: deterministic  # 'legacy' | 'deterministic' (defaults to 'legacy' when omitted)
    version: 1
    definition: standard # optional definition reference (defaults to change type)
  ```
- The validator (`tools/specs/validation.mjs`) validates `workflow.mode` and `workflow.version` if present.
- `tools/specs/workflow/compatibility.mjs` resolves the effective workflow mode for any given change manifest.
- Existing specifications lacking `workflow` metadata run via legacy handlers, maintaining 100% backward compatibility.
- Temporary CLI flag `--deterministic-flow=true` is supported for CLI testing/development, but the manifest remains the authoritative source of truth.

### 2. Configurable Declarative Workflow Definitions

Workflow definitions declare the structure and lifecycle rules for a specification class in YAML:
```yaml
id: standard-v1
title: "Standard Specification Workflow"
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
- **Loader & Validator (`tools/specs/workflow/definitions/loader.mjs`):** Loads repository-local workflow definition files from `.nevo-ai/workflows/<name>.yaml`, validates steps, action IDs, and gate configurations. Unknown actions or gates trigger fail-closed validation errors.
- **Class Support:** Supports distinct definitions for `standard`, `architectural`, `small`, and `exploratory` classes under `.nevo-ai/workflows/` without code modifications.

### 3. Composable Action Model (`check` and `execute`)

Actions represent discrete units of work composed inside workflow steps. Each action implements `ActionContract`:
```javascript
export class ActionContract {
  get id() { /* string identifier */ }
  get description() { /* string */ }
  async check(context) { /* returns ActionCheckResult (non-mutating) */ }
  async execute(inputs, context) { /* returns ActionExecuteResult (fail-closed) */ }
}
```

#### Non-mutating `check(context)`
Introspects current state without mutating anything and returns:
- **`requiredInputs`**: Array of input parameter descriptors:
  ```json
  [
    {
      "name": "commit.title",
      "type": "string",
      "required": true,
      "description": "Conventional commit title describing the changes"
    },
    {
      "name": "include",
      "type": "array",
      "required": true,
      "description": "Explicit file paths or globs to stage and commit (e.g. ['*'] or ['src/**'])"
    }
  ]
  ```
- **`context`**: Factual runtime data relevant to parameter formulation:
  ```json
  {
    "changedFiles": ["src/index.js", "tests/index.test.js"],
    "stagedFiles": [],
    "branch": "feature/workflow-foundation",
    "baseBranch": "main",
    "existingCommits": []
  }
  ```

#### Fail-closed `execute(inputs, context)`
- Validates all supplied `inputs` against the action's input schema.
- Throws an explicit `PreconditionError` if required fields are missing or constraints are violated.
- **Fail-Closed File Selection for `commit-and-push`:** The caller must provide an explicit file selection (e.g. `include: ["src/index.js"]` or `include: ["*"]` with `exclude: [...]`). Execution will never guess or fall back to staging all dirty files implicitly.

### 4. Action Aggregation & Boundary Preservation

Workflow operations may compose multiple actions (e.g. `finalize: [verify-task-output, commit-and-push]`).
When an aggregated check is requested on a step, the engine invokes `check` on every action and constructs an aggregated result that strictly preserves action boundaries:
```json
{
  "step": "finalize",
  "ready": true,
  "actions": {
    "verify-task-output": {
      "actionId": "verify-task-output",
      "requiredInputs": [],
      "context": { "verifiedArtifacts": ["dist/bundle.js"] }
    },
    "commit-and-push": {
      "actionId": "commit-and-push",
      "requiredInputs": [
        { "name": "commit.title", "type": "string", "required": true, "description": "Commit title" },
        { "name": "include", "type": "array", "required": true, "description": "Explicit file selection" }
      ],
      "context": {
        "changedFiles": ["src/index.js"],
        "branch": "feature/workflow-foundation"
      }
    }
  }
}
```

### 5. Deterministic Gates with `inspect` vs `verify` Separation

Gates evaluate whether a workflow step can be exited without conflating read-only inspection with expensive execution:
```javascript
export class GateContract {
  get type() { /* 'command' | 'markdown' | 'human' */ }
  async inspect(config, context) { /* non-mutating inspection: returns status, scope, target, staleness WITHOUT running tests */ }
  async verify(config, context) { /* explicit execution: runs tests or validates artifacts and records result */ }
}
```

- **`CommandGate`**: Inspect returns target verification command (e.g. `action: "test"`), scope, and last known result without running tests. Verify executes the test runner and records the result.
- **`MarkdownGate`**: Validates the presence, structure, and completed checklist items of a markdown verification artifact (e.g. `verification.md`).
- **`HumanVerificationGate`**: Models explicit machine-readable human review. When human sign-off is required, the gate returns:
  ```json
  {
    "status": "blocked",
    "reason": "human-verification-required",
    "gateType": "human",
    "message": "Step 'implementation' requires explicit human verification",
    "signoff": { "requiredRole": "owner", "taskId": "04-source-control-capability" }
  }
  ```
  The workflow engine halts progression until explicit human confirmation is provided through an operator command (`node tools/specs.mjs workflow verify-human <change> <task> --confirm`).

### 6. Agent Interaction Model: `workflow step start` / `workflow step finish` (D9)

The normal agent flow is exactly two calls, with the runtime owning everything between them:
```text
workflow step start <change> [task]
...agent performs bounded work...
workflow step finish <change> [task]
```
The runtime resolves the current step from `change`/`task` state whenever it can do so unambiguously; an explicit step id remains available for diagnostics/manual override but is never required in the normal flow. The agent never discovers or orchestrates individual actions, gates, Git/`gh` commands, or transition rules — it supplies only the semantic inputs the workflow's finish contract asks for. Internal primitives (`WorkflowEngine.checkStep`/`executeStep`, gate `inspect`/`verify`) remain and are composed underneath this surface; they are not separately exposed as agent-facing commands (superseding the original `next-step`/`execute-step` design from this section before it was implemented).

**Agent-facing vs. operator-facing surface.** These two calls are the complete *agent*-facing surface. A separate, *operator*-facing surface exists for human sign-off and is never folded into the agent's orchestration:

```text
Agent-facing:     workflow step start <change> [task]
                   workflow step finish <change> [task] [--check]

Operator-facing:  workflow verify-human <change> <task> --confirm
```

When a `HumanVerificationGate` exit gate is unmet, `workflow step finish` reports it exactly like any other unmet exit gate — via that gate's `inspect()` status in the finish-planning payload (see section 8) — and stops there. It never waits for, performs, or bypasses the confirmation itself (C8). Only the explicit operator command can satisfy it; only after that does a subsequent `workflow step finish` proceed past that gate. Task 07's vertical PoC exercises this full terminal-only sequence — `step start` → work → `step finish` (blocked) → `verify-human --confirm` → `step finish` (completes) — using only these public CLI commands.

### 7. `workflow step start` — Compiled `StepContext` (D10)

```text
node tools/specs.mjs workflow step start <change> [task]
```
Returns a compiled `StepContext` aggregating everything the agent needs to begin work, reusing `WorkflowEngine.checkStep`'s action/gate aggregation (Task 03) rather than a second implementation:
```json
{
  "change": "deterministic-workflow-foundation",
  "task": "06-step-orchestration-and-next-step-service",
  "workflowMode": "deterministic",
  "currentStep": "implementation",
  "stepStatus": "in-progress",
  "instructions": "Implement within allowed_paths; entry gates already satisfied.",
  "entryState": { "blockers": [] },
  "expectedWork": { "allowedPaths": ["tools/specs/workflow/step-runner.mjs", "..."] },
  "context": { "changedFiles": [], "currentBranch": "feature/deterministic-workflow-foundation", "sourceControl": { "enabled": true } },
  "finishContract": {
    "requiredInputs": {
      "commit.title": { "type": "string", "required": true, "description": "Conventional commit title" },
      "commit.message": { "type": "string", "required": false, "description": "Extended commit body" }
    },
    "gates": [
      { "id": "test-suite", "type": "command" },
      { "id": "human-review", "type": "human" }
    ]
  },
  "nextStepGuidance": { "onSuccess": "verified" }
}
```
`finishContract.requiredInputs` is the same aggregation `workflow step finish`/`workflow step finish --check` report later (C11) — computed once, from the same source, not maintained twice. If source control is disabled, or a finalize action isn't part of the configured step, its inputs are simply absent from this aggregation.

### 8. `workflow step finish` — Non-Mutating Planning and `input-required` (D11)

```text
node tools/specs.mjs workflow step finish <change> [task] [--check]
```
`--check` is strictly non-mutating (C12, same invariant as action `check`/gate `inspect`) and reports the current concrete finish plan:
```json
{
  "status": "input-required",
  "requiredInputs": {
    "commit.title": { "required": true },
    "commit.message": { "required": false }
  },
  "sourceControl": {
    "changedFiles": ["tools/specs/workflow/step-runner.mjs"],
    "stagedFiles": [],
    "existingCommits": [],
    "currentBranch": "feature/deterministic-workflow-foundation",
    "unpushedCommits": []
  },
  "gates": [
    { "id": "test-suite", "type": "command", "status": "passed" },
    { "id": "human-review", "type": "human", "status": "blocked", "reason": "human-verification-required" }
  ],
  "plannedOperations": ["verify-gates", "update-task-status", "commit-progress", "push", "transition"],
  "blockers": ["human-verification-required"]
}
```
Calling `workflow step finish` directly (no `--check`) with every required input supplied completes the step in one call. Calling it with missing inputs returns this same `status: "input-required"` payload and performs zero mutation — `--check` is available for inspection/automation but is never mandatory in the happy path (C12).

### 9. Source Control as a Workflow Capability (D12)

Two layers, both built on the repository's existing infrastructure — no new Git or GitHub abstraction:

- **Local Git capability** (`tools/lib/git.mjs`, extended, not replaced): repository/worktree state, changed/staged files, current branch, relevant commits, commit, push, and a reconciliation primitive answering "is commit `X` already present on the configured remote branch."
- **Remote provider** (`tools/lib/github.mjs`, the repository's one existing GitHub integration): configured explicitly, used only for provider-specific capability when `remote.enabled` — GitHub is the only implemented provider; GitLab remains unimplemented, only the boundary for it exists.

Configuration (exact schema *location* is a Task 04 implementation detail; field semantics are fixed here):
```yaml
sourceControl:
  enabled: true
  push: true
  remote:
    enabled: true
    provider: github
```
This is hierarchical, not three independent flags (C13) — resolving the earlier ambiguity between `sourceControl.enabled` and a separate `git.enabled` by removing `git.enabled` entirely (it added no capability `sourceControl.enabled` didn't already gate):

| Case | Configuration | Meaning |
|---|---|---|
| No automation | `sourceControl.enabled: false` | No commit, no push, no remote operation; the commit/push action contributes no `requiredInputs`. |
| Local commit, no push | `enabled: true, push: false` | Commits are created; nothing is pushed. `remote.enabled` must be `false`/absent. |
| Commit + push, no provider | `enabled: true, push: true, remote.enabled: false` | Plain Git push; push-confirmation reconciliation uses pure Git (`ls-remote`/`rev-list`), no GitHub API call. |
| Commit + push + GitHub provider | `enabled: true, push: true, remote: { enabled: true, provider: github }` | Same as above, plus the GitHub-provider-specific capability boundary is available (no additional mutating operation is added by this foundation). |

`remote.enabled: true` with `push: false` is invalid and must be rejected with an explicit configuration validation error — never silently normalized to `remote.enabled: false` or any other reinterpretation.

### 10. Finalize Ordering and Durable, Resumable Finish Execution (D13, D14)

For a task-completing step, the externally visible order is fixed (C14):
```text
validate supplied inputs
→ verify required gates
→ perform/update task/spec completion state
→ commit the resulting implementation + Nevo metadata/status changes together
→ push when configured
→ confirm remote state
→ persist/complete workflow transition
→ return completed state + next step
```
The resulting progress commit always includes both the agent's work and Nevo's own task/spec status update — never a separate, later commit for metadata. The final `transition` stage (after push confirmation) is therefore a runtime-record/response-shaping step only — it never writes `change.yaml` a second time. The task/spec status change already happened and was already committed by the `update-task`/`commit` stages; `transition` marks the finish operation's own runtime record as fully complete and derives the `nextStepGuidance` to return — this is exactly what keeps C17's "clean worktree" invariant true even after this last stage runs.

Every mutating finish operation persists a durable record so a crash, timeout, lost response, or provider/network failure never forces blind repetition of a side effect (C15). This is a resumability foundation, not a distributed-transaction guarantee.

**This record is workflow execution/runtime state, not Git-tracked domain/specification state (D14).** It is persisted in Nevo's local runtime storage — `.nevo-ai-local/workflow-operations/<change>/<task>.json` — following the existing git-ignored local-storage convention already used by `tools/dashboard/server/ai/sessions/binding-service.mjs` (one JSON file per key, atomic temp-file-then-rename writes), reused as a *pattern*, not as a new code dependency from `tools/specs/workflow/` on `tools/dashboard/`. It is never written into `change.yaml` and never staged or committed. `change.yaml`'s existing `execution.suspension` block is a separate, unaffected, task-lifecycle-level concept (why the last attempted *action* stopped) — this new record is a distinct, more granular, finish-sequence-specific mechanism:
```json
{
  "operationId": "...",
  "change": "deterministic-workflow-foundation",
  "task": "06-step-orchestration-and-next-step-service",
  "step": "implementation",
  "status": "running",
  "resolvedInputs": {
    "commit.title": "...",
    "commit.message": "...",
    "include": ["..."],
    "exclude": []
  },
  "operations": [
    { "id": "verify-gates", "status": "completed" },
    { "id": "update-task", "status": "completed", "intent": { "fromState": "in-implementation", "toState": "implemented" } },
    { "id": "commit", "status": "completed", "intent": { "preCommitHead": "def456" }, "result": { "sha": "abc123" } },
    { "id": "push", "status": "unknown", "result": { "remote": "origin", "branch": "feature/foo", "expectedSha": "abc123" } },
    { "id": "transition", "status": "pending" }
  ]
}
```
Per-stage status is one of `pending` / `running` / `completed` / `failed` / `unknown`. On retry, Nevo loads the existing record and keeps every `completed` stage's side effect.

**Closing the crash window for a stage left `running` (C18).** `unknown` alone doesn't cover every crash scenario: a mutating stage can crash *after* its side effect happens and *before* the record is updated to `completed`, leaving it recorded as `running`. `running` found on recovery is **never** trusted at face value and **never** blindly reset to `pending` — it is always reconciled first, using persisted pre-mutation intent plus real current state, exactly like `unknown`:
- **`update-task`**: `intent.fromState`/`intent.toState` were persisted before the write. Current tracked state `== toState` → the write happened, mark `completed`; `== fromState` → it never happened, safe to (re)execute; anything else → ambiguous, report `unknown`, block for reconciliation rather than guess.
- **`commit`**: `intent.preCommitHead` was persisted before `git commit` ran (the exact file selection and message are already in `resolvedInputs`, not duplicated here). Current HEAD `== preCommitHead` → the commit never happened, safe to (re)execute; HEAD differs → call `tools/lib/git.mjs`'s `getCommitInfo(root, 'HEAD')` (Task 04) to read the current HEAD commit's `parentSha`/`subject`; `parentSha === preCommitHead` and `subject` matching `resolvedInputs['commit.title']` together prove HEAD is this operation's own commit — recover its SHA and mark `completed`; otherwise report `unknown` and block — **never create a second commit merely because the stage still says `running`.**
- **`push`**: unchanged model — `expectedSha` is itself the pre-push intent, already persisted before the `git push` call. A recovered `running` push is reconciled exactly like `unknown` (below) — no separate handling needed.
- **`transition`**: remains runtime-only and idempotent; nothing to reconcile beyond re-deriving the next-step response.

For example, a `push` left `unknown` (or a recovered `running`) is reconciled by checking whether the recorded commit SHA is already on the expected remote branch (via the Task 04 reconciliation primitive); if yes, `push` becomes `completed` and execution continues; if not, it becomes `pending` and the push is (re-)performed. A repeated `workflow step finish` after full success returns the already-completed result and current next step rather than repeating finalize actions.

**Resolved inputs are persisted once, before the first mutation (C19).** `resolvedInputs` is written into the record before `update-task` (the first mutating stage) executes. A resumed `workflow step finish` for an existing in-flight operation uses these persisted inputs — the agent/operator never needs to rediscover or resupply them after a crash; calling `step finish` with no inputs at all correctly resumes. Supplying inputs that conflict with what's already persisted for that `operationId` is a deterministic, reported error, never a silent substitution of the operation's established intent; supplying the same values again is a harmless no-op.

Push completion persists achieved state, not just invocation (C16, D15) — as part of this same runtime record, never inside `change.yaml`:
```json
{
  "commit": { "sha": "abc123", "status": "completed" },
  "push": { "remote": "origin", "branch": "feature/foo", "expectedSha": "abc123", "status": "completed" }
}
```

**Required invariant (C17):** after a successful task-completing `workflow step finish` with source control enabled:
- task/spec Git-tracked metadata (`change.yaml`) reflects the completed state,
- the implementation and that tracked metadata update are contained in the one progress commit,
- the expected commit is confirmed on the configured remote when push is enabled,
- the Git worktree is **not** left dirty solely because Nevo updated its own internal finish-operation bookkeeping after the commit — that bookkeeping is the runtime-only record above, and updating it after the commit produces no Git-visible change at all.

### 11. Legacy Lifecycle: Operational, Explicitly Superseded (D16)

Every legacy command listed in C1 keeps working unchanged. New agent workflows build on the deterministic step lifecycle rather than the legacy commands. The migration map (written into `docs/development/workflow-engine.md` by Task 07):

| Legacy concept | Deterministic replacement |
|---|---|
| `start` | `workflow step start` |
| `complete` / `finalize` | `workflow step finish` |
| `verify` / `self-check` | Configured exit gates (`verify`) |
| `approve` (human sign-off) | `HumanVerificationGate` |
| Legacy-orchestrated Git commit/push (`handleFinalize`/`handleArchive` calling `git.commitAll`/`git.push` directly) | Source-control finalize action (Task 04), sequenced per section 10 |
| `batch-*` | Not superseded in this foundation — out of scope |

Legacy code identified as removable in a future cleanup specification once migration is proven: the direct `git.commitAll`/`git.push` calls inside `handleFinalize`/`handleArchive` in `tools/specs.mjs`, and — much later — the legacy lifecycle handlers themselves once no active/future specification depends on `mode: legacy`.

### 12. Deferred Extension Point: Progress Checkpoint (D17)

Not implemented in this foundation. The source-control action boundary (section 9) is designed so a future, small `workflow step save` / `workflow save-progress` operation could commit/push (per source-control configuration) without requiring exit-gate satisfaction or a task-completion transition, reusing the same durable-operation mechanism from section 10. Left for a follow-up specification.

### 13. Horizontal Slice Directory Structure

All new components reside in small, single-responsibility modules under `tools/specs/workflow/`:
```text
tools/specs/workflow/
  contracts.mjs          # ActionContract, GateContract, schemas, types
  errors.mjs             # PreconditionError, GateBlockedError, WorkflowError
  compatibility.mjs      # Workflow mode resolution and legacy fallback
  registry.mjs           # Action and Gate registries
  engine.mjs             # Aggregated check runner and execution engine
  step-runner.mjs        # Step lifecycle evaluation and gate checking
  step-context.mjs       # Compiled StepContext at `step start` (D10)
  finish-operation.mjs   # Non-mutating finish planning + durable/resumable finish execution (D11, D14);
                         # persists its operation record to .nevo-ai-local/workflow-operations/, never change.yaml
  definitions/
    schema.mjs           # Workflow definition JSON/YAML schema (+ sourceControl config, D12)
    loader.mjs           # Definition loader, parser, and validator
    standard.yaml        # Standard workflow definition
  actions/
    index.mjs            # Built-in actions exporter
    commit-and-push.mjs  # Fail-closed source-control commit/push action (D12)
    verify-output.mjs    # Verification artifact check action
  gates/
    index.mjs            # Built-in gates exporter
    command-gate.mjs     # Command/test verification gate (inspect vs verify)
    markdown-gate.mjs    # Markdown artifact verification gate
    human-gate.mjs       # Machine-readable human verification gate
```

### 14. Remaining Scope: True Multi-Step Workflow Orchestration (D18-D37)

Tasks 01-07 prove one workflow step end-to-end; they do not prove a workflow *definition*
with several distinct steps actually driving an agent through all of them via repeated
`step start`/`step finish` cycles, because `resolveCurrentStepName` (Task 06) explicitly
assumes exactly one step exists and the current `.nevo-ai/workflows/standard.yaml`
declares only `implementation -> verified`. Detailed architecture, the fixture
definitions, and per-task acceptance criteria for closing this gap live in
`areas/multi-step-workflow-orchestration.md` (Tasks 08-13). Summary of what changes and
what does not:

**Built on top of, unchanged:** `ActionContract`/`GateContract` (sections 3, 5),
`inspect`/`verify` separation, fail-closed required inputs (C6), the `step
start`/`step finish [--check]` two-call surface (section 6), the durable finish
operation and per-stage reconciliation (section 10), the source-control capability
boundary (section 9), the operator-only `verify-human` command, and legacy coexistence
(section 11).

**Genuinely new:**
- **Persisted multi-step progress with an explicit runtime state axis (D18 approved/D19/
  D28, corrected by D37, C21/C22/C27/C29):** a `workflow_progress` field on the task's
  `change.yaml` entry, distinct from task lifecycle `status`, tracking which declared
  step a task is currently on **and** whether that step is `active` or `completed`
  (D37). A transition's `to` names either another declared step (internal — `finish`
  sets `state: completed` on the step that just finished and records
  `transitioned_to`; only the *next* `workflow step start` actually advances
  `current_step`) or a real, validated terminal lifecycle status (terminal — `finish`
  writes `task.status` and `state: completed` together, atomically). Position and
  semantic status are resolved *only* from `(workflow_progress, definition)` — `status`
  is never consulted for this — so a completed task can never look like a fresh one, and
  `workflow_progress` is never cleared — it remains as history.
- **Fail-closed definition/action/gate resolution (D20, C20):** every action id and gate
  type a workflow definition references must be registered, or loading/resolving it
  fails closed — no more silent filtering of unregistered references
  (`verify-task-output` is removed from `standard.yaml` rather than tolerated).
- **Step-aware finish-operation identity (D23, C23):** the durable finish-operation
  record is keyed by `(change, task, step)`, not just `(change, task)` — a completed
  record from one step can never be mistaken for another step already being done.
- **Step/gate-scoped human-verification identity, contract and storage (D24/D29,
  C24):** the trusted `HumanVerificationGate` query itself carries `changeId`/`taskId`/
  `stepId`/`gateId`, and the persisted sign-off is scoped to the exact
  `(change, task, step, gate, role)` it was given for — confirming one human gate never
  silently satisfies an unrelated one on the same task.
- **A declarative per-step behavior contract (D25, C25):** `purpose`/`expectedWork`/
  `hints`, authored once in the workflow definition, never generated by engine code —
  lets a "review" step and an "implementation" step present differently to the agent
  without either being hardcoded into the engine.
- **Fail-closed, effective workflow-definition version compatibility (D26 refined,
  C26):** `step start`/`step finish` reject a mismatch between a change's *effective*
  workflow version (`resolveWorkflowMode(change).version`) and its loaded definition's
  own `version`, rather than silently resolving against a possibly incompatible
  definition or wrongly demanding a raw manifest field the shorthand shape never has.
- **Explicit transition/entry-step model with real-terminal-status validation (D27, D19
  refined, C22):** exactly one `transitions` entry per step (no more silently-ignored
  entries after index 0), a terminal `to` value that must be a genuine member of
  `TERMINAL_STATUSES` — never a typo, and never a non-terminal status like `approved`
  or `in-implementation` — and an optional, explicit `entryStep` field (falling back to
  the first declared step when omitted).
- **Safe, unique step and gate identifiers (D30, C28):** every step key, `entryStep`
  value, and gate `id` is validated against a safe pattern at schema time; a step with
  more than one human gate must give each an explicit, distinct `id`.
- **`step start` becomes the sole activation point, mechanics (D37, C29, Task 10):**
  previously fully non-mutating (Task 08/D10); now one atomic `workflow_progress` write
  per call, gated by the four cases C29 defines (fresh/resume/activate-next/terminal) —
  no new durable multi-stage operation record, idempotent by construction. `finish`'s
  crash-reconciliation intent (D14/C18's `update-task` stage) correspondingly changes
  from comparing `current_step` values to comparing `workflow_progress.state`
  (`active`→safe-to-redo, `completed`→already-done) — `current_step == transitionTarget`
  is never used as a postcondition after this correction. D23's step-aware
  finish-operation record identity is unaffected (a finish operation still belongs to
  exactly one step, since `finish` no longer changes which step it belongs to).
- **A production-quality multi-step `standard.yaml`, gated on owner approval (D31):**
  replacing today's single-step placeholder with a real sequence of independently-gated
  steps, each with a real authored behavior contract and an explicit `entryStep` — the
  step decomposition itself is a product decision proposed and recorded via
  spec-refine, then explicitly approved, *before* Task 11 implements it — never
  implementer discretion.
- **`StepContext` knowledge/hint fields (D22) and step behavior contract (D25):**
  `instructions`/`expectedWork` (`allowed_paths`/`forbidden_paths`) and
  deterministically-sourced relevant-docs hints at the task level, plus the current
  step's own configured `stepContract`, plus the D37 `runtimeState`/`semanticStatus`
  fields, reusing existing context-packet/routing infrastructure — no free-form
  generated prose anywhere in this surface.
- **A real multi-step end-to-end CLI proof (Task 13):** at least three distinct steps,
  each with its own gates, proving persisted progress across steps (including the
  active/completed checkpoint between a step's completion and the next step's
  activation, D37), step-aware operation identity, step-scoped human-gate confirmation,
  a human gate blocking only its own configured step, version-mismatch fail-closure,
  retry/resume per step, and that swapping the fixture workflow definition changes the
  sequence without any engine code change.

## Implementation Decomposition

- **Task 01 — Declarative Workflow Definition Schema, Parser & Compatibility Model (`tasks/01-workflow-schema-and-compatibility.md`):**
  Add `workflow` manifest schema in `change.yaml`, definition loader and validator in `tools/specs/workflow/definitions/`, compatibility mode resolver in `tools/specs/workflow/compatibility.mjs`, and tests proving legacy specifications default cleanly to legacy mode.
- **Task 02 — Composable Action Contracts, Input Schema & Context Interfaces (`tasks/02-composable-actions-and-contracts.md`):**
  Implement `ActionContract`, `ActionCheckResult`, `ActionExecuteResult`, and parameter schema validator in `tools/specs/workflow/contracts.mjs` and `errors.mjs`.
- **Task 03 — Action Registry, Composition & Aggregated Check Engine (`tasks/03-action-registry-and-aggregated-checks.md`):**
  Implement `ActionRegistry` and the aggregated check engine in `tools/specs/workflow/registry.mjs` and `engine.mjs` ensuring strict action boundary preservation during multi-action step checks.
- **Task 04 — Source-Control Capability (`tasks/04-source-control-capability.md`, renamed from "Concrete Action Implementation: Fail-Closed `commit-and-push` Action"):**
  Implement the `sourceControl` configuration boundary — `enabled`/`push`/`remote` (D12) — extend `tools/lib/git.mjs` with a remote-reconciliation primitive, and implement the fail-closed commit/push action in `tools/specs/workflow/actions/commit-and-push.mjs` — explicit file selection (`include`/`exclude`), non-mutating check with Git context (including push/reconciliation facts), and a result shape carrying commit SHA and push status (D15) ready for Task 06's durable finish operation to persist.
- **Task 05 — Deterministic Gate Abstraction with Inspection/Verification Separation (`tasks/05-deterministic-gates-and-human-verification.md`):**
  Implement `GateContract` with separate `inspect(context)` and `verify(context)` methods, `CommandGate`, `MarkdownGate`, and `HumanVerificationGate` under `tools/specs/workflow/gates/`.
- **Task 06 — Step Lifecycle Orchestration: `StepContext`, Finish Planning & Durable Finish Execution (`tasks/06-step-orchestration-and-next-step-service.md`):**
  Implement the compiled `StepContext` at `step start` (D10), non-mutating finish planning with `input-required` support (D11), and the durable/resumable finish operation with reconciliation (D14) persisted to `.nevo-ai-local/workflow-operations/<change>/<task>.json` (never `change.yaml`) — sequencing task/spec completion-state update before the progress commit (D13), persisting per-stage intent/pre-state and resolved finish inputs before each mutation so a stage found `running` on recovery is reconciled rather than blindly retried or reset (C18/C19), and satisfying C17 (a clean tracked repository state plus a completed runtime operation state at the end of a successful finish).
- **Task 07 — CLI Integration, `step start`/`step finish` Vertical PoC & Coexistence Verification (`tasks/07-cli-integration-and-vertical-poc.md`):**
  Integrate `workflow step start` / `workflow step finish [--check]` (D9, agent-facing) and `workflow verify-human <change> <task> --confirm` (operator-facing) into `tools/specs.mjs`, prove the full finalize flow — including the terminal-only human-verification sequence (blocked → operator confirms → finish completes) — end-to-end using only public CLI commands, through gates → task/spec status update → commit → push → transition, including an interrupted-and-resumed retry, verify zero regressions across all legacy test suites, and write the legacy/deterministic migration map (D16) into `docs/development/workflow-engine.md`.
- **Task 08 — Multi-Step Workflow Engine Foundations (`tasks/08-multi-step-workflow-progression.md`):**
  Add the `workflow_progress` schema block to `change.yaml` (`tools/specs/validation.mjs`, fail-closed rejected on non-deterministic-mode changes), generalize step/transition resolution so `to` is checked against the definition's own step names before falling back to a terminal lifecycle-status write that must be a genuine `TERMINAL_STATUSES` member, never a typo or a non-terminal status (D18/D19), with an explicit terminal/completed precedence checked before `workflow_progress`/`entryStep` (D28), add the atomic `setTaskWorkflowState` helper to `tools/specs/store.mjs` so `status`/`workflow_progress` update together in one write (D32) and extend the `update-task` finalize stage's crash-window reconciliation (C18) to call it, make the durable finish-operation record step-aware (D23), extend `HumanVerificationGate`'s trusted query contract (`gates/human-gate.mjs`) and make the persisted human-verification sign-off step/gate-scoped (D29/D24), add schema support (validation only) for a per-step behavior contract (D25) and for safe/unique step and gate identifiers (D30), enforce fail-closed *effective* workflow-definition version compatibility (D26), and require exactly one transition per step plus an explicit optional `entryStep` field (D27) — all while keeping today's single-step `standard.yaml` and every Task 06/07 test passing unmodified.
- **Task 09 — Fail-Closed Workflow Definition/Action/Gate Resolution (`tasks/09-fail-closed-workflow-definition-resolution.md`):**
  Remove the tolerant unregistered-action filter from `step-context.mjs`, make `loadWorkflowDefinition` fail closed on any action id with no registered `ActionContract`, and remove `verify-task-output` from `.nevo-ai/workflows/standard.yaml` (D20).
- **Task 10 — Runtime `active`/`completed` Step-State Axis (`tasks/10-step-active-completed-lifecycle.md`, new — D37):**
  Add `workflow_progress.state`; make `workflow step start` the sole point that advances `current_step` (fresh/resume/activate-next/terminal cases); correct `finish`'s internal-transition case to set `state: completed` on the step that just finished instead of advancing `current_step`; correct position/semantic-status resolution to a pure function of `(workflow_progress, definition)` that no longer consults `task.status`; correct the `update-task` crash-reconciliation intent to compare `state` instead of `current_step`; add the required per-step `status: { active, completed }` schema field and migrate the four already-shipped one-step definitions/templates to declare it. Depends on Tasks 08 and 09; gates Task 11.
- **Task 11 — Production-Quality Multi-Step Standard Workflow Definition (`tasks/11-production-multi-step-standard-workflow.md`):**
  Design and ship a real multi-step `.nevo-ai/workflows/standard.yaml` and template, each step independently gated, each with a real authored `purpose`/`expectedWork`/`hints` behavior contract (D25) and an explicit `entryStep` (D27), implementing the three-step sequence (`implementation` -> `review` -> `human-verification` -> `verified`) proposed and approved per D31/D39, proving the schema/engine genuinely support N steps for the primary specification class.
- **Task 12 — `StepContext` Knowledge/Skill/File Hints & Step Behavior Contract (`tasks/12-step-context-knowledge-hints.md`):**
  Add the `instructions`/`expectedWork`/relevant-docs fields `overview.md` originally illustrated but Task 06 never implemented (D22), sourced deterministically from existing task-frontmatter and context-packet/routing infrastructure, and surface the current step's own configured `purpose`/`expectedWork`/`hints` behavior contract (D25) as `StepContext.stepContract`.
- **Task 13 — Real Multi-Step CLI/E2E Proof (`tasks/13-multi-step-workflow-e2e-proof.md`):**
  Prove, via CLI only, a fixture workflow definition with at least three distinct steps: persisted progress across steps with correct terminal precedence and the active/completed checkpoint (D28, D37), step-aware finish-operation identity (D23), step/gate-scoped human verification with safe/unique identifiers (D24/D30), a human gate blocking only its own step, fail-closed effective-version-mismatch rejection (D26), retry/resume semantics holding per step, no agent-side orchestration of transition rules, and reconfigurability without engine code changes.

## Acceptance Criteria & Verification

- `node tools/specs.mjs validate` and `node tools/specs.mjs check` pass with zero errors across all active and archived specifications.
- `tools/specs/workflow/` contains clean, modular horizontal slices with zero god-object expansion in `tools/specs.mjs`.
- Workflow definitions are declarative and validated against a schema; invalid/unknown actions or gates fail closed with explicit errors.
- Manifest validation allows optional `workflow: { mode: 'deterministic', version: 1 }` and rejects malformed workflow configurations.
- Unspecified manifests cleanly default to `mode: 'legacy'`.
- Action `--check` is verified to be 100% non-mutating across all filesystem, Git, and metadata state.
- Action `--check` returns explicit `requiredInputs` schemas and separate `context` facts.
- Aggregated checks on multi-action steps preserve action boundaries and data structures.
- Action execution strictly fails closed when required inputs are omitted or invalid; the source-control commit/push action strictly fails closed if explicit file selection is missing.
- Gate inspection (`inspect`) never executes verification commands; gate verification (`verify`) executes tests/checks explicitly.
- Human verification gate reliably blocks workflow progression with machine-readable `blocked` / `human-verification-required` status and cannot be bypassed.
- Command and Markdown gates correctly validate exit conditions.
- `workflow step start` returns a compiled `StepContext` (current step, task/spec identity, entry state/blockers, factual context, finish contract, next-step guidance) without requiring the agent to inspect individual actions (C11).
- `workflow step finish --check` is verified 100% non-mutating; `workflow step finish` with missing required inputs returns `input-required` with zero mutation (C12).
- The progress commit for a task-completing step includes both the implementation and the task/spec completion-state update — never a separate later commit for metadata (C14).
- A multi-stage finish operation is durably resumable: interrupting after task-metadata update, after commit creation, with an ambiguous push result, and after a successful push but before transition, each resume without duplicating a completed side effect (C15).
- A crash leaving a mutating stage recorded as `running` (not just `unknown`) is reconciled via persisted intent/pre-state before any retry — never blindly reset to `pending` and never repeated blindly (C18): `update-task` via `intent.fromState`/`toState` against current tracked state, `commit` via `intent.preCommitHead` plus `tools/lib/git.mjs`'s `getCommitInfo` against current HEAD's `parentSha`/`subject` (recovering the SHA only when provable, otherwise blocking rather than creating a second commit), and `push` via the existing `expectedSha` model.
- Resolved finish inputs are persisted once, before the first mutation, and a resumed `step finish` uses them without resupply; supplying conflicting inputs for an in-flight `operationId` is rejected deterministically rather than silently applied (C19).
- The finish-operation record lives in `.nevo-ai-local/workflow-operations/<change>/<task>.json`, never in `change.yaml`; `node tools/specs.mjs validate` requires no schema for it.
- Push completion state (`expectedSha`, remote, branch, status) is verified sufficient to answer "is this pushed" deterministically after an interruption (C16).
- After a successful task-completing `workflow step finish` with source control enabled, `git status` reports a clean worktree — no residual dirtiness from Nevo's own internal finish-operation bookkeeping (C17).
- The `sourceControl` configuration's four defined cases (no automation / local-commit-only / commit+push-no-provider / commit+push+provider) each behave as specified, and `remote.enabled: true` with `push: false` is rejected with an explicit configuration validation error, never silently normalized (D12 refinement).
- The vertical PoC's human-verification sequence — `step finish` reporting blocked, the operator `workflow verify-human --confirm` command satisfying the gate, and a subsequent `step finish` completing the remaining stages — is exercised end-to-end using only public CLI commands, without manual mutation of specification files or direct invocation of internal gate/action APIs.
- Vertical PoC (`step start` → work → `step finish`, including an interrupted-and-resumed retry) executes successfully under deterministic mode, and legacy specifications continue running unaffected (coexistence).
- `docs/development/workflow-engine.md` documents the engine architecture and the legacy/deterministic migration map (D16).
- Full test suite `node --test tools/tests/*.test.mjs` passes with zero failures.
- **Remaining scope (Tasks 08-13, added 2026-09-08, revised twice 2026-09-08, corrected 2026-09-11 — see D18-D37):**
  - A task's position within a multi-step workflow definition is durable, cross-session, Git-tracked state (`workflow_progress`), distinct from and never overloading task lifecycle `status` (C21, D18 owner-approved).
  - `workflow_progress` carries a runtime `state: active | completed` axis distinct from the step itself; `workflow step start` is the sole operation that ever advances `current_step` (fresh → entry step; an already-`active` step resumes with no mutation; a `completed` step whose transition names another step activates that step; a `completed` step whose transition is terminal reports the workflow already complete); `workflow step finish`'s internal-transition case sets `state: completed` on the step that just finished without moving `current_step` (D37).
  - Current-step/semantic-status resolution is a pure function of `(workflow_progress, definition)` alone — `task.status` is no longer consulted to determine workflow position (a completed task never looks fresh again because `state`/the step's terminal transition already disambiguate it), and `workflow_progress` is never cleared, only appended to on completion (C27, D28, corrected by D37).
  - A step transition's `to` resolves against the definition's own declared step names before falling back to a terminal lifecycle-status write that must be a genuine member of the repository's `TERMINAL_STATUSES` (never the broader `TASK_STATUSES` — `to: approved`/`to: in-implementation` are rejected exactly like a typo) — never reaching `task.status` otherwise; every step declares exactly one transition, and an optional explicit `entryStep` names the workflow's entry point; today's single-step `standard.yaml` behaves identically before and after this generalization (C22).
  - A workflow definition referencing an unregistered action id or gate type fails closed at load/resolution time — no configured action or gate silently disappears from execution (C20).
  - A durable finish-operation record belongs to exactly one workflow step (keyed by `(change, task, step)`) — a completed record from one step can never short-circuit another step's finish; the trusted human-verification query contract carries full `(change, task, step, gate)` identity, and a persisted sign-off is scoped to the exact `(change, task, step, gate, role)` it was given for — confirming one human gate never satisfies an unrelated one (C23/C24).
  - Every step key, `entryStep` value, and gate `id` is a safe, unique identifier, validated at schema time — a step with more than one human gate must give each an explicit, distinct `id` (C28).
  - A change's *effective* workflow version (not necessarily a raw manifest field) must match its resolved definition's own `version` before any step resolution proceeds — a mismatch fails closed with an explicit error (C26).
  - `.nevo-ai/workflows/standard.yaml` declares a real multi-step sequence — its exact step decomposition proposed, recorded, and explicitly owner-approved before implementation, never implementer discretion (D31) — each step independently gated, each with a real authored behavior contract (`purpose`/`expectedWork`/`hints`, C25) and an explicit `entryStep`, replacing today's single-step placeholder.
  - `StepContext` includes `instructions`/`expectedWork` (the task's own `allowed_paths`/`forbidden_paths`), deterministically-sourced relevant-docs hints, and the current step's own configured behavior contract (`stepContract`) — reusing existing context-packet/routing infrastructure rather than free-form generated prose anywhere in this surface.
  - A real, ≥3-step fixture workflow is proven end-to-end via CLI only: `step start` resolves each step in turn; finishing a step persists progress and the next `step start` resolves the next step; gates belong to their own configured step; step-aware operation identity means a later step's finish is never short-circuited by an earlier step's completed record; a human gate blocks only its own step, is confirmed independently of any other step's human gate via its own safe unique identifier, and only the operator command satisfies it; finishing the last step reports complete without ever re-resolving `entryStep`; an effective workflow-version mismatch fails closed; retry/resume semantics hold across individual steps, not just within one step's finalize sequence; no agent-side orchestration of transition rules; and swapping the fixture definition changes the sequence without any engine code change.
