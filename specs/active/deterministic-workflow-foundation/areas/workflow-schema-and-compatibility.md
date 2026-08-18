# Area: Workflow Schema, Definitions, and Compatibility Model

## Purpose

Define the configurable declarative workflow definition architecture and the additive manifest metadata schema in `change.yaml`. Establish how workflow definitions declare steps, actions, entry/exit gates, and transitions for the four specification classes (Standard, Architectural, Small, Exploratory), while ensuring 100% backward compatibility with existing legacy specifications.

## Declarative Workflow Definition Schema

Workflow definitions are declarative YAML documents defining the steps, actions, gates, and transitions for a specification class:
```yaml
id: standard-v1
title: "Standard Specification Workflow"
type: standard
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

### Key Requirements:
1. **Definition Loader and Validator (`tools/specs/workflow/definitions/`):**
   - Parses workflow YAML definitions.
   - Validates that every declared action is registered in `ActionRegistry`.
   - Validates that every declared gate is registered in `GateRegistry`.
   - Invalid definitions or references to unknown actions/gates fail closed with descriptive validation errors.
2. **Support for Multiple Specification Classes:**
   - The engine is decoupled from any specific workflow sequence.
   - Standard, Architectural, Small, and Exploratory workflows are declared as distinct definition templates without changing orchestration code.
   - Reordering or composing new steps in a definition does not require modifying core engine logic.

## Manifest Schema Extension (`change.yaml`)

- `change.yaml` supports an optional top-level `workflow` section:
  ```yaml
  workflow:
    mode: deterministic    # 'legacy' | 'deterministic' (default: 'legacy')
    version: 1             # integer version number
    definition: standard   # optional definition reference (e.g. 'standard', 'architectural')
  ```
- Shorthand `workflow_mode: deterministic` is normalized cleanly to `{ mode: 'deterministic', version: 1 }`.
- If `workflow` is omitted, the specification defaults to `mode: legacy`.

## Compatibility and Mode Resolution (`tools/specs/workflow/compatibility.mjs`)

- Provide `resolveWorkflowMode(change, options)`:
  - Checks `options.forceDeterministic` / `options.deterministicFlow` (for local test overrides).
  - Checks `change.workflow?.mode` or `change.workflow_mode`.
  - Returns `{ mode: 'deterministic' | 'legacy', version: number, definition: string, isExplicit: boolean }`.
- Invariant: Existing commands (`start`, `complete`, `verify`, `approve`, `finalize`, `self-check`, `batch-*`) execute their legacy handlers when in `legacy` mode, guaranteeing zero regressions across existing active and archived specifications.
