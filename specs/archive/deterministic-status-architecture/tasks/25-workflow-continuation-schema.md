---
id: deterministic-status-architecture.workflow-continuation-schema
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/workflow-continuation-and-session-handover.md
    - specs/active/deterministic-status-architecture/areas/dependency-release-and-invalidation.md
    - specs/active/deterministic-status-architecture/areas/deterministic-sequential-queue.md
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
  decisions: [D25, D26, D28, D34, D39, D40, D53]
---

# Task: Workflow continuation schema

## Goal

Add the consolidated schema extension D39/D40/D53 define: per internal transition,
`continuation: auto | owner-action` (D25), `releasesDependencies: true` (D28) **and its
symmetric counterpart** `invalidatesDependencyRelease: true` (D40 — mutually exclusive with
`releasesDependencies` on the same transition), `execution: {session: reuse | fresh, role:
<string>}` (D26, meaningful only when `to` targets an `executor: agent` step); per step,
`schedulingPriority: <integer>` (D34) **and** `consumesDependencies: true` (D53 — declares
which steps snapshot/consume upstream dependencies, so `dependency-release-and-invalidation`
(task 27) never needs a literal step-name check). `normalizeWorkflowDefinition()` preserves
all six fields verbatim, following the exact pattern D6/D9's own schema task established for
`executor`/`action`/`outcome`. Migrate every internal transition/step in `standard`/
`standard-v1` (identical content) per the audited table below.

## Implementation constraints

- `definitions/schema.mjs`'s validation and `normalizeWorkflowDefinition()` both gain all
  six fields, in the same normalization pass `executor`/`action`/`outcome` already use.
- Defaults when absent: `continuation: 'owner-action'`, no `releasesDependencies`/
  `invalidatesDependencyRelease` (both `false`), no `execution`, `schedulingPriority: 0`,
  `consumesDependencies: false`. Every existing definition file validates identically to
  today once these are added as optional fields.
- Cross-field validation: `continuation`, `releasesDependencies`, and
  `invalidatesDependencyRelease` are legal only on an *internal* transition (`to` targets
  another declared step, not a `TERMINAL_STATUSES` member) — reject any of them on a terminal
  transition with a clear error. **`releasesDependencies: true` and
  `invalidatesDependencyRelease: true` may never both be declared on the same transition** —
  reject with a clear error naming both fields if both are present. `execution` is legal only
  when `to` targets a step whose `executor` is `agent` — reject it on a human-owned or
  terminal destination.
- `schedulingPriority`/`consumesDependencies` are step-level only (never transition-level);
  `schedulingPriority` an integer defaulting to `0`, `consumesDependencies` a boolean
  defaulting to `false`.
- **Full `standard.yaml`/`standard-v1.yaml` migration — declares release, invalidation, and
  consumption points explicitly, no step-name inference:**
  - `implementation` step gains `consumesDependencies: true` (it performs the actual
    dependency-consuming work, on every attempt — first or rework).
  - `implementation`'s `to: review` → `continuation: auto`, `releasesDependencies: true`,
    `execution: {session: fresh, role: reviewer}`.
  - `review`'s `value: fail, to: implementation` → `continuation: auto`,
    `invalidatesDependencyRelease: true` (a failed review means the implementation just
    released needs rework), `execution: {session: fresh, role: refiner}`.
  - `review`'s `value: pass, to: human-verification` → `continuation: auto` only (destination
    is human-owned — no `execution`; passing review does not invalidate the release).
  - `human-verification`'s `value: fail, to: implementation` (action.label "Request changes")
    → `continuation: auto`, `invalidatesDependencyRelease: true` (same reasoning — a human
    found a problem with what was released), `execution: {session: fresh, role: refiner}`.
  - `human-verification`'s `value: pass, to: verified` — terminal, unchanged (already has
    `outcome: success`) — none of the five new fields.
  - `review` step gains `schedulingPriority: 10`; `implementation`/`human-verification` keep
    the default (`0`, not written). `review`/`human-verification` do **not** declare
    `consumesDependencies` (they consume no new upstream dependency).

## Acceptance criteria

- Every one of the five existing `.nevo-ai/workflows/*.yaml` files still validates
  successfully via `node tools/specs.mjs validate` with zero behavior change for
  `architectural.yaml`/`exploratory.yaml`/`small.yaml`.
- `normalizeWorkflowDefinition()` preserves `continuation`, `releasesDependencies`,
  `invalidatesDependencyRelease`, `execution`, `schedulingPriority`, and
  `consumesDependencies` verbatim onto its normalized output.
  `automated: node --test tools/tests/workflow-definitions-schema.test.mjs`
- `continuation`/`releasesDependencies`/`invalidatesDependencyRelease` declared on a
  transition whose `to` targets a terminal status each fail schema validation with a clear
  error.
  `automated: node --test tools/tests/workflow-definitions-schema.test.mjs`
- A transition declaring **both** `releasesDependencies: true` and
  `invalidatesDependencyRelease: true` fails schema validation with a clear error naming both
  fields.
  `automated: node --test tools/tests/workflow-definitions-schema.test.mjs`
- `execution` declared on a transition whose `to` targets a human-owned or terminal step
  fails schema validation with a clear error.
  `automated: node --test tools/tests/workflow-definitions-schema.test.mjs`
- `standard.yaml`/`standard-v1.yaml`'s four internal transitions each carry exactly the
  fields listed in the migration table above — proven by loading the normalized definition
  directly and asserting each transition's fields.
  `automated: node --test tools/tests/workflow-definitions-schema.test.mjs`
- `review`'s `schedulingPriority` is `10`; `implementation`'s resolves to the default `0`.
  `automated: node --test tools/tests/workflow-definitions-schema.test.mjs`
- `implementation`'s `consumesDependencies` resolves to `true`; `review`/`human-verification`
  resolve to the default `false`.
  `automated: node --test tools/tests/workflow-definitions-schema.test.mjs`
- Every existing workflow-engine test suite passes unchanged.
  `automated: node --test tools/tests/`

## Verification

```bash
node --test tools/tests/workflow-definitions-schema.test.mjs
node --test tools/tests/
node tools/specs.mjs validate
```

## Out of scope

The orchestrator that reads `continuation`/`execution` (`automatic-workflow-continuation`,
task 29). The sequential queue that reads `schedulingPriority`
(`deterministic-sequential-queue`, task 28). The dependency-satisfaction/epoch/consumption
logic that reads `releasesDependencies`/`invalidatesDependencyRelease`/
`consumesDependencies` (`dependency-release-and-invalidation`, task 27). Any migration of
`architectural.yaml`/`exploratory.yaml`/`small.yaml`.
