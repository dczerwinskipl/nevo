---
id: human-verification-activity-producer
status: draft
change: ai-spec-history
context:
  required:
    - specs/active/ai-spec-history/overview.md
    - specs/active/ai-spec-history/areas/activity-producers-workflow-and-verification.md
    - tools/specs/activity/store.mjs
    - tools/specs/activity/actor-resolver.mjs
    - tools/specs/workflow/cli.mjs
    - tools/specs/workflow/human-verification-store.mjs
allowed_paths:
  - tools/specs/activity/producers/human-verification.mjs
  - tools/specs/workflow/cli.mjs
  - tools/tests/activity-human-verification-producer.test.mjs
forbidden_paths:
  - src/**
  - tools/dashboard/**
  - tools/specs/workflow/human-verification-store.mjs
  - tools/specs/workflow/human-step/operations.mjs
  - tools/specs/workflow/finish-operation.mjs
semantic_references:
  decisions: [D10, D12, D19]
  dependency_contracts: [activity-local-store, actor-resolver]
---

# Task: Human verification activity producer

## Dependencies

`activity-local-store`, `actor-resolver`.

## Goal

Emit a `human.verification.confirmed` activity specifically from the `HumanVerificationGate` confirmation
path (`workflow verify-human --confirm`), with a real resolved `user` actor (unlike the underlying signoff store,
which only persists a `role` string today) — from the CLI boundary that knows `spec_id` (D12).

## Requirements

- **Distinction between exit gates and human workflow steps (D19):**
  - `HumanVerificationGate` is a blocking exit gate on an arbitrary workflow step, evaluated during finish
    and confirmed explicitly via `workflow verify-human --confirm`. It emits `human.verification.confirmed`.
  - In contrast, first-class human workflow steps (`executor: human`) are regular steps whose lifecycle
    activities (`workflow.step.started` and `workflow.step.completed`) are owned by task 06.
    Task 07 strictly owns the exit gate confirmation activity.
- `tools/specs/activity/producers/human-verification.mjs`: owns the
  `human.verification.confirmed` type constant and its `data` contract (`{ scope,
  targetId, role, stepId, attempt, gateId }`).
- **Emission boundary:** called from `handleWorkflowVerifyHuman`'s
  `--confirm` branch in `tools/specs/workflow/cli.mjs`, immediately after `store.confirm({
  scope, targetId, role, stepId: stepName, attempt, gateId: gateConfig.id || null })`
  returns successfully and before the function returns via `emit(...)`.
  This function already has `change` (and therefore `change.spec_id`), `task.id`,
  `stepName`, `attempt`, `scope`, `targetId`, `role`, and `gateConfig.id` in scope — no
  new lookups are needed.
- Actor = `resolveUserActor()` from task 03 (git config-based).
- `id`: `` `human.verification.confirmed:${change.spec_id}:${task.id}:${stepName}:
  ${attempt}:${gateConfig.id || 'default'}` `` — gate-qualified and deterministic, so a
  retried/repeated confirm call for the same gate dedups on read (overview.md §
  Idempotency).
- If `recordActivity` throws, the confirmation itself must still succeed — activity
  recording is observational, never a blocking dependency (mirrors task 06's failure
  handling). Wrap the call so a thrown error from activity recording cannot prevent
  `emit(...)` from returning the successful confirmation result.

## Implementation constraints

Do not change `FileHumanVerificationStore`'s persisted record shape, its constructor, or
its `confirm()` signature — this task does not touch
`tools/specs/workflow/human-verification-store.mjs` at all.
All logic lives in the CLI `--confirm` branch and the producer module.
Do not touch `human-step/operations.mjs` or `finish-operation.mjs` — generic workflow step
lifecycle and human step completion are owned by task 06.

## Acceptance criteria

- A confirmation via `workflow verify-human --confirm` produces exactly one queryable
  `human.verification.confirmed` activity with a `user`-type actor.
  `automated: node --test tools/tests/activity-human-verification-producer.test.mjs`
- The activity's `data` includes `scope`, `targetId`, `role`, `gateId` matching the
  underlying signoff record, and `scope.specId` on the envelope matches `change.spec_id`.
  `automated: node --test tools/tests/activity-human-verification-producer.test.mjs`
- Forcing `recordActivity` to throw does not prevent `handleWorkflowVerifyHuman --confirm` from
  returning its normal successful result.
  `automated: node --test tools/tests/activity-human-verification-producer.test.mjs`
- `human-verification-store.mjs`, `human-step/operations.mjs`, and `finish-operation.mjs` are untouched
  by this task's diff (`inspection: confirm no changes to those modules`).
- Existing `tools/tests/workflow-human-verification.test.mjs` still passes unchanged in
  its existing assertions. `automated: node --test tools/tests/workflow-human-verification.test.mjs`

## Verification

```bash
node --test tools/tests/activity-human-verification-producer.test.mjs
node --test tools/tests/workflow-human-verification.test.mjs
node tools/specs.mjs validate
```

## Out of scope

First-class human step lifecycle events (`workflow.step.started`, `workflow.step.completed`,
owned by task 06); any change to `FileHumanVerificationStore` itself.
