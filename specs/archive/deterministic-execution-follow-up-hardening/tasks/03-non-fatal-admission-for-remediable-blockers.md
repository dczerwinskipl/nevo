---
id: non-fatal-admission-for-remediable-blockers
status: draft
change: deterministic-execution-follow-up-hardening
context:
  required:
    - specs/active/deterministic-execution-follow-up-hardening/overview.md
    - specs/active/deterministic-execution-follow-up-hardening/areas/agent-admission-and-activation-readiness.md
    - specs/active/deterministic-execution-follow-up-hardening/owner-decisions.md
    - tools/specs/workflow/readiness-policy.mjs
    - tools/specs/workflow/queue/evaluator.mjs
    - tools/dashboard/server/ai/sessions/service.mjs
    - tools/dashboard/server/ai/orchestration/admission.mjs
    - tools/dashboard/server/ai/sessions/turns/routes.mjs
  optional: []
allowed_paths:
  - tools/specs/workflow/queue/evaluator.mjs
  - tools/dashboard/server/ai/sessions/service.mjs
  - tools/dashboard/server/ai/orchestration/admission.mjs
  - tools/tests/execution-readiness-policy.test.mjs
  - tools/tests/workflow-continuation.test.mjs
  - tools/tests/dashboard-orchestration-wiring.test.mjs
forbidden_paths:
  - tools/specs/workflow/cli.mjs
  - tools/specs/workflow/step-context.mjs
  - tools/specs/workflow/execution-settlement.mjs
  - tools/specs/workflow/finish-operation.mjs
  - src/**
depends_on:
  - readiness-classification-split
  - terminal-reconciliation-adopts-outcome
semantic_references:
  decisions: [D1, D2]
  dependency_contracts: [readiness-classification-split, terminal-reconciliation-adopts-outcome]
---

# Task: Non-fatal admission for remediable activation blockers

## Dependencies

`readiness-classification-split` (uses its exported classification).
`terminal-reconciliation-adopts-outcome` (spec-review F3) — non-fatal admission must not
ship before terminal reconciliation understands the broadened `resumable` outcome (D1
amendment), or an agent admitted at a blocker whose remediation turn ends without success
would still be misclassified `recovery-required` by the old binary settlement logic.

## Goal

Using task 02's classification, make activation-only readiness failures — always
`DIRTY_WORKTREE_BEFORE_NEW_ATTEMPT`, and `FINISH_OPERATION_UNRESOLVED` only when the prior
finish-operation record is proven safely replayable (D2 amendment) — never prevent a
session/turn from being created, on every call site that can currently reject execution for
them, while admission-blocking failures (including a non-replayable
`FINISH_OPERATION_UNRESOLVED`) keep rejecting exactly as today. Also close two adjacent
`admission.mjs` gaps confirmed during spec-review: the claim/`activeExecutions` leak on any
exception after claim acquisition (F-original), and the silently-swallowed
`subscribeToSession` installation failure that leaves an `admitted: true` execution with no
terminal-reconciliation path (F5).

## Implementation constraints

- `evaluateTaskQueue` (`tools/specs/workflow/queue/evaluator.mjs`): a task whose only
  readiness failure is activation-only (per task 02's classification, including a
  safely-replayable `FINISH_OPERATION_UNRESOLVED`) must still appear in `eligible`/be a
  candidate for `nextRunnable` for agent admission. A task whose `FINISH_OPERATION_UNRESOLVED`
  is *not* safely replayable stays excluded — do not weaken any other exclusion this
  function performs.
- `AgentSessionService.createSession` / `assertTaskExecutionReadiness` /
  `AgentSessionService.startTurn` (`service.mjs`): for activation-only failures, do not
  throw — instead attach the structured readiness result (code, reason, `dirtyFiles` for the
  dirty-worktree case / an explicit "prior finish operation is still replayable — retry
  `workflow step finish`" signal for the replayable-finish case, and an explicit "workflow
  attempt not yet activated" flag) to the created session/turn so it is retrievable by the
  turn (e.g. via the session record or the Nevo workflow context text built at turn start).
  For admission-blocking failures (including a non-replayable
  `FINISH_OPERATION_UNRESOLVED`), the existing throw behavior is unchanged — do not touch
  that branch.
- `admission.mjs`: fix the `catch (startErr)` block around `sessionService.startTurn` so
  any exception (not only the two now-non-fatal codes) releases/marks the claim and clears
  the `activeExecutions` entry before rethrowing, mirroring the existing `enrichRes2`/
  `enrichRes3` failure branches. Do not change claim-acquisition order (claim before
  session creation stays as-is — it is what makes remediation-under-ownership safe).
- `admission.mjs` (spec-review F5): fix the `catch (subErr)` block around
  `sessionService.subscribeToSession` so a failed installation is treated as an admission
  failure with the same cleanup as `startErr` — release/mark the claim, clear
  `activeExecutions`, and return `admitted: false` — rather than silently logging and
  returning `admitted: true` with no terminal-reconciliation subscription installed.
- Do not change `assertCleanWorktreeForNewAttempt`/`ensureStepActivated`
  (`step-context.mjs`) — `workflow step start`'s own activation gate stays exactly as it is
  today; only session/turn creation stops treating its failure as fatal.
- Do not change `finish-operation.mjs`'s own resumability/crash-reconciliation logic — this
  task only reads its record shapes (via task 02's classification) to decide admission, it
  never touches how a finish operation replays.

## Acceptance criteria

- A task with a dirty worktree, otherwise `ready`, is returned by `evaluateTaskQueue` as
  runnable for agent admission. `automated: node --test tools/tests/workflow-continuation.test.mjs`
- A task with a *safely-replayable* unresolved finish operation is returned by
  `evaluateTaskQueue` as runnable for agent admission; a task with a *non-replayable*
  unresolved finish operation is excluded, identical to any other admission-blocking
  failure. `automated: node --test tools/tests/workflow-continuation.test.mjs`
- `createSession`/`startTurn` do not throw for `DIRTY_WORKTREE_BEFORE_NEW_ATTEMPT` or a
  safely-replayable `FINISH_OPERATION_UNRESOLVED`; the resulting session/turn exposes the
  structured blocker. `automated: node --test tools/tests/execution-readiness-policy.test.mjs`
- `createSession`/`startTurn` still throw, unchanged, for every admission-blocking code
  (draft, blocked, terminal, suspended, executor-mismatch, barriered, non-replayable
  unresolved finish) — existing tests for these (AC1–AC6, AC8 in
  `execution-readiness-policy.test.mjs`) pass unmodified.
  `automated: node --test tools/tests/execution-readiness-policy.test.mjs`
- The admitted, activation-blocked execution has a live workspace-writer claim (`kind:
  'agent'`). `automated: node --test tools/tests/workflow-continuation.test.mjs`
- A second `admitAgentExecution` for the same spec while an activation-blocked execution is
  live still fails (Scenario D unaffected). `automated: node --test tools/tests/workflow-continuation.test.mjs`
- Simulating an unexpected exception inside `admitAgentExecution` after claim acquisition
  (any cause, including a `startTurn` throw) leaves no dangling claim and no stale
  `activeExecutions` entry. `automated: node --test tools/tests/workflow-continuation.test.mjs`
- Simulating a `subscribeToSession` throw leaves no dangling claim, no stale
  `activeExecutions` entry, and `admitAgentExecution` returns `admitted: false` — never
  `admitted: true` with an unreconcilable execution.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`

## Verification

```bash
node --test tools/tests/execution-readiness-policy.test.mjs
node --test tools/tests/workflow-continuation.test.mjs
node --test tools/tests/dashboard-orchestration-wiring.test.mjs
node tools/specs.mjs validate
```

## Out of scope

The agent-facing protocol text explaining the remediation exception (task 04). Terminal
classification / resumability (Area B).
