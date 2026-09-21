---
id: deterministic-status-architecture.workflow-continuation-schema
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/workflow-continuation-and-session-handover.md
    - specs/active/deterministic-status-architecture/areas/dependency-release-and-invalidation.md
    - specs/active/deterministic-status-architecture/areas/deterministic-batch-orchestrator.md
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
  decisions: [D25, D26, D28, D34, D39]
---

# Task: Workflow continuation schema

## Goal

Add the one consolidated schema extension D39 defines: per internal transition,
`continuation: auto | owner-action` (D25, renamed from `continueOnSuccess`),
`releasesDependencies: true` (D28), `execution: {session: reuse | fresh, role: <string>}`
(D26, meaningful only when `to` targets an `executor: agent` step); per step,
`schedulingPriority: <integer>` (D34). `normalizeWorkflowDefinition()` preserves all four
verbatim, following the exact pattern D6/D9's own schema task established for
`executor`/`action`/`outcome`. Migrate every internal transition in `standard`/`standard-v1`
(identical content) per the audited table below — not only `implementation → review`.

## Implementation constraints

- `definitions/schema.mjs`'s validation and `normalizeWorkflowDefinition()` both gain all
  four fields, in the same normalization pass `executor`/`action`/`outcome` already use — no
  second normalization code path.
- Defaults when absent: `continuation: 'owner-action'`, no `releasesDependencies` (`false`),
  no `execution` (agent step uses whatever default session/provider policy applies —
  `areas/workflow-continuation-and-session-handover.md`'s execution policy, not this schema),
  `schedulingPriority: 0`. Every existing definition file (including `standard`/`standard-v1`
  before this task's own migration) validates identically to today once these are added as
  optional fields.
- Cross-field validation: `continuation` and `releasesDependencies` are legal only on an
  *internal* transition (`to` targets another declared step, not a `TERMINAL_STATUSES`
  member) — a terminal transition already has `outcome` (D9) for the equivalent concept;
  reject either field on a terminal transition with a clear error. `execution` is legal only
  when the transition's `to` targets a step whose `executor` is `agent` — reject it (clear
  error) when `to` targets a human-owned or terminal destination.
- `schedulingPriority` is a step-level field (never a transition-level one) — validate it as
  an integer, default `0` when absent.
- **Full `standard.yaml`/`standard-v1.yaml` migration (audit every internal transition, not
  only `implementation → review`):**
  - `implementation`'s `to: review` → `continuation: auto`, `releasesDependencies: true`,
    `execution: {session: fresh, role: reviewer}`.
  - `review`'s `value: fail, to: implementation` → `continuation: auto`,
    `execution: {session: fresh, role: refiner}`.
  - `review`'s `value: pass, to: human-verification` → `continuation: auto` only (destination
    is human-owned — no `execution`).
  - `human-verification`'s `value: fail, to: implementation` (action.label "Request changes")
    → `continuation: auto`, `execution: {session: fresh, role: refiner}`.
  - `human-verification`'s `value: pass, to: verified` — terminal, unchanged (already has
    `outcome: success`) — no `continuation`/`execution`/`releasesDependencies`.
  - `review` step gains `schedulingPriority: 10`; `implementation`/`human-verification` keep
    the default (`0` — not written; `human-verification` isn't scheduled by the sequential
    queue at all since it's `executor: human`, but the field is harmless if inspected).

## Acceptance criteria

- Every one of the five existing `.nevo-ai/workflows/*.yaml` files still validates
  successfully via `node tools/specs.mjs validate` with zero behavior change for
  `architectural.yaml`/`exploratory.yaml`/`small.yaml`.
- `normalizeWorkflowDefinition()` preserves `continuation`, `releasesDependencies`,
  `execution`, and `schedulingPriority` verbatim onto its normalized output.
  `automated: node --test tools/tests/workflow-definitions-schema.test.mjs`
- `continuation`/`releasesDependencies` declared on a transition whose `to` targets a
  terminal status fails schema validation with a clear error.
  `automated: node --test tools/tests/workflow-definitions-schema.test.mjs`
- `execution` declared on a transition whose `to` targets a human-owned or terminal step
  fails schema validation with a clear error.
  `automated: node --test tools/tests/workflow-definitions-schema.test.mjs`
- `standard.yaml`/`standard-v1.yaml`'s four internal transitions each carry exactly the
  fields listed in the migration table above — proven by loading the normalized definition
  directly and asserting each transition's fields, not merely that the file parses.
  `automated: node --test tools/tests/workflow-definitions-schema.test.mjs`
- `review`'s `schedulingPriority` is `10`; `implementation`'s resolves to the default `0`.
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

The orchestrator that reads `continuation`/`execution` (`automatic-workflow-continuation`,
task 29). The sequential queue that reads `schedulingPriority` (`deterministic-batch-
orchestrator`, task 28). The dependency-satisfaction logic that reads `releasesDependencies`
(`dependency-release-and-invalidation`, task 27). Any migration of `architectural.yaml`/
`exploratory.yaml`/`small.yaml`.
