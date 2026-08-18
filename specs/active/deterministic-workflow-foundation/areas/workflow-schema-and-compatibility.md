# Area: Workflow Schema and Compatibility Model

## Purpose

Define the additive manifest metadata schema in `change.yaml` that establishes whether a specification executes under the legacy semi-deterministic workflow or the new deterministic workflow engine. Provide backward compatibility, validation rules, mode resolution, and isolation between legacy and deterministic execution paths.

## Requirements

1. **Manifest Schema Extension:**
   - `change.yaml` supports an optional top-level `workflow` section:
     ```yaml
     workflow:
       mode: deterministic    # 'legacy' | 'deterministic'
       version: 1             # integer version number (defaults to 1 when mode is deterministic)
       definition: standard   # optional workflow definition reference (e.g. 'standard', 'architectural', 'small', 'exploratory')
     ```
   - If `workflow` is omitted or `workflow.mode` is omitted, the specification defaults to `mode: legacy`.
   - String shorthand `workflow_mode: deterministic` is also normalized cleanly to `{ mode: 'deterministic', version: 1 }`.

2. **Validation Rules (`tools/specs/validation.mjs`):**
   - If `workflow` is specified:
     - `workflow.mode` must be one of `'legacy'` or `'deterministic'`.
     - `workflow.version` (if present) must be a positive integer.
     - `workflow.definition` (if present) must be a non-empty string.
   - Any unrecognised `workflow.mode` value triggers a validation error naming the manifest path.
   - Missing `workflow` configuration is valid and causes no validation errors or warnings (preserving all existing active and archived specifications).

3. **Compatibility and Mode Resolution (`tools/specs/workflow/compatibility.mjs`):**
   - Provide `resolveWorkflowMode(change, options)`:
     - Checks `options.forceDeterministic` / `options.deterministicFlow` (CLI flag override for local testing).
     - Checks `change.workflow?.mode` or `change.workflow_mode`.
     - Returns `{ mode: 'deterministic' | 'legacy', version: number, isExplicit: boolean }`.
   - Invariant: A change manifest is the long-term source of truth. CLI commands must not accidentally evaluate half of a change in legacy mode and half in deterministic mode.

4. **Command Routing and Backward Compatibility:**
   - Existing commands (`start`, `complete`, `verify`, `approve`, `finalize`, `self-check`, `batch-*`) inspect the resolved workflow mode.
   - When in `legacy` mode, existing handlers execute completely unchanged without executing new deterministic gate pipelines.
   - When in `deterministic` mode, commands delegate to the new deterministic workflow engine and step runner.
