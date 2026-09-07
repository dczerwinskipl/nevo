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
- **C13.** Source control is a workflow capability, split into a local Git layer (repository/worktree state, changed/staged files, current branch, commit, push, and reconciliation facts such as "is commit X already on the configured remote branch") and a separately configured remote provider (currently `github` only), both built on the existing `tools/lib/git.mjs`/`tools/lib/github.mjs` rather than new abstractions (D12). Source control, local push, and the remote provider must each be independently enable/disable-able.
- **C14.** For a task-completing step, the progress commit must include both the agent's implementation and Nevo's own task/spec completion-state update — task metadata must never be left dirty immediately after a successful finalize (D13).
- **C15.** Every mutating multi-stage finish operation must be durably resumable: a stable `operationId`, a fixed per-stage status vocabulary (`pending`/`running`/`completed`/`failed`/`unknown`), and reconciliation of `unknown` external side effects against real state before retrying — never blind repetition of a completed side effect, and never a claim of full distributed-transaction semantics (D14).
- **C16.** Push completion must persist achieved state, not just command invocation: the expected commit SHA alongside remote/branch/status, so "has this been pushed" is answerable deterministically at any later time (D15).

## Affected Areas

- **Manifest Schemas & Validation:** `tools/specs/validation.mjs`, `tools/specs/service.mjs`, `change.yaml` schema updates for `workflow` mode/version/definition, and the new `execution.finish_operation` block (D14).
- **Workflow Definitions & Loader:** Repository-local configuration in `.nevo-ai/workflows/` with loader/schema in `tools/specs/workflow/definitions/` and scaffolding templates in `tools/specs/workflow/templates/`; extended with the `sourceControl` capability configuration (D12).
- **Composable Actions:** `tools/specs/workflow/contracts.mjs`, `tools/specs/workflow/registry.mjs`, source-control action(s) in `tools/specs/workflow/actions/` built on `tools/lib/git.mjs`/`tools/lib/github.mjs`, `tools/specs/workflow/actions/verify-output.mjs`.
- **Deterministic Gates:** `tools/specs/workflow/gates/` implementing `GateContract` with `inspect` vs `verify` separation, `CommandGate`, `MarkdownGate`, and `HumanVerificationGate`.
- **Step Lifecycle Orchestration:** `tools/specs/workflow/step-runner.mjs` and successor modules compiling `StepContext` at start, non-mutating finish planning, and the durable/resumable finish operation (D10, D11, D14) — reusing `WorkflowEngine.checkStep`/`executeStep` (Task 03) rather than re-implementing aggregation.
- **CLI Dispatch:** `tools/specs.mjs` integration delegating to the new workflow engine and exposing `workflow step start` / `workflow step finish [--check]` (D9) as the agent-facing surface.
- **Test Infrastructure:** `tools/tests/` comprehensive test suites for contracts, engine, gates, actions, step start/finish, durable-finish retry/reconciliation, and compatibility.

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
      "name": "commitMessage",
      "type": "string",
      "required": true,
      "description": "Conventional commit message describing the changes"
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
        { "name": "commitMessage", "type": "string", "required": true, "description": "Commit message" },
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

Configuration (exact schema location is a Task 04 implementation detail; semantics are fixed here):
```yaml
sourceControl:
  enabled: true
  git:
    enabled: true
    push: true
  remote:
    enabled: true
    provider: github
```
Source control, local push, and the remote provider are each independently enable/disable-able (C13).

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
The resulting progress commit always includes both the agent's work and Nevo's own task/spec status update — never a separate, later commit for metadata.

Every mutating finish operation persists a durable record so a crash, timeout, lost response, or provider/network failure never forces blind repetition of a side effect (C15). This is a resumability foundation, not a distributed-transaction guarantee. Persisted alongside the existing `execution.suspension` block, orthogonal to task lifecycle status:
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
Per-stage status is one of `pending` / `running` / `completed` / `failed` / `unknown`. On retry, Nevo loads the existing record, keeps every `completed` stage's side effect, and reconciles any `unknown` stage against real state before deciding what still needs to run — e.g. a `push` left `unknown` is reconciled by checking whether the recorded commit SHA is already on the expected remote branch (via the Task 04 reconciliation primitive); if yes, `push` becomes `completed` and execution continues; if not, it becomes `pending` and the push is (re-)performed. A commit is never re-created once its SHA is known. A repeated `workflow step finish` after full success returns the already-completed result and current next step rather than repeating finalize actions.

Push completion persists achieved state, not just invocation (C16, D15):
```json
{
  "commit": { "sha": "abc123", "status": "completed" },
  "push": { "remote": "origin", "branch": "feature/foo", "expectedSha": "abc123", "status": "completed" }
}
```

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
  finish-operation.mjs   # Non-mutating finish planning + durable/resumable finish execution (D11, D14)
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

## Implementation Decomposition

- **Task 01 — Declarative Workflow Definition Schema, Parser & Compatibility Model (`tasks/01-workflow-schema-and-compatibility.md`):**
  Add `workflow` manifest schema in `change.yaml`, definition loader and validator in `tools/specs/workflow/definitions/`, compatibility mode resolver in `tools/specs/workflow/compatibility.mjs`, and tests proving legacy specifications default cleanly to legacy mode.
- **Task 02 — Composable Action Contracts, Input Schema & Context Interfaces (`tasks/02-composable-actions-and-contracts.md`):**
  Implement `ActionContract`, `ActionCheckResult`, `ActionExecuteResult`, and parameter schema validator in `tools/specs/workflow/contracts.mjs` and `errors.mjs`.
- **Task 03 — Action Registry, Composition & Aggregated Check Engine (`tasks/03-action-registry-and-aggregated-checks.md`):**
  Implement `ActionRegistry` and the aggregated check engine in `tools/specs/workflow/registry.mjs` and `engine.mjs` ensuring strict action boundary preservation during multi-action step checks.
- **Task 04 — Source-Control Capability (`tasks/04-source-control-capability.md`, renamed from "Concrete Action Implementation: Fail-Closed `commit-and-push` Action"):**
  Implement the `sourceControl`/`git`/`remote` configuration boundary (D12), extend `tools/lib/git.mjs` with a remote-reconciliation primitive, and implement the fail-closed commit/push action in `tools/specs/workflow/actions/commit-and-push.mjs` — explicit file selection (`include`/`exclude`), non-mutating check with Git context (including push/reconciliation facts), and a result shape carrying commit SHA and push status (D15) ready for Task 06's durable finish operation to persist.
- **Task 05 — Deterministic Gate Abstraction with Inspection/Verification Separation (`tasks/05-deterministic-gates-and-human-verification.md`):**
  Implement `GateContract` with separate `inspect(context)` and `verify(context)` methods, `CommandGate`, `MarkdownGate`, and `HumanVerificationGate` under `tools/specs/workflow/gates/`.
- **Task 06 — Step Lifecycle Orchestration: `StepContext`, Finish Planning & Durable Finish Execution (`tasks/06-step-orchestration-and-next-step-service.md`):**
  Implement the compiled `StepContext` at `step start` (D10), non-mutating finish planning with `input-required` support (D11), and the durable/resumable finish operation with `execution.finish_operation` persistence and reconciliation (D14) — sequencing task/spec completion-state update before the progress commit (D13), and extending `tools/specs/validation.mjs` with schema support for the new persisted block.
- **Task 07 — CLI Integration, `step start`/`step finish` Vertical PoC & Coexistence Verification (`tasks/07-cli-integration-and-vertical-poc.md`):**
  Integrate `workflow step start` / `workflow step finish [--check]` (D9) into `tools/specs.mjs`, prove the full finalize flow (gates → task/spec status update → commit → push → transition, including an interrupted-and-resumed retry) end-to-end, verify zero regressions across all legacy test suites, and write the legacy/deterministic migration map (D16) into `docs/development/workflow-engine.md`.

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
- Push completion state (`expectedSha`, remote, branch, status) is verified sufficient to answer "is this pushed" deterministically after an interruption (C16).
- Vertical PoC (`step start` → work → `step finish`, including an interrupted-and-resumed retry) executes successfully under deterministic mode, and legacy specifications continue running unaffected (coexistence).
- `docs/development/workflow-engine.md` documents the engine architecture and the legacy/deterministic migration map (D16).
- Full test suite `node --test tools/tests/*.test.mjs` passes with zero failures.
