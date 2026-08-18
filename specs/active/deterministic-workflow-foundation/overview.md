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
- Removing existing semi-deterministic CLI commands or task lifecycle commands.
- Rewriting all agent skills or Claude/Cursor command adapters in this change.
- Automatic migration or rewriting of existing active/archived specification files.
- Implementing broad provider-neutral VCS abstractions (GitHub/GitLab PR automation) or live chat session tracking (deferred to dedicated follow-up specifications).
- Replacing Git wrappers with a complex third-party Git framework.
- Redesigning unrelated dashboard UI/UX or adding speculative plugin systems.

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

## Affected Areas

- **Manifest Schemas & Validation:** `tools/specs/validation.mjs`, `tools/specs/service.mjs`, `change.yaml` schema updates for `workflow` mode, version, and definition reference.
- **Workflow Definitions & Loader:** New `tools/specs/workflow/definitions/` containing declarative workflow schema, YAML loader, validator, and built-in definition configurations.
- **Composable Actions:** `tools/specs/workflow/contracts.mjs`, `tools/specs/workflow/registry.mjs`, `tools/specs/workflow/actions/commit-and-push.mjs`, `tools/specs/workflow/actions/verify-output.mjs`.
- **Deterministic Gates:** `tools/specs/workflow/gates/` implementing `GateContract` with `inspect` vs `verify` separation, `CommandGate`, `MarkdownGate`, and `HumanVerificationGate`.
- **Step Orchestration & Next-Step Service:** `tools/specs/workflow/step-runner.mjs` and `next-step.mjs` evaluating steps, actions, gates, and valid transitions.
- **CLI Dispatch:** `tools/specs.mjs` integration delegating to the new workflow engine and exposing `--check` and `workflow next-step` commands.
- **Test Infrastructure:** `tools/tests/` comprehensive test suites for contracts, engine, gates, actions, next-step queries, and compatibility.

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
- **Loader & Validator (`tools/specs/workflow/definitions/loader.mjs`):** Parses workflow definition files, validates steps, action IDs, and gate configurations. Unknown actions or gates trigger fail-closed validation errors.
- **Class Support:** Supports distinct definitions for `standard`, `architectural`, `small`, and `exploratory` classes without code modifications.

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
    "signoff": { "requiredRole": "owner", "taskId": "04-concrete-action-commit-and-push" }
  }
  ```
  The workflow engine halts progression until explicit human confirmation is provided through an operator command (`node tools/specs.mjs workflow verify-human <change> <task> --confirm`).

### 6. Deterministic Next Step Query Service

Agents query the workflow engine to discover the exact state and next actions:
`node tools/specs.mjs workflow next-step <change> [task]`
Response:
```json
{
  "change": "deterministic-workflow-foundation",
  "task": "01-workflow-schema-and-compatibility",
  "workflowMode": "deterministic",
  "currentStep": "implementation",
  "availableActions": ["implement-task", "finalize-task"],
  "gates": [
    { "id": "test-suite", "type": "command", "status": "passed" },
    { "id": "human-review", "type": "human", "status": "blocked", "reason": "human-verification-required" }
  ],
  "blockedReason": "human-verification-required",
  "nextAllowedTransitions": ["verify"],
  "recommendedCommand": "node tools/specs.mjs workflow execute-step deterministic-workflow-foundation 01-workflow-schema-and-compatibility finalize --inputs-file=inputs.json"
}
```

### 7. Vertical Proof-of-Concept: Implementation/Finalize Fragment

To prove the complete architecture in Stage 1:
```yaml
implementation:
  exitGates:
    - type: command
      action: test
    - type: human
      required: true
  finalize:
    - id: verify-task-output
    - id: commit-and-push
```
The PoC validates:
1. Workflow definition loading & validation,
2. Action discovery & composition,
3. Non-mutating action check,
4. Required input schemas & factual context,
5. Aggregated multi-action check,
6. Explicit execute inputs with fail-closed missing input rejection,
7. Gate inspection without automatically running verification tests,
8. Explicit test verification execution,
9. Explicit human verification blocker,
10. Markdown verification gate support,
11. Deterministic transition only after gates pass,
12. Coexistence with legacy flow.

### 8. Horizontal Slice Directory Structure

All new components reside in small, single-responsibility modules under `tools/specs/workflow/`:
```text
tools/specs/workflow/
  contracts.mjs          # ActionContract, GateContract, schemas, types
  errors.mjs             # PreconditionError, GateBlockedError, WorkflowError
  compatibility.mjs      # Workflow mode resolution and legacy fallback
  registry.mjs           # Action and Gate registries
  engine.mjs             # Aggregated check runner and execution engine
  step-runner.mjs        # Step lifecycle evaluation and gate checking
  next-step.mjs          # "What next?" query service
  definitions/
    schema.mjs           # Workflow definition JSON/YAML schema
    loader.mjs           # Definition loader, parser, and validator
    standard.yaml        # Standard workflow definition
  actions/
    index.mjs            # Built-in actions exporter
    commit-and-push.mjs  # Fail-closed commit-and-push action
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
- **Task 04 — Concrete Action Implementation: Fail-Closed `commit-and-push` Action (`tasks/04-concrete-action-commit-and-push.md`):**
  Implement fail-closed `commit-and-push` in `tools/specs/workflow/actions/commit-and-push.mjs` requiring explicit file selection (`include`/`exclude`), non-mutating check with Git context, and fail-closed execution.
- **Task 05 — Deterministic Gate Abstraction with Inspection/Verification Separation (`tasks/05-deterministic-gates-and-human-verification.md`):**
  Implement `GateContract` with separate `inspect(context)` and `verify(context)` methods, `CommandGate`, `MarkdownGate`, and `HumanVerificationGate` under `tools/specs/workflow/gates/`.
- **Task 06 — Deterministic Step Orchestration & "What Next" Inspection Service (`tasks/06-step-orchestration-and-next-step-service.md`):**
  Implement step orchestration in `tools/specs/workflow/step-runner.mjs` and next-step query service in `tools/specs/workflow/next-step.mjs` determining current step, available actions, gates, and valid transitions.
- **Task 07 — CLI Integration, Vertical Finalize PoC & Coexistence Verification (`tasks/07-cli-integration-and-vertical-poc.md`):**
  Integrate workflow commands and `--check` into `tools/specs.mjs`, prove the multi-step finalize flow with `commit-and-push` end-to-end, and verify zero regressions across all legacy test suites.

## Acceptance Criteria & Verification

- `node tools/specs.mjs validate` and `node tools/specs.mjs check` pass with zero errors across all active and archived specifications.
- `tools/specs/workflow/` contains clean, modular horizontal slices with zero god-object expansion in `tools/specs.mjs`.
- Workflow definitions are declarative and validated against a schema; invalid/unknown actions or gates fail closed with explicit errors.
- Manifest validation allows optional `workflow: { mode: 'deterministic', version: 1 }` and rejects malformed workflow configurations.
- Unspecified manifests cleanly default to `mode: 'legacy'`.
- Action `--check` is verified to be 100% non-mutating across all filesystem, Git, and metadata state.
- Action `--check` returns explicit `requiredInputs` schemas and separate `context` facts.
- Aggregated checks on multi-action steps preserve action boundaries and data structures.
- Action execution strictly fails closed when required inputs are omitted or invalid; `commit-and-push` strictly fails closed if explicit file selection is missing.
- Gate inspection (`inspect`) never executes verification commands; gate verification (`verify`) executes tests/checks explicitly.
- Human verification gate reliably blocks workflow progression with machine-readable `blocked` / `human-verification-required` status and cannot be bypassed.
- Command and Markdown gates correctly validate exit conditions.
- `next-step` query provides complete deterministic guidance (current step, actions, gates, inputs, transitions) without agent heuristics.
- Vertical PoC (`finalize` step with `commit-and-push` and test gate) executes successfully under deterministic mode.
- Full test suite `node --test tools/tests/*.test.mjs` passes with zero failures.
