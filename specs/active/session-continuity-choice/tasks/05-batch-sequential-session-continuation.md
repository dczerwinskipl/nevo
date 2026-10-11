---
id: batch-sequential-session-continuation
status: draft
change: session-continuity-choice
depends_on: [ server-session-choice-resolution ]
context:
  required:
    - specs/active/session-continuity-choice/overview.md
    - specs/active/session-continuity-choice/owner-decisions.md
    - docs/decisions/ADR-0009-agent-admission-and-execution-ownership-model.md
    - tools/dashboard/server/ai/sessions/turns/routes.mjs
    - tools/specs/workflow/queue/reservation.mjs
    - tools/dashboard/server/ai/orchestration/batch-completion-settlement.mjs
    - tools/dashboard/server/ai/orchestration/reconciliation.mjs
allowed_paths:
  - tools/dashboard/server/ai/sessions/turns/routes.mjs
  - tools/specs/workflow/queue/**
  - tools/dashboard/server/ai/orchestration/batch-completion-settlement.mjs
  - tools/tests/batch-sequential-session-continuation.test.mjs
forbidden_paths:
  - src/**
  - tools/dashboard/ui/**
semantic_references:
  decisions: [D1, D3]
  dependency_contracts: [server-session-choice-resolution]
---

# Task: Batch sequential session continuation

## Dependencies

`server-session-choice-resolution`.

## Goal

Let a multi-task review be run as "continue each task in its own session": sequential
single-task turns, each in that task's candidate session, instead of one new `task-batch`
session (D3).

## Requirements

- A request for several tasks with a batch-continuation mode (a body flag chosen in this
  task; the existing `reviewTogether` path is unchanged) validates, for every selected
  task, that the target step's transition allows `reuse` and that a candidate exists with
  a compatible provider. If any task fails, the whole request is rejected naming that task
  and reason; nothing is started.
- On acceptance the first task's turn is started immediately in its candidate session.
  The remaining tasks are recorded durably in order and each is started when the previous
  one settles, through the existing pending-handover / continuation mechanism where it
  fits. At most one execution is active at a time (ADR-0009).
- If a turn does not settle cleanly (`resumable` or `recovery-required`), the chain stops
  at that task and the remaining tasks stay recorded as not started, visible in the
  response of a status query; they are never started concurrently or skipped silently.
- No fabricated multi-member batch: this mode creates no `task-batch` scope and no shared
  batch report.

## Implementation constraints

- Reuse the single-task reuse path from task 02 for each turn; do not add a parallel
  execution path.
- The durable chain record must survive a dashboard restart (boot reconciliation resumes
  it or leaves it explicit), consistent with the existing handover sweeps.

## Acceptance criteria

- Three tasks with candidates run as three turns in their three sessions, in selected
  order, never overlapping.
  `automated: node --test tools/tests/batch-sequential-session-continuation.test.mjs`
- A task with no candidate or a provider mismatch rejects the whole request and starts
  nothing.
  `automated: node --test tools/tests/batch-sequential-session-continuation.test.mjs`
- A non-settling middle turn stops the chain and leaves later tasks recorded as not
  started.
  `automated: node --test tools/tests/batch-sequential-session-continuation.test.mjs`
- After a simulated restart the chain's remaining members are still recorded and resume or
  report explicitly.
  `automated: node --test tools/tests/batch-sequential-session-continuation.test.mjs`
- Existing batch tests pass.
  `automated: node --test tools/tests/batch-completion-orchestration.test.mjs`

## Verification

```bash
node --test tools/tests/batch-sequential-session-continuation.test.mjs
node --test tools/tests/batch-completion-orchestration.test.mjs
node tools/specs.mjs validate
```

## Out of scope

UI (task 06), parallel turns, and changes to the existing `task-batch` mode.
