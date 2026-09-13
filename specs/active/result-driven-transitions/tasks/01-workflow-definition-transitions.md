---
id: result-driven-transitions.workflow-definition-transitions
status: draft
change: result-driven-transitions
context:
  required:
    - specs/active/result-driven-transitions/overview.md
    - specs/active/result-driven-transitions/owner-decisions.md
    - specs/active/result-driven-transitions/areas/01-workflow-definitions-and-transitions.md
    - tools/specs/workflow/definitions/schema.mjs
    - tools/specs/workflow/definitions/loader.mjs
  optional:
    - docs/development/workflow-engine.md
    - docs/development/node-tooling-guidelines.md
allowed_paths:
  - tools/specs/workflow/definitions/schema.mjs
  - tools/specs/workflow/definitions/loader.mjs
  - tools/tests/workflow-definitions.test.mjs
  - tools/tests/workflow-compatibility.test.mjs
  - specs/active/result-driven-transitions/change.yaml
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D1]
  constraints: [C1, C2, C3, C4]
---

# Task: Declarative workflow definition schema and result-driven transition validation

## Goal

Update `tools/specs/workflow/definitions/schema.mjs` and `loader.mjs` to support both unconditional transitions and result-driven conditional transitions in workflow definitions. Enforce fail-closed validation against ambiguous, duplicate, or malformed transition definitions while preserving temporary operational compatibility for legacy workflows.

## Implementation constraints

- Allow a step's `transitions` to declare either:
  1. Exactly one unconditional transition (`{ to: string }`, where `value` is absent).
  2. Two or more result-driven transitions (`{ value: string, to: string }`, where `value` is present on every item).
- Reject ambiguous mixtures (e.g. one transition with `value` and one without).
- Reject single transitions with a `value` (unconditional steps must not require synthetic results).
- Validate that every `value` is a safe identifier matching `SAFE_IDENTIFIER_PATTERN` (`^[a-zA-Z0-9_-]+$`).
- Validate that `value` strings are mutually distinct within a step's `transitions`.
- Validate that every `to` target matches a declared step name in `definition.steps` or a member of `TERMINAL_STATUSES`.
- Update `normalizeWorkflowDefinition` to preserve transition `value` fields on normalized steps.
- Do not introduce backward-compatibility hacks or legacy aliases into the deterministic definition schema.

## Acceptance criteria

1. Workflow definition validator accepts steps with a single unconditional transition (`[{ to: 'review' }]`). `automated: node --test tools/tests/workflow-definitions.test.mjs`
2. Workflow definition validator accepts steps with multiple result-driven transitions (`[{ value: 'pass', to: 'human-verification' }, { value: 'fail', to: 'implementation' }]`). `automated: node --test tools/tests/workflow-definitions.test.mjs`
3. Workflow definition validator rejects steps with duplicate transition values (e.g. two transitions with `value: 'pass'`). `automated: node --test tools/tests/workflow-definitions.test.mjs`
4. Workflow definition validator rejects steps mixing conditional and unconditional transitions (e.g. one with `value` and one without). `automated: node --test tools/tests/workflow-definitions.test.mjs`
5. Workflow definition validator rejects transitions with unsafe values or invalid target step names. `automated: node --test tools/tests/workflow-definitions.test.mjs`
6. `normalizeWorkflowDefinition` outputs normalized transitions preserving `value` (when present) and `to`. `automated: node --test tools/tests/workflow-definitions.test.mjs`
7. Existing workflow compatibility tests pass and `node tools/specs.mjs check` passes with zero errors. `automated: node tools/specs.mjs check`

## Verification

```text
node --test tools/tests/workflow-definitions.test.mjs
node --test tools/tests/workflow-compatibility.test.mjs
node tools/specs.mjs check
```
