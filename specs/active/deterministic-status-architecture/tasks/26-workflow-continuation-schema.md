---
id: deterministic-status-architecture.workflow-continuation-schema
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/workflow-continuation-and-session-handover.md
    - specs/active/deterministic-status-architecture/areas/dependency-release-and-invalidation.md
    - specs/active/deterministic-status-architecture/owner-decisions.md
allowed_paths:
  - .nevo-ai/workflows/standard.yaml
  - .nevo-ai/workflows/standard-v1.yaml
  - tools/specs/workflow/definitions/schema.mjs
  - tools/tests/workflow-definitions-schema.test.mjs
forbidden_paths:
  - .nevo-ai/workflows/architectural.yaml
  - .nevo-ai/workflows/exploratory.yaml
  - .nevo-ai/workflows/small.yaml
  - tools/specs/workflow/step-context.mjs
  - tools/specs/workflow/finish-operation.mjs
  - tools/dashboard/**
depends_on: []
semantic_references:
  decisions: [D25, D26, D28]
---

# Task: Workflow continuation schema

## Goal

Add three additive, individually-audited workflow-definition fields — a per-transition
`continueOnSuccess: auto | owner-action` (D25), a `sessionPolicy: reuse | fresh` (+ `role:
implementer | reviewer | refiner`, D26) on a step or its entering transition, and a
per-transition `releasesDependencies: true` (D28) — with `normalizeWorkflowDefinition()`
preserving all three onto the normalized shape, exactly as it already must for `executor`/
`action`/`outcome` (D6/D9). Only `standard`/`standard-v1` (identical content) are migrated in
this task, per the same individually-audited-migration discipline D6 established —
`architectural`/`exploratory`/`small` are unaffected and stay out of this task's
`allowed_paths`.

## Implementation constraints

- `definitions/schema.mjs`'s validation and `normalizeWorkflowDefinition()` both gain the
  three fields, following the exact pattern D6/D9's own schema task already established for
  `executor`/`action`/`outcome` — do not introduce a second normalization code path.
- Default when absent: `continueOnSuccess: 'owner-action'`, `sessionPolicy: 'reuse'`, no
  `releasesDependencies` (i.e. `false`) — every existing definition file (including
  `standard`/`standard-v1` before this task's own migration) validates identically to today
  once these are added as optional fields.
- `role` is only meaningful alongside `sessionPolicy: 'fresh'` — validate that a `role` value
  without `sessionPolicy: 'fresh'` is either rejected or explicitly ignored (pick one, document
  it in a schema comment; do not leave the interaction undefined).
- `releasesDependencies: true` is legal only on an *internal* (step-to-step) transition — a
  transition whose `to` targets a `TERMINAL_STATUSES` member must reject it (a terminal
  transition already has its own `outcome` field for the equivalent concept, D9) — cross-field
  validation, matching D6's own transition-level cross-field pattern (`action.label` required
  for `executor: human`).
- Migrate `standard.yaml`/`standard-v1.yaml`: set `continueOnSuccess: auto` and
  `releasesDependencies: true` on the `implementation → review` transition (the corrective
  pass's own worked example); set `sessionPolicy: fresh`, `role: reviewer` on the `review`
  step. Do not migrate any other transition/step beyond what this task's own audit
  (documented in this file's implementation notes) finds necessary — do not guess additional
  fields onto `human-verification`'s transitions beyond what D25–D28 actually require there.

## Acceptance criteria

- Every one of the five existing `.nevo-ai/workflows/*.yaml` files still validates
  successfully via `node tools/specs.mjs validate` with zero behavior change for
  `architectural.yaml`/`exploratory.yaml`/`small.yaml`.
- `normalizeWorkflowDefinition()` preserves `continueOnSuccess`, `sessionPolicy`, `role`, and
  `releasesDependencies` verbatim onto its normalized output — proven by a test loading each
  migrated field and asserting it survives normalization, mirroring the existing
  `executor`/`action`/`outcome` preservation tests.
  `automated: node --test tools/tests/workflow-definitions-schema.test.mjs`
- A `releasesDependencies: true` declared on a transition whose `to` targets a terminal
  status fails schema validation with a clear error.
  `automated: node --test tools/tests/workflow-definitions-schema.test.mjs`
- `standard.yaml`/`standard-v1.yaml`'s `implementation → review` transition carries
  `continueOnSuccess: auto` and `releasesDependencies: true`; the `review` step carries
  `sessionPolicy: fresh`/`role: reviewer` — proven by loading the normalized definition
  directly.
  `automated: node --test tools/tests/workflow-definitions-schema.test.mjs`
- Every existing workflow-engine test suite (`workflow-cli`, `workflow-finish-operation`,
  `workflow-step-context`, `deterministic-dependency-satisfaction`, human-step tests) passes
  unchanged.
  `automated: node --test tools/tests/`

## Verification

```bash
node --test tools/tests/workflow-definitions-schema.test.mjs
node --test tools/tests/
node tools/specs.mjs validate
```

## Out of scope

The orchestrator that reads `continueOnSuccess`/`sessionPolicy`/`role`
(`automatic-workflow-continuation`, task 27). The dependency-satisfaction logic that reads
`releasesDependencies` (`dependency-release-and-invalidation`, task 28). Any migration of
`architectural.yaml`/`exploratory.yaml`/`small.yaml`.
