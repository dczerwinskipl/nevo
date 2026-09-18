---
id: deterministic-status-architecture.human-interaction-projection
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/deterministic-projection-and-human-interaction.md
allowed_paths:
  - tools/specs/workflow/human-interaction/**
  - tools/specs/workflow/cli.mjs
  - tools/tests/human-interaction-projection.test.mjs
forbidden_paths:
  - tools/specs/approve/**
  - tools/specs/start/**
  - tools/specs/complete/**
  - tools/specs/verify/**
  - tools/dashboard/**
  - src/**
---

# Task: Human-interaction projection

## Goal

Build a backend projection describing pending human interaction for a task/step/attempt —
built on the existing, properly-scoped `HumanVerificationGate`/`FileHumanVerificationStore`
— so downstream consumers never need to check the literal step name `'human-verification'`.

## Implementation constraints

- New module (e.g. `tools/specs/workflow/human-interaction/projection.mjs`) exposing a
  function that, given a task's current workflow position, returns `null` (no pending
  interaction) or a descriptor shaped conceptually as `{ kind: 'verification' | 'decision',
  actions: [...] }` (`verification` → `confirm`; `decision` → `approve`/`request-changes`
  plus whether feedback is required) — exact field names are an implementation detail, the
  two `kind`s and their action sets are the contract other tasks depend on.
- Build this from the existing `HumanVerificationGate`'s scoping (task/step/gate id/attempt)
  and `FileHumanVerificationStore` reads — do not add a new persisted field or new store.
- Replace `handleWorkflowVerifyHuman`'s hardcoded `targetStep === 'human-verification'`
  check (`tools/specs/workflow/cli.mjs`) with a check against this projection's non-null
  result instead.
- Do not modify `HumanVerificationGate`'s or `FileHumanVerificationStore`'s own scoping/
  persistence logic — this task only adds a read projection layer in front of them.

## Acceptance criteria

- For a task/step with an active `HumanVerificationGate` whose config type is a decision
  gate, the projection returns `kind: 'decision'` with `approve`/`request-changes` actions.
  `automated: node --test tools/tests/human-interaction-projection.test.mjs`
- For a task/step with an active verification-only gate, the projection returns
  `kind: 'verification'` with a `confirm` action.
  `automated: node --test tools/tests/human-interaction-projection.test.mjs`
- For a task/step with no active gate, the projection returns `null`.
  `automated: node --test tools/tests/human-interaction-projection.test.mjs`
- The projection returns the correct non-null result for a gate attached to a step *not*
  literally named `human-verification` — proving the mechanism is gate-driven, not
  name-driven (brief regression test #19's backend half).
  `automated: node --test tools/tests/human-interaction-projection.test.mjs`
- `workflow verify-human --approve`/`--request-changes` now succeeds/fails based on this
  projection being non-null for the current step, not the literal step-name string.
  `automated: node --test tools/tests/workflow-cli.test.mjs`

## Verification

```bash
node --test tools/tests/human-interaction-projection.test.mjs
node --test tools/tests/workflow-cli.test.mjs
node --test tools/tests/workflow-human-verification.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Any redesign of `HumanVerificationGate`'s own engine, scoping, or persistence format. The
UI rendering of this projection (owned by `task-dialog-deterministic-projection`).
