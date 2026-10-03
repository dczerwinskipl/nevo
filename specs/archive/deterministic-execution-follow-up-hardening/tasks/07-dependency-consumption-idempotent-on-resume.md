---
id: dependency-consumption-idempotent-on-resume
status: draft
change: deterministic-execution-follow-up-hardening
context:
  required:
    - specs/active/deterministic-execution-follow-up-hardening/overview.md
    - specs/active/deterministic-execution-follow-up-hardening/areas/terminal-execution-classification-and-resumability.md
    - tools/specs/workflow/cli.mjs
    - tools/specs/workflow/start-operation.mjs
    - tools/specs/workflow/dependency-consumption.mjs
allowed_paths:
  - tools/specs/workflow/cli.mjs
  - tools/specs/workflow/start-operation.mjs
  - tools/tests/workflow-step-context.test.mjs
  - tools/tests/workflow-continuation.test.mjs
forbidden_paths:
  - tools/specs/workflow/dependency-consumption.mjs
  - tools/specs/workflow/step-context.mjs
  - tools/dashboard/**
  - src/**
---

# Task: Dependency consumption idempotent on resume

## Goal

Fix `cli.mjs`'s `consumesDependencies` block so a `workflow step start` call for a step/attempt
that already has a start-operation record — of **any** terminal status, not only
`running`/`blocked`/`reconciliation-required` — for that exact `(step, attempt)` never
allocates a new `consumptionSequence` or re-records dependency consumption. It must only
complete genuinely unfinished stages of the existing record, mirroring the idempotency
`ensureStepActivated` already has for the activation half.

## Implementation constraints

- Do not change `dependency-consumption.mjs`'s recording/matching logic itself — only the
  decision in `cli.mjs` of whether to call `planStart` (allocate a new record) at all.
- The fix must key on "does a start-operation record already exist for this exact `(step,
  attempt)`", not merely "is there one with an in-flight status" — a completed record for
  the same `(step, attempt)` must also prevent re-planning.
- Preserve existing behavior for a genuinely new attempt (no prior record for this `(step,
  attempt)`) — `planStart` still runs exactly once per attempt.
- Preserve existing behavior for an actually in-flight record (still completes whichever
  stage is unfinished) — this task narrows when a *new* record is planned, it does not
  change how an existing one is completed.

## Acceptance criteria

- Calling `workflow step start` twice for the same active, `consumesDependencies: true`
  step/attempt (first call activates and records consumption; second call is a resume, no
  finish in between) results in exactly one dependency-consumption record for that `(step,
  attempt)`, with the same `consumptionSequence` both times.
  `automated: node --test tools/tests/workflow-step-context.test.mjs`
- A genuinely new attempt (after a prior attempt's finish) still allocates a new
  `consumptionSequence` and records consumption exactly once for the new attempt.
  `automated: node --test tools/tests/workflow-step-context.test.mjs`
- An actually in-flight start-operation record (status `running`/`blocked`/
  `reconciliation-required`) is still completed by resuming its unfinished stage(s), not by
  planning a new one. `automated: node --test tools/tests/workflow-step-context.test.mjs`
- This fix, combined with task 06, means resuming a `resumable`-released attempt via a new
  `workflow step start` never double-consumes dependencies end-to-end.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`

## Verification

```bash
node --test tools/tests/workflow-step-context.test.mjs
node --test tools/tests/workflow-continuation.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Terminal classification itself (tasks 05/06). Any change to `dependency-consumption.mjs`'s
own file format or matching semantics.
