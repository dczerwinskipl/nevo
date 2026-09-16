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
    - tools/specs/workflow/human-verification-store.mjs
allowed_paths:
  - tools/specs/activity/producers/human-verification.mjs
  - tools/specs/workflow/human-verification-store.mjs
  - tools/tests/activity-human-verification-producer.test.mjs
forbidden_paths:
  - src/**
  - tools/dashboard/**
semantic_references:
  dependency_contracts: [activity-local-store, actor-resolver]
---

# Task: Human verification activity producer

## Dependencies

`activity-local-store`, `actor-resolver`.

## Goal

Emit a `human.verification.confirmed` activity from the existing human-verification
confirm path, with a real resolved `user` actor (unlike the underlying store, which only
persists a `role` string today).

## Requirements

- `tools/specs/activity/producers/human-verification.mjs`: owns the
  `human.verification.confirmed` type constant and its `data` contract (`{ scope,
  targetId, role, stepId, attempt, gateId }`).
- Called from `FileHumanVerificationStore.confirm()`
  (`human-verification-store.mjs`), at the point the sign-off is persisted. Actor =
  `resolveUserActor()` from task 03.
- If `recordActivity` throws, the confirmation itself must still succeed — activity
  recording is observational, never a blocking dependency (mirrors task 06's failure
  handling).

## Implementation constraints

Do not change `FileHumanVerificationStore`'s persisted record shape or its existing
callers' contracts — this is additive instrumentation.

## Acceptance criteria

- A confirmation produces exactly one `human.verification.confirmed` activity with a
  `user`-type actor. `automated: node --test tools/tests/activity-human-verification-producer.test.mjs`
- The activity's `data` includes `scope`, `targetId`, `role`, `gateId` matching the
  underlying signoff record. `automated: node --test tools/tests/activity-human-verification-producer.test.mjs`
- Forcing `recordActivity` to throw does not prevent `confirm()` from completing
  successfully. `automated: node --test tools/tests/activity-human-verification-producer.test.mjs`
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
in overview.md § Out of scope.
