---
id: terminal-reconciliation-adopts-outcome
status: draft
change: deterministic-execution-follow-up-hardening
context:
  required:
    - specs/active/deterministic-execution-follow-up-hardening/overview.md
    - specs/active/deterministic-execution-follow-up-hardening/areas/terminal-execution-classification-and-resumability.md
    - specs/active/deterministic-execution-follow-up-hardening/owner-decisions.md
    - tools/specs/workflow/execution-settlement.mjs
    - tools/dashboard/server/ai/orchestration/admission.mjs
    - tools/dashboard/server/ai/orchestration/reconciliation.mjs
    - tools/specs/workflow/cli.mjs
  optional:
    - tools/specs/workflow/workspace-writer.mjs
depends_on:
  - three-outcome-terminal-classification
  - dependency-consumption-idempotent-on-resume
allowed_paths:
  - tools/dashboard/server/ai/orchestration/admission.mjs
  - tools/dashboard/server/ai/orchestration/reconciliation.mjs
  - tools/specs/workflow/cli.mjs
  - tools/tests/workflow-continuation.test.mjs
  - tools/tests/workspace-writer.test.mjs
  - tools/tests/workspace-claim-reconciliation.test.mjs
forbidden_paths:
  - tools/specs/workflow/execution-settlement.mjs
  - src/**
semantic_references:
  decisions: [D1, D2, D3, D4]
  dependency_contracts: [three-outcome-terminal-classification, dependency-consumption-idempotent-on-resume]
---

# Task: Terminal reconciliation adopts the three-outcome classification

## Dependencies

`three-outcome-terminal-classification`. `dependency-consumption-idempotent-on-resume`
(spec-review F3b) — this task makes "call `workflow step start` again on an active attempt"
the routine way to resume; shipping it before task 07's idempotency fix would turn a rare
edge case into a routine double-consumption bug.

## Goal

Update every consumer of `assessExecutionSettlement`'s result to branch on the new
`outcome` field instead of the `settled` boolean, per D1/D2/D3/D4: `admission.mjs`'s Hook 1
(per-turn-terminal callback), `reconciliation.mjs`'s Hook 3 (boot-time reconciliation,
single-task claim branch), and `cli.mjs`'s `cli-manual` dead-pid takeover path. No new claim
status, no acknowledgement step — resuming is simply the next successful admission for the
same task. `outcome: 'resumable'` now covers **three** sub-cases (D1/D2 amendments,
spec-review F1 and this correction): an active-attempt-mid-flight turn ending, a
pre-activation remediation turn ending without success, and a turn ending with a
deterministically-replayable finish-operation record left behind — all three get identical
handling at every one of these three call sites (release the claim, leave the durable
finish-operation record — if any — untouched, no continuation); do not special-case any
sub-case differently at the consumer level, since task 05 already produces the same
`outcome` value for all three.

## Implementation constraints

- `outcome: 'resumable'` → release the claim via the existing `releaseWorkspaceWriterIfOwned`
  (the same primitive `'completed'` already uses) — do not write any new value to the claim.
  Do not mutate `workflow_progress`. Do not invoke continuation
  (`reconcileContinuation`/`reconcileWorkflowPosition`).
- `outcome: 'completed'` → unchanged existing behavior (release + continuation may run; the
  never-activated sub-case moved to `resumable` in task 05, not handled here).
- `outcome: 'recovery-required'` → unchanged existing behavior in all three call sites — now
  reached only for an in-flight start-operation record, or an in-flight finish-operation
  record task 05's shared classifier does *not* prove replayable (D2 correction — a
  replayable finish-operation record is `resumable`, not `recovery-required`, per the fixed
  acceptance criterion below).
- `turnStartState: 'invoking'` in `reconciliation.mjs` keeps bypassing settlement entirely
  and fails closed to `recovery-required` exactly as today (D99) — do not route it through
  `assessExecutionSettlement`/the new `outcome` field.
- Do not add any CLI flag, HTTP parameter, or confirmation prompt for a different
  session/agent to acquire a claim released as `resumable` — the existing acquisition path
  (already serialized by `withWorkspaceControlLock`) is sufficient and must not change.
- Preserve Scenario D: a claim that is not yet terminal (turn still live) must continue to
  reject a second `admitAgentExecution` exactly as today — this task must not touch
  acquisition-time contention logic, only terminal-time disposition.

## Acceptance criteria

- A turn ending with its task `active` (no in-flight operation record) releases the claim
  and leaves `workflow_progress` unchanged; a subsequent `admitAgentExecution` for the same
  task (same or different session) succeeds and receives the same `(step, attempt)`.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- A turn ending after being admitted at an open activation blocker, without successfully
  remediating (never activated at all), also releases the claim without marking
  `recovery-required`; a subsequent `admitAgentExecution` for the same task succeeds and
  the agent receives the same structured blocker again (spec-review F1/F4).
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- No attempt increment and no re-activation side effect occurs on that subsequent admission.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- A turn ending with an in-flight **start**-operation record still produces
  `recovery-required` unconditionally, blocking all future acquisition exactly as today.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- A turn ending with an in-flight **finish**-operation record that is *not* proven
  replayable (ambiguous/blocked/unknown) produces `recovery-required`, unchanged.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- A turn ending with an in-flight finish-operation record that *is* proven
  deterministically replayable (D2 correction) produces `resumable`, not
  `recovery-required`: the claim is released, the durable finish-operation record is left
  completely intact, and a subsequently admitted execution can call `workflow step finish`
  and have it resume that exact record via `finish-operation.mjs`'s own existing
  `findInFlightOperationRecord`-first resolution — no new admission-side special-casing
  needed for this to work, since `finishStep`/`planFinish` already treat an in-flight
  record as authoritative. `automated: node --test tools/tests/workflow-continuation.test.mjs`
- Boot-time reconciliation (Hook 3) applied to a `'prepared'`/`'started'` claim left behind
  by a dashboard restart classifies identically to Hook 1 for the same underlying state
  (same outcome, same claim disposition). `automated: node --test tools/tests/workspace-claim-reconciliation.test.mjs`
- A claim found at boot with `turnStartState: 'invoking'` still always yields
  `recovery-required`. `automated: node --test tools/tests/workspace-claim-reconciliation.test.mjs`
- `cli-manual` dead-pid takeover behaves identically for the `recovery-required` case and
  gains the same `resumable`-releases-cleanly behavior for the active-but-not-ambiguous
  case. `automated: node --test tools/tests/workspace-writer.test.mjs`
- A still-live (non-terminal) claim continues to reject a second `admitAgentExecution` for
  the same worktree/spec (Scenario D regression). `automated: node --test tools/tests/workflow-continuation.test.mjs`

## Verification

```bash
node --test tools/tests/workflow-continuation.test.mjs
node --test tools/tests/workspace-writer.test.mjs
node --test tools/tests/workspace-claim-reconciliation.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Dependency-consumption idempotency (task 07). Audit trail (task 08).
