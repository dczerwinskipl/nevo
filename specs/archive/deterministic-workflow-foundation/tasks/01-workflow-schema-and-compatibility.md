---
id: deterministic-workflow-foundation.workflow-schema-and-compatibility
status: draft
change: deterministic-workflow-foundation
context:
  required:
    - specs/active/deterministic-workflow-foundation/overview.md
    - specs/active/deterministic-workflow-foundation/owner-decisions.md
    - specs/active/deterministic-workflow-foundation/areas/workflow-schema-and-compatibility.md
    - tools/specs/service.mjs
    - tools/specs/validation.mjs
  optional:
    - docs/ai/specification-workflow.md
allowed_paths:
  - .nevo-ai/workflows/**
  - tools/specs/workflow/templates/**
  - tools/specs/workflow/definitions/**
  - tools/specs/workflow/compatibility.mjs
  - tools/specs/workflow/index.mjs
  - tools/specs/validation.mjs
  - tools/specs/service.mjs
  - tools/tests/workflow-compatibility.test.mjs
  - specs/active/deterministic-workflow-foundation/change.yaml
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D1, D6, D7]
  constraints: [C1, C8, C9, C10]
---

# Task: Declarative workflow definition schema, parser, and legacy compatibility model

## Goal

Introduce the repository-local declarative workflow definitions in `.nevo-ai/workflows/`, default templates in `tools/specs/workflow/templates/`, definition schema and YAML parser in `tools/specs/workflow/definitions/`, add the `workflow` manifest schema in `change.yaml`, validate workflow configuration in `tools/specs/validation.mjs`, implement workflow mode resolution in `tools/specs/workflow/compatibility.mjs`, and prove that legacy specifications continue running in legacy mode without regression.

## Implementation constraints

- Implement the workflow definition loader and validator in `tools/specs/workflow/definitions/loader.mjs`, resolving repository-local definitions from `.nevo-ai/workflows/<name>.yaml` without runtime fallback to templates.
- Do not break existing specifications in `specs/active/` or `specs/archive/`; manifests without explicit `workflow` configuration must cleanly default to `mode: 'legacy'`.
- Validate that `workflow.mode` (when present) is either `'legacy'` or `'deterministic'`, and that `workflow.version` is a positive integer.
- Create `tools/specs/workflow/compatibility.mjs` as a focused horizontal module with pure mode-resolution logic.
- Do not add any new npm dependencies.

## Acceptance criteria

1. Workflow definition loader parses YAML definitions declaring steps, actions, entry/exit gates, and transitions, rejecting unknown actions or malformed gate configs. `automated: node --test tools/tests/workflow-compatibility.test.mjs`
2. Manifest validation accepts `workflow: { mode: 'deterministic', version: 1 }` and shorthand `workflow_mode: deterministic` on change manifests. `automated: node --test tools/tests/workflow-compatibility.test.mjs`
3. Manifest validation rejects invalid `workflow.mode` values (e.g. `mode: 'magic'`) with a descriptive path-specific error message. `automated: node --test tools/tests/workflow-compatibility.test.mjs`
4. Manifests omitting `workflow` metadata cleanly resolve to `{ mode: 'legacy', version: 1, isExplicit: false }` with zero errors or warnings during `node tools/specs.mjs validate`. `automated: node --test tools/tests/workflow-compatibility.test.mjs`
5. `tools/specs/workflow/compatibility.mjs` provides `resolveWorkflowMode(change, options)` supporting testing overrides via `options.forceDeterministic` while defaulting to the manifest state. `automated: node --test tools/tests/workflow-compatibility.test.mjs`
6. `node tools/specs.mjs validate` and `node tools/specs.mjs check` pass with zero errors across all repository changes. `automated: node tools/specs.mjs check`

## Verification

```text
node --test tools/tests/workflow-compatibility.test.mjs
node tools/specs.mjs check
```
