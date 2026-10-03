---
id: acceptance-scenario-b-and-c
status: draft
change: deterministic-execution-follow-up-hardening
context:
  required:
    - specs/active/deterministic-execution-follow-up-hardening/overview.md
    - specs/active/deterministic-execution-follow-up-hardening/areas/acceptance-scenarios-a-through-d.md
    - specs/active/deterministic-execution-follow-up-hardening/owner-decisions.md
depends_on:
  - terminal-reconciliation-adopts-outcome
  - dependency-consumption-idempotent-on-resume
allowed_paths:
  - tools/tests/scenario-bc-resume-active-attempt.test.mjs
forbidden_paths:
  - tools/specs/workflow/**
  - tools/dashboard/server/ai/**
  - src/**
semantic_references:
  decisions: [D1, D3, D4]
  dependency_contracts: [terminal-reconciliation-adopts-outcome, dependency-consumption-idempotent-on-resume]
---

# Task: Acceptance scenario B & C — resuming an active attempt

## Dependencies

`terminal-reconciliation-adopts-outcome`, `dependency-consumption-idempotent-on-resume`.

## Goal

New orchestration-level test proving Scenario B (different agent/session resumes) and
Scenario C (same session, new turn, resumes) share the same mechanism and both behave
correctly — per D1's explicit requirement that B and C are not two designs.

## Acceptance criteria

- Admit an execution, activate the step (attempt 1), mutate a file inside the task's
  allowed scope, end the turn without calling `workflow step finish` — assert `outcome:
  'resumable'`, claim released, `workflow_progress` unchanged.
  `automated: node --test tools/tests/scenario-bc-resume-active-attempt.test.mjs`
- **Scenario B variant:** a *different* session admits next for the same task — assert it
  receives the same `(step, attempt)`, no attempt increment, `ensureStepActivated` performs
  no re-activation side effect, and it can call `workflow step finish` normally to complete
  the step. `automated: node --test tools/tests/scenario-bc-resume-active-attempt.test.mjs`
- **Scenario C variant:** the *same* session's next turn admits for the same task — assert
  the identical set of outcomes as the Scenario B variant (same `(step, attempt)`, no
  attempt increment, no re-activation, can finish normally).
  `automated: node --test tools/tests/scenario-bc-resume-active-attempt.test.mjs`
- For a `consumesDependencies: true` step, both the B and C variants result in exactly one
  dependency-consumption record for `(step, attempt 1)` — no duplicate.
  `automated: node --test tools/tests/scenario-bc-resume-active-attempt.test.mjs`
- Out-of-scope dirty files left behind before the resumable release are present as a
  non-blocking diagnostic on the classification result the resuming execution can read, and
  do not prevent either variant from resuming.
  `automated: node --test tools/tests/scenario-bc-resume-active-attempt.test.mjs`
- An in-flight, genuinely ambiguous operation record (simulated) at the same point instead
  produces `recovery-required` and blocks both variants — contrast case proving `resumable`
  and `recovery-required` are not conflated.
  `automated: node --test tools/tests/scenario-bc-resume-active-attempt.test.mjs`

## Verification

```bash
node --test tools/tests/scenario-bc-resume-active-attempt.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Unit-level coverage of the classification function itself (task 05's own tests) or of
reconciliation call sites individually (task 06's own tests). The finish-operation-replay
sub-case is a separate acceptance scenario (task 13), not duplicated here.
