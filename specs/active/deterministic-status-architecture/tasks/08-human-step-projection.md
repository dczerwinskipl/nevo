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
  - tools/specs/workflow/human-step/**
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
  decisions: [D5]
---

# Task: Human-step projection

## Goal

Build the human-step projection (D5): given a task's current step, return `null` or a
descriptor `{ step: { id, executor: 'human', purpose, expectedWork }, actions: [{ result,
label, feedbackRequired }], artifacts? }` — driven by `executor` and transition `action`
metadata, never by a literal step name or a `HumanVerificationGate`-shaped
`verification`/`decision` distinction.

## Dependencies

`workflow-definition-schema-extensions` — this projection reads `executor` and transition
`action` metadata directly.

## Implementation constraints

- New module (e.g. `tools/specs/workflow/human-step/projection.mjs`) exposing a function
  that, given a task's resolved current step (via `resolveWorkflowPosition` or equivalent),
  returns `null` when the step's `executor` is `agent` (defaulted or explicit) or the step
  is not currently active, and the descriptor above when `executor: human` and the step is
  active.
- `actions` is built directly from the current step's `transitions[].action` metadata — one
  entry per transition, `result` = the transition's `value`, `label`/`feedbackRequired` from
  its `action` metadata. No `kind: 'verification' | 'decision'` field or distinction is
  introduced — a single-action step and a multi-action step both use the same `actions`
  array shape.
- `artifacts` is present in the return type but always `undefined`/omitted in this task's
  implementation (extensibility point only, per D5/out-of-scope — no artifact/handover
  system built now).
- Must remain correctly distinct from `entryGates`/`exitGates` (`type: human`): an
  `executor: agent` step blocked on a gate returns `null` from this projection (it is not a
  human-owned active step) — do not read gate state as if it were executor state.
- Do not import `tools/specs/lifecycle-primitives.mjs`, `HumanVerificationGate`, or
  `FileHumanVerificationStore` — this projection reads only `workflow_progress` + the
  definition's `executor`/`action` metadata, independent of the gate engine.

## Acceptance criteria

- For a task whose current step has `executor: human` and is active, the projection returns
  a descriptor with the step's real `purpose`/`expectedWork` and one `actions` entry per
  transition. `automated: node --test tools/tests/human-step-projection.test.mjs`
- For a task whose current step has `executor: agent` (explicit or defaulted), the
  projection returns `null`, regardless of any `entryGate`/`exitGate` on that step (brief
  regression test #19's projection half; corrective-pass item 3/4).
  `automated: node --test tools/tests/human-step-projection.test.mjs`
- The projection returns the correct non-null result for a human-owned step whose id is not
  literally `human-verification` — proving the mechanism is executor-driven, not name-driven.
  `automated: node --test tools/tests/human-step-projection.test.mjs`
- A step with two transitions (e.g. `pass`/`fail`) produces two `actions` entries with the
  correct `label`/`feedbackRequired`; a step with one transition produces one.
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
projection that composes this (task `deterministic-task-projection`). Any artifact/handover
rendering.
