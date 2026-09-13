---
id: result-driven-transitions.canonical-finish-contract-and-generic-cli-input
status: draft
change: result-driven-transitions
context:
  required:
    - specs/active/result-driven-transitions/overview.md
    - specs/active/result-driven-transitions/owner-decisions.md
    - specs/active/result-driven-transitions/areas/04-step-context-and-ai-protocol.md
    - specs/active/result-driven-transitions/areas/05-finish-execution-and-cli.md
    - tools/specs/workflow/step-context.mjs
    - tools/specs/workflow/cli.mjs
    - tools/specs.mjs
  optional:
    - docs/development/workflow-engine.md
    - docs/development/node-tooling-guidelines.md
allowed_paths:
  - tools/specs/workflow/step-context.mjs
  - tools/specs/workflow/cli.mjs
  - tools/specs.mjs
  - tools/tests/workflow-step-context.test.mjs
  - tools/tests/workflow-cli.test.mjs
  - specs/active/result-driven-transitions/change.yaml
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D3, D4]
  constraints: [C1, C11, C13, C14]
---

# Task: Canonical finish contract, AI protocol, and generic CLI input transport

## Goal

Unify `finishContract.parameters` in `tools/specs/workflow/step-context.mjs` as the single canonical schema for finish inputs directly preserving finalize action schemas, establish the authoritative AI protocol contract block, and implement the generic `--input <json>` and `--input-file <path>` CLI transport in `tools/specs/workflow/cli.mjs` and `tools/specs.mjs`. Enforce deterministic JSON parsing and schema validation while prohibiting obsolete parameter-specific CLI flags.

## Implementation constraints

- In `tools/specs/workflow/step-context.mjs`:
  - Build canonical `finishContract.parameters`:
    - Directly preserve finalize action parameter schemas from `ActionContract.check().requiredInputs`:
      - For `commit-and-push`: `commit.title` (type: 'string', required: true, minLength: 5), `commit.message` (type: 'string', required: false), `include` (type: 'array', items: { type: 'string' }, required: true), and `exclude` (type: 'array', items: { type: 'string' }, required: false).
      - No loss or reinterpretation of name, type, requiredness, constraints, or allowed values.
    - Compose workflow-level parameters into the same map:
      - `result`: for conditional steps, `{ type: 'enum', required: true, allowedValues: [...] }` exposing only the declared transition values for the current step. For unconditional steps, omit `result` (or set `{ type: 'none', required: false }`).
      - `artifacts`: `{ type: 'array', items: { type: 'string' }, required: false }` representing lightweight reference strings.
  - Omit internal destination routing (`to`) and `availableTransitions` from StepContext; AI agents only see `allowedValues` for `result`.
  - Compile the authoritative `protocol` block:
    ```javascript
    protocol: {
      authoritative: true,
      noDirectStateMutation: true,
      doNotInferNextStep: true,
      logicalCompletionPerAttempt: true,
      resumableFinish: true,
      stopOnHumanGate: true
    }
    ```
- In `tools/specs/workflow/cli.mjs` and `tools/specs.mjs`:
  - Support `--input <json>` and `--input-file <path>` for `workflow step finish`.
  - Enforce mutual exclusivity: specifying both `--input` and `--input-file` throws a usage error.
  - Parse input JSON; throw `INVALID_INPUT_JSON` if parsing fails.
  - Ensure parsed input is a non-null plain object.
  - Prohibit and reject obsolete flags (`--result`, `--title`, `--message`, `--artifact`, `--artifacts`, `--include`, `--exclude`) with explicit errors directing users to use `--input` or `--input-file`.
  - Validate parsed inputs against `finishContract.parameters`:
    - Reject unknown properties (`UNKNOWN_INPUT_PROPERTY`).
    - Verify presence of required fields (including action requirements such as `include` and `commit.title`).
    - Validate property types (e.g. `artifacts` must be array of strings).

## Acceptance criteria

1. `compileStepContext` includes canonical `finishContract.parameters` preserving finalize action schemas (e.g. required `include`, required `commit.title`, optional `commit.message`, optional `exclude`) and composing `result.allowedValues` matching the active step's declared transitions. `automated: node --test tools/tests/workflow-step-context.test.mjs`
2. `compileStepContext` does not expose destination step routing (`to`) or `availableTransitions` to the AI. `automated: node --test tools/tests/workflow-step-context.test.mjs`
3. `compileStepContext` emits the full authoritative `protocol` block. `automated: node --test tools/tests/workflow-step-context.test.mjs`
4. CLI accepts structured inputs via `--input '<json>'` and `--input-file <path>`. `automated: node --test tools/tests/workflow-cli.test.mjs`
5. CLI rejects invocation when both `--input` and `--input-file` are provided. `automated: node --test tools/tests/workflow-cli.test.mjs`
6. CLI rejects obsolete flags (`--result`, `--title`, etc.) with explicit error messages. `automated: node --test tools/tests/workflow-cli.test.mjs`
7. Schema validation rejects payloads with unknown properties, missing required action inputs (e.g. missing `include`), or invalid types. `automated: node --test tools/tests/workflow-cli.test.mjs`
8. All unit tests pass and `node tools/specs.mjs check` passes with zero errors. `automated: node tools/specs.mjs check`

## Verification

```text
node --test tools/tests/workflow-step-context.test.mjs
node --test tools/tests/workflow-cli.test.mjs
node tools/specs.mjs check
```
