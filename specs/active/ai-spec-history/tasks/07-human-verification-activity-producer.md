---
id: ai-spec-history.human-verification-activity-producer
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
semantic_references:
  decisions: [D10]
  dependency_contracts: [activity-local-store, actor-resolver]
---

# Task: Human verification activity producer

## Dependencies

`activity-local-store`, `actor-resolver`.

## Goal

Emit a `human.verification.confirmed` activity from the human-verification confirm path,
with a real resolved `user` actor (unlike the underlying store, which only persists a
`role` string today) — from the correct boundary that actually knows `spec_id`
(2026-09-16 PR review, Major 6: the original task wired this inside
`FileHumanVerificationStore.confirm()`, which knows neither `spec_id` nor anything about
git identity).

## Requirements

- `tools/specs/activity/producers/human-verification.mjs`: owns the
  `human.verification.confirmed` type constant and its `data` contract (`{ scope,
  targetId, role, stepId, attempt, gateId }`).
- **Emission boundary (corrected):** called from `handleWorkflowVerifyHuman`'s
  `--confirm` branch in `tools/specs/workflow/cli.mjs`, immediately after `store.confirm({
  scope, targetId, role, stepId: stepName, attempt, gateId: gateConfig.id || null })`
  returns successfully (around line 426) and before the function returns via `emit(...)`.
  This function already has `change` (and therefore `change.spec_id`), `task.id`,
  `stepName`, `attempt`, `scope`, `targetId`, `role`, and `gateConfig.id` in scope — no
  new lookups are needed.
- Actor = `resolveUserActor()` from task 03 (git config-based).
- `id`: `` `human.verification.confirmed:${change.spec_id}:${task.id}:${stepName}:
  ${attempt}:${gateConfig.id || 'default'}` `` — gate-qualified and deterministic, so a
  retried/resumed confirm call for the same gate dedups on read (overview.md §
  Idempotency).
- If `recordActivity` throws, the confirmation itself must still succeed — activity
  recording is observational, never a blocking dependency (mirrors task 06's failure
  handling). Wrap the call so a thrown error from activity recording cannot prevent
  `emit(...)` from returning the successful confirmation result.

## Implementation constraints

Do not change `FileHumanVerificationStore`'s persisted record shape, its constructor, or
its `confirm()` signature — this task does not touch
`tools/specs/workflow/human-verification-store.mjs` at all. All new logic lives in the
CLI handler and the new producer module.

## Acceptance criteria

- A confirmation via `workflow verify-human --confirm` produces exactly one queryable
  `human.verification.confirmed` activity with a `user`-type actor.
  `automated: node --test tools/tests/activity-human-verification-producer.test.mjs`
- The activity's `data` includes `scope`, `targetId`, `role`, `gateId` matching the
  underlying signoff record, and `scope.specId` on the envelope matches `change.spec_id`.
  `automated: node --test tools/tests/activity-human-verification-producer.test.mjs`
- Forcing `recordActivity` to throw does not prevent `handleWorkflowVerifyHuman` from
  returning its normal successful result.
  `automated: node --test tools/tests/activity-human-verification-producer.test.mjs`
- `human-verification-store.mjs` is untouched by this task's diff (`inspection: confirm
  the diff contains no changes to tools/specs/workflow/human-verification-store.mjs`).
- Existing `tools/tests/workflow-human-verification.test.mjs` still passes unchanged in
  its existing assertions. `automated: node --test tools/tests/workflow-human-verification.test.mjs`

## Verification

```bash
node --test tools/tests/activity-human-verification-producer.test.mjs
node --test tools/tests/workflow-human-verification.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Any other human/user action producers (spec-approve, task-approve) — noted as a follow-up
in overview.md § Out of scope. Any change to `FileHumanVerificationStore` itself.
