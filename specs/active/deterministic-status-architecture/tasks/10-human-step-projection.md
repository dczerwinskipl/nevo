---
id: deterministic-status-architecture.human-step-projection
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/deterministic-projection-and-human-step.md
    - specs/active/deterministic-status-architecture/owner-decisions.md
allowed_paths:
  - tools/specs/workflow/human-step/projection.mjs
  - tools/tests/human-step-projection.test.mjs
forbidden_paths:
  - tools/specs/approve/**
  - tools/specs/start/**
  - tools/specs/complete/**
  - tools/specs/verify/**
  - tools/specs/lifecycle-primitives.mjs
  - tools/dashboard/**
  - src/**
depends_on: [ workflow-definition-schema-extensions ]
semantic_references:
  decisions: [D5, D10]
---

# Task: Human-step projection

## Goal

Build the two-tier human-step projection (item 11): a generic current/next-step descriptor
available even before activation, and a separate human-interaction actions descriptor
available only once that step is genuinely active — driven by `executor` and transition
`action` metadata, never by a literal step name or a `HumanVerificationGate`-shaped
`verification`/`decision` distinction.

## Dependencies

`workflow-definition-schema-extensions` — this projection reads `executor` and transition
`action` metadata directly.

## Implementation constraints

- New module (e.g. `tools/specs/workflow/human-step/projection.mjs`) exposing two
  functions, kept structurally distinct (not merged into one optional-field blob):
  - A **generic step descriptor** function: given any step (current or next, active or
    not), returns `{ id, executor, purpose, expectedWork }` straight from the definition —
    no activation state required, no executor restriction (works for agent steps too, used
    generically by the canonical task projection's `waiting-for-step-start` case).
  - A **human interaction actions** function: given a task's *currently active* step,
    returns `null` when `executor !== 'human'`, else `{ actions: [{ result, label,
    feedbackRequired }], artifacts? }` built from that step's `transitions[].action`
    metadata (one entry per transition; `result` = the transition's `value`).
- `artifacts` is present in the return type but always `undefined`/omitted in this task's
  implementation (extensibility point only).
- Must remain correctly distinct from `entryGates`/`exitGates` (`type: human`): the
  human-interaction-actions function returns `null` for an `executor: agent` step
  regardless of any pending gate on it — gate state is a completely separate read, never
  consulted by this module.
- Do not import `tools/specs/lifecycle-primitives.mjs`, `HumanVerificationGate`, or
  `FileHumanVerificationStore` — this projection reads only the definition's `executor`/
  `purpose`/`expectedWork`/`action` metadata plus `workflow_progress`'s active-state facts.

## Acceptance criteria

- The generic step descriptor function returns the correct `{id, executor, purpose,
  expectedWork}` for both an agent and a human step, active or not.
  `automated: node --test tools/tests/human-step-projection.test.mjs`
- For a task whose current step has `executor: human` and is active, the human-interaction
  function returns a descriptor with one `actions` entry per transition, correct `label`/
  `feedbackRequired`. `automated: node --test tools/tests/human-step-projection.test.mjs`
- For a task whose current step has `executor: agent` (explicit or defaulted), the
  human-interaction function returns `null`, regardless of any `entryGate`/`exitGate` on
  that step (brief regression test #19's projection half; corrective-pass-1 item 3/4).
  `automated: node --test tools/tests/human-step-projection.test.mjs`
- For a task whose next step (not yet active) has `executor: human`, the generic descriptor
  function still returns its `purpose`/`expectedWork` — proving pre-activation metadata is
  available without requiring activation.
  `automated: node --test tools/tests/human-step-projection.test.mjs`
- The human-interaction function returns the correct non-null result for a human-owned step
  whose id is not literally `human-verification` — proving the mechanism is
  executor-driven, not name-driven.
  `automated: node --test tools/tests/human-step-projection.test.mjs`
- No file in this task's module references the literal string `'human-verification'`,
  `'owner-review'`, or `'acceptance'`, and no `HumanVerificationGate`/
  `FileHumanVerificationStore` import exists in this module.
  `inspection: confirm the module has no such literal-string references or gate-engine imports`

## Verification

```bash
node --test tools/tests/human-step-projection.test.mjs
node tools/specs.mjs validate
```

## Out of scope

`entryGates`/`exitGates`' own engine (unchanged, kept distinct). The canonical task
projection that composes both functions here (task `deterministic-task-projection`). Any
artifact/handover rendering. `startHumanStep`/`submitHumanStepResult` themselves (task
`human-step-execution-operations`) — this task only projects state, never mutates.
