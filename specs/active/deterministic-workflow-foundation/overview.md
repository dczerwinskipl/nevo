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

This migration spans multiple stages:
- **Stage 1 (This Specification):** Build deterministic command, action, gate, and VCS synchronization foundations, contracts, check aggregation, fail-closed execution, and the vertical proofs (`commit-and-push`, `spec-publish-and-sync-pr`).
- **Stage 2:** Extend schemas and CLI commands while keeping existing semi-deterministic flows fully functional.
- **Stage 3:** Introduce declarative workflow definitions for the four specification classes (Standard, Architectural, Small, Exploratory).
- **Stage 4:** Update agent skills and behaviors to produce structured data required by deterministic workflows.
- **Stage 5:** Enable the deterministic workflow end-to-end.
- **Stage 6:** Direct agents to follow CLI-provided next steps rather than encoding process knowledge.
- **Stage 7:** Decommission obsolete semi-deterministic orchestration and legacy compatibility layers.

This specification delivers Stage 1 and the minimum necessary elements of Stage 2 to establish and prove the foundational abstractions without disrupting active workflows.

## Goal

Provide a robust, modular foundation for migrating Nevo from agent-orchestrated semi-deterministic workflows to CLI-driven deterministic workflows using composable actions, non-mutating checks, structured parameter schemas, factual runtime context, deterministic gates, explicit machine-readable human verification, and provider-neutral VCS synchronization, while preserving legacy flow compatibility.

## Non-goals

- Full migration of all four specification workflows in this specification.
- Removing existing semi-deterministic CLI commands or task lifecycle commands.
- Rewriting all agent skills or Claude/Cursor command adapters in this change.
- Automatic migration or rewriting of existing active/archived specification files.
- Replacing Git wrappers with a complex third-party Git framework.
- Redesigning unrelated dashboard UI/UX or adding speculative plugin systems.

## Classification

| Signal | Rating | Reason |
|---|---|---|
| Behavioral clarity | GREEN | Core contracts (`check`, `execute`, input schemas, gates, human verification state, VCS sync) are well-defined and grounded in repo patterns. |
| Public surface impact | RED | Introduces new workflow CLI subcommands, manifest workflow schemas, action/gate contracts, and step inspection outputs. |
| Package boundary impact | YELLOW | Introduces a dedicated `tools/specs/workflow/` domain layer without altering external package dependencies. |
| Blast radius | RED | Establishes the core execution foundation for all future Nevo workflows. |
| Reversibility | YELLOW | Additive design with explicit `workflow.mode` ensures legacy specs run untouched; new abstractions can be refined safely. |

**Classification: A — Architectural.**

## Constraints

- **C1.** Legacy workflow commands (`start`, `complete`, `verify`, `approve`, `finalize`, `self-check`, `batch-*`) and specifications without explicit `workflow` configuration must continue to work unchanged with zero regressions.
- **C2.** The `--check` operation must be strictly non-mutating; it must never modify filesystem files, repository refs, Git index/worktree state, or manifest metadata.
- **C3.** Action parameter schemas (`requiredInputs`) must explicitly define name, type, required/optional flag, human-readable description, and allowed constraints; agents must not be forced to infer semantics from parameter names alone.
- **C4.** Action runtime context (`context`) must provide read-only facts (e.g. changed files, staged files, branch, existing commits) and remain strictly separated from required input definitions.
- **C5.** Aggregated check outputs across multi-action steps must preserve distinct action boundaries and payloads; multiple actions must never be collapsed into an ambiguous flat bag of properties.
- **C6.** Action execution (`execute`) must fail closed: if required inputs are omitted or invalid, execution must immediately fail with an explicit precondition error rather than guessing or heuristic defaulting.
- **C7.** Human verification must be a first-class, machine-readable workflow state (`status: blocked`, `reason: human-verification-required`); an agent cannot self-satisfy or bypass a human verification gate.
- **C8.** Workflow engine abstractions must be agnostic to specific specification classes and support composing different steps, actions, and gates for Standard, Architectural, Small, and Exploratory workflows.
- **C9.** Implementation must follow horizontal slices: all new workflow infrastructure lives in cohesive modules under `tools/specs/workflow/` with dedicated unit and integration tests; existing large command files must not grow into larger god objects.
- **C10.** Tooling must use Node.js standard libraries and existing dependencies (`commander`, `yaml`); no new external dependencies may be introduced.
- **C11.** Version control and remote provider interactions must be provider-neutral (supporting GitHub, GitLab, git-local, or disabled/none) based on repository/manifest configuration; when PR creation is disabled or unsupported, the action performs local Git operations without failing.

## Affected Areas

- **Manifest Schemas & Validation:** `tools/specs/validation.mjs`, `tools/specs/service.mjs`, `change.yaml` schema updates for `workflow` mode and version.
- **Workflow Domain Architecture:** New `tools/specs/workflow/` module hierarchy containing contracts, registry, engine, runner, VCS adapters, and compatibility layers.
- **Composable Actions:** `tools/specs/workflow/contracts.mjs`, `tools/specs/workflow/registry.mjs`, `tools/specs/workflow/actions/commit-and-push.mjs`, `tools/specs/workflow/actions/spec-sync-pr.mjs`.
- **Deterministic Gates:** `tools/specs/workflow/gates/` implementing Command/Test gates, Markdown verification gates, and Human verification gates.
- **VCS & Remote Provider Integration:** `tools/specs/workflow/vcs/` implementing `GitHubVcsAdapter`, `GitLabVcsAdapter`, `GitLocalVcsAdapter`, and `NullVcsAdapter`.
- **Next-Step Service:** `tools/specs/workflow/next-step.mjs` resolving current step, available actions, gates, and valid transitions.
- **CLI Dispatch:** `tools/specs.mjs` integration delegating to the new workflow engine and exposing `--check`, `workflow next-step`, and `workflow spec-sync`.
- **Test Infrastructure:** `tools/tests/` comprehensive test suites for contracts, engine, gates, actions, VCS sync, next-step queries, and compatibility.

## Proposed Architecture

### 1. Dual-Track Migration & Manifest Schema

To ensure backward compatibility and prevent cross-contamination between legacy and deterministic modes:
- `change.yaml` gains an optional `workflow` configuration object:
  ```yaml
  workflow:
    mode: deterministic  # 'legacy' | 'deterministic' (defaults to 'legacy' when omitted)
    version: 1
  ```
- The validator (`tools/specs/validation.mjs`) validates `workflow.mode` and `workflow.version` if present.
- `tools/specs/workflow/compatibility.mjs` resolves the effective workflow mode for any given change manifest.
- Existing specifications lacking `workflow` metadata run via legacy handlers, maintaining 100% backward compatibility.
- Temporary CLI flag `--deterministic-flow=true` is supported for CLI testing/development, but the manifest remains the authoritative source of truth.

### 2. Composable Action Model (`check` and `execute`)

Actions represent distinct units of work composed inside workflow steps. Each action implements the `ActionContract`:
```javascript
export class ActionContract {
  get id() { /* string identifier */ }
  get description() { /* string */ }
  async check(context) { /* returns ActionCheckResult */ }
  async execute(inputs, context) { /* returns ActionExecuteResult */ }
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
      "required": false,
      "description": "Explicit file paths or globs to stage and commit"
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
- Executes the action's side effects (e.g. Git add/commit/push) deterministically.

### 3. Action Aggregation & Boundary Preservation

Workflow steps can declare multiple actions (e.g. `finalize: [verify-task-output, commit-and-push]`).
When an aggregated check is requested on a step, the engine invokes `check` on every action and constructs an aggregated result that preserves action boundaries:
```json
{
  "step": "finalize",
  "ready": true,
  "actions": [
    {
      "id": "verify-task-output",
      "requiredInputs": [],
      "context": { "verifiedArtifacts": ["dist/bundle.js"] }
    },
    {
      "id": "commit-and-push",
      "requiredInputs": [
        { "name": "commitMessage", "type": "string", "required": true, "description": "Commit message" }
      ],
      "context": {
        "changedFiles": ["src/index.js"],
        "branch": "feature/workflow-foundation"
      }
    }
  ]
}
```

### 4. Deterministic Gates & Explicit Human Verification

Gates evaluate whether a workflow step can be exited:
- **`CommandGate`**: Runs a logical verification command (e.g. `test`, `build`) via registered runner adapters rather than embedding raw shell strings across specifications.
- **`MarkdownGate`**: Validates the presence, structure, and approval status of a markdown verification artifact (e.g. `verification.md`).
- **`HumanVerificationGate`**: Models explicit machine-readable human review. When human sign-off is required, the gate returns:
  ```json
  {
    "status": "blocked",
    "reason": "human-verification-required",
    "message": "Step 'implementation.complete' requires explicit human verification",
    "signoff": { "type": "owner", "taskId": "04-concrete-action-commit-and-push" }
  }
  ```
The workflow engine halts progression until explicit human confirmation is provided through a dedicated CLI command.

### 5. Deterministic Next Step Query Service

Agents query the workflow engine to discover the exact state and next actions:
`node tools/specs.mjs workflow next-step <change> [task]`
Response:
```json
{
  "change": "deterministic-workflow-foundation",
  "task": "01-workflow-schema-and-compatibility",
  "currentStep": "implementation",
  "availableActions": ["check-status", "run-tests", "finalize-task"],
  "activeGates": [
    { "id": "tests-passing", "type": "command", "status": "passed" },
    { "id": "human-review", "type": "human", "status": "blocked", "reason": "human-verification-required" }
  ],
  "nextAllowedTransitions": ["complete"],
  "blockedReason": "human-verification-required"
}
```

### 6. Provider-Neutral VCS Settings & `spec-publish-and-sync-pr` Action

Automates the multi-step version control lifecycle (branch checkout -> stage -> commit -> push -> PR create -> PR attach to manifest -> push attachment) into a single deterministic command:
`node tools/specs.mjs workflow spec-sync <change>`
- Supports configurable VCS providers: `github`, `gitlab`, `git-local`, and `none`.
- Generates conventional commit messages and PR metadata directly from specification artifacts.
- When `vcs.provider` is `git-local` or `none`, performs local branching/commits without remote PR failures.

### 7. Vertical Proof-of-Concept: Multi-Step Finalize with `commit-and-push`

To prove the complete architecture in Stage 1:
- Implement `commit-and-push` action with full input schema and Git context generation.
- Combine with `CommandGate` (automated test suite) in a multi-step `finalize` workflow step.
- Verify `--check` produces non-mutating aggregated contracts.
- Verify fail-closed behavior on missing commit messages.
- Verify successful execution on valid inputs.
- Verify legacy `finalize` continues working without alteration.

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
  vcs/
    provider-adapter.mjs # Base VCS provider adapter interface
    github.mjs           # GitHub provider adapter (gh CLI / API)
    gitlab.mjs           # GitLab provider adapter
    git-local.mjs        # Git local-only adapter
    null-provider.mjs    # No-op provider adapter
    index.mjs            # VCS provider registry
  actions/
    index.mjs            # Built-in actions exporter
    commit-and-push.mjs  # Concrete commit-and-push action
    spec-sync-pr.mjs     # Deterministic spec publish and PR sync action
  gates/
    index.mjs            # Built-in gates exporter
    command-gate.mjs     # Command/test verification gate
    markdown-gate.mjs    # Markdown artifact verification gate
    human-gate.mjs       # Machine-readable human verification gate
```

## Implementation Decomposition

- **Task 01 — Workflow Schema, Mode Resolution & Legacy Compatibility Model (`tasks/01-workflow-schema-and-compatibility.md`):**
  Add `workflow` manifest schema in `change.yaml`, validation in `tools/specs/validation.mjs`, compatibility mode resolver in `tools/specs/workflow/compatibility.mjs`, and tests proving legacy specifications default cleanly to legacy mode.
- **Task 02 — Composable Action Contracts, Input Schema & Context Interfaces (`tasks/02-composable-actions-and-contracts.md`):**
  Implement `ActionContract`, `ActionCheckResult`, `ActionExecuteResult`, and input schema validator in `tools/specs/workflow/contracts.mjs` and `errors.mjs`.
- **Task 03 — Action Registry, Composition & Aggregated Check Engine (`tasks/03-action-registry-and-aggregated-checks.md`):**
  Implement `ActionRegistry` and the aggregated check engine in `tools/specs/workflow/registry.mjs` and `engine.mjs` ensuring strict action boundary preservation during multi-action step checks.
- **Task 04 — Concrete Action Implementation: `commit-and-push` Action (`tasks/04-concrete-action-commit-and-push.md`):**
  Implement `commit-and-push` action in `tools/specs/workflow/actions/commit-and-push.mjs` with non-mutating check returning parameter schemas (`commitMessage`, `include`, `exclude`) and runtime Git facts, plus fail-closed execution.
- **Task 05 — Deterministic Gate Abstraction & Gate Types (`tasks/05-deterministic-gates-and-human-verification.md`):**
  Implement `GateContract`, `CommandGate`, `MarkdownGate`, and `HumanVerificationGate` under `tools/specs/workflow/gates/`, providing explicit machine-readable `blocked` / `human-verification-required` state.
- **Task 06 — Deterministic Step Orchestration & "What Next" Inspection Service (`tasks/06-step-orchestration-and-next-step-service.md`):**
  Implement step orchestration in `tools/specs/workflow/step-runner.mjs` and next-step query service in `tools/specs/workflow/next-step.mjs` determining current step, available actions, gates, and valid transitions.
- **Task 07 — CLI Integration, Vertical Finalize PoC & Coexistence Verification (`tasks/07-cli-integration-and-vertical-poc.md`):**
  Integrate workflow commands and `--check` into `tools/specs.mjs`, prove the multi-step finalize flow with `commit-and-push` end-to-end, and verify zero regressions across all legacy test suites.
- **Task 08 — VCS Provider Settings & Spec Synchronization Action (`tasks/08-vcs-provider-settings-and-spec-sync.md`):**
  Implement provider-neutral VCS adapters (`tools/specs/workflow/vcs/`) and the `spec-publish-and-sync-pr` action automating branch creation, staging, committing, pushing, PR creation, and manifest attachment via `node tools/specs.mjs workflow spec-sync <change>`.

## Acceptance Criteria & Verification

- `node tools/specs.mjs validate` and `node tools/specs.mjs check` pass with zero errors across all active and archived specifications.
- `tools/specs/workflow/` contains clean, modular horizontal slices with zero god-object expansion in `tools/specs.mjs`.
- Manifest validation allows optional `workflow: { mode: 'deterministic', version: 1 }` and rejects malformed workflow configurations.
- Unspecified manifests cleanly default to `mode: 'legacy'`.
- Action `--check` is verified to be 100% non-mutating across all filesystem, Git, and metadata state.
- Action `--check` returns explicit `requiredInputs` schemas and separate `context` facts.
- Aggregated checks on multi-action steps preserve action boundaries and data structures.
- Action execution strictly fails closed when required inputs are omitted or invalid.
- Human verification gate reliably blocks workflow progression with machine-readable `blocked` / `human-verification-required` status and cannot be bypassed.
- Command and Markdown gates correctly validate exit conditions.
- VCS settings and `spec-publish-and-sync-pr` action execute the complete branch-commit-push-PR-attach sequence in a single deterministic command.
- `next-step` query provides complete deterministic guidance (current step, actions, gates, inputs, transitions) without agent heuristics.
- Vertical PoC (`finalize` step with `commit-and-push` and test gate) executes successfully under deterministic mode.
- Full test suite `node --test tools/tests/*.test.mjs` passes with zero failures.
