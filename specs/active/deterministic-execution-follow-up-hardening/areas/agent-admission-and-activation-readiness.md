# Area: Agent admission and activation readiness separation

## Responsibility

Ensure a dirty worktree or an unresolved finish operation, before a new attempt, never
prevents a session/turn/agent process from being created — while still preventing creation
for readiness failures an agent cannot remediate — and that the agent, once running with an
open activation blocker, can safely help remediate under its own already-serialized
workspace ownership.

## Current state

Three independent call sites can reject execution for `DIRTY_WORKTREE_BEFORE_NEW_ATTEMPT` /
`FINISH_OPERATION_UNRESOLVED` before a session exists, with inconsistent behavior:

- `tools/specs/workflow/queue/evaluator.mjs`'s `evaluateTaskQueue` (used by
  `tools/dashboard/server/ai/sessions/turns/routes.mjs:351`, the "fresh" execution route)
  excludes the task from `eligible`/`nextRunnable` before `admitAgentExecution` is even
  called — the route returns `409 NO_RUNNABLE_TASK` with no session created.
- `AgentSessionService.createSession` (`service.mjs:416-418`) throws synchronously
  (`AiDeterministicWorkflowUnavailableError`) — reached via `admitAgentExecution`
  (`admission.mjs:200-212`), *after* the workspace-writer claim is already acquired. The
  "reuse" execution route (`routes.mjs:756`) has no earlier pre-check, so this is the first
  and only place it hits the readiness failure.
- `AgentSessionService.startTurn` (`service.mjs:1342`) repeats the same
  `assertTaskExecutionReadiness` check a second time, after `createSession` already passed
  it once, and after the claim is held. `admission.mjs`'s surrounding `catch (startErr)`
  (`admission.mjs:418-421`) rethrows without releasing the claim or clearing
  `activeExecutions` — a latent leak on *any* exception here, not only this one.

Workspace-writer claim acquisition (`admission.mjs` step 4, before `createSession`) is
already unconditional and independent of readiness — it does not need to change to make
ownership available during remediation.

## Requirements

- Introduce a shared classification of readiness-failure codes into **admission-blocking**
  and **activation-only** — per D2 (amended 2026-09-30, spec-review F2). This
  classification must be defined once and consumed by all three call sites, not
  special-cased three times:
  - Always admission-blocking: `TASK_UNPUBLISHED`, `DEPENDENCY_UNSATISFIED`,
    `WORKFLOW_TERMINAL`, `TASK_SUSPENDED`, executor mismatch, `TASK_BARRIERED`.
  - Always activation-only: `DIRTY_WORKTREE_BEFORE_NEW_ATTEMPT`.
  - `FINISH_OPERATION_UNRESOLVED` is **not** a single bucket: it is activation-only only
    when the persisted prior finish-operation state proves deterministic replay is safe;
    otherwise (ambiguous, or already recorded as reconciliation-required on a prior
    attempt) it is admission-blocking, routed to the same fail-closed handling as any other
    genuinely ambiguous durable state. This decision is delegated to the shared
    `isFinishOperationReplayable` classifier (`tasks/01-shared-finish-operation-replayability-classifier.md`)
    — never a second, locally reimplemented running/blocked/unknown check — because the
    identical rule also governs terminal settlement classification (Area B, D2's second
    amendment); one semantic source of truth, two call sites.
- `evaluateTaskQueue` must treat a task whose only readiness failure is activation-only
  (including a safely-replayable `FINISH_OPERATION_UNRESOLVED`) as still eligible/runnable
  for agent admission. A task whose `FINISH_OPERATION_UNRESOLVED` is *not* safely
  replayable stays excluded, exactly like any other admission-blocking failure.
- `createSession` and `startTurn` must not throw for activation-only failures; the session
  and turn are created normally, and the structured readiness result (`code`, `reason`,
  `dirtyFiles` for the dirty-worktree case / an explicit "prior finish operation is still
  replayable — retry `workflow step finish`" signal for the replayable-finish case, and an
  explicit "workflow attempt not yet activated" flag) must be reachable by the agent's own
  turn (e.g. attached to the session/turn record or surfaced in the Nevo workflow context
  text injected at turn start). The replayable-finish remediation path is exclusively
  retrying `workflow step finish` — never ad hoc git cleanup, never a bypass of
  reconciliation.
- Admission-blocking failures (including a non-replayable `FINISH_OPERATION_UNRESOLVED`)
  continue to prevent session/turn creation on all three call sites exactly as today — no
  behavior change there, and no ordinary writable execution merely because the top-level
  readiness code happens to be `FINISH_OPERATION_UNRESOLVED`.
- Fix the adjacent `admission.mjs` `catch (startErr)` leak: any exception after claim
  acquisition (not only the two activation-only codes, which after this change no longer
  throw here) must release/mark the claim and clear `activeExecutions` before rethrowing,
  mirroring the existing `enrichRes2`/`enrichRes3` failure branches.
- Fix the adjacent `admission.mjs` `catch (subErr)` around installing the Hook 1
  `subscribeToSession` listener (spec-review F5): a failed install must be treated as an
  admission failure, not silently logged with `admitted: true` still returned. Clean up
  identically to the `startErr` path — workspace-writer claim, `activeExecutions` entry, and
  confirm no stale/unreconcilable execution remains observable afterward.

## Constraints

- Workspace-writer claim acquisition itself does not change — an activation-blocked
  execution still gets a normal `kind: 'agent'` claim, subject to the same Scenario D mutex
  as any other execution.
- No automatic discard/stash/reset of existing changes under any circumstance.
- `docs/development/agent-workflow-protocol.md`'s "before modifying any files, run
  `workflow step start`" instruction is prompt-level only (confirmed: no code enforces it)
  — the remediation exception this area adds is therefore a text/protocol change, not a new
  code-level write path.

## Interfaces and boundaries

Consumes: `readiness-policy.mjs`'s existing return contract (extends it with a
classification field, does not change its existing `ready`/`code`/`reason`/`dirtyFiles`
shape). Exposes: the same classification to Area B's terminal-classification work only in
that both must agree on the same activation-only code set when reasoning about "never
activated vs. genuinely advanced" (see Area B's `completed` outcome).

## Area-specific acceptance criteria

- A task in `ready`/`waiting-for-step-start` state with a dirty worktree, or with a
  safely-replayable unresolved finish operation, is still returned by `evaluateTaskQueue`
  as runnable for agent admission.
- A task whose unresolved finish operation is *not* safely replayable is excluded by
  `evaluateTaskQueue`, identical to any other admission-blocking failure.
- `createSession`/`startTurn` never throw for `DIRTY_WORKTREE_BEFORE_NEW_ATTEMPT` or a
  safely-replayable `FINISH_OPERATION_UNRESOLVED`; the created session/turn carries the
  structured blocker. `createSession`/`startTurn` still throw for a non-replayable
  `FINISH_OPERATION_UNRESOLVED`, identical to every other admission-blocking code.
- A workspace-writer claim exists for the admitted, activation-blocked execution.
- Any exception thrown inside `admitAgentExecution` after claim acquisition — including a
  failed `subscribeToSession` install — leaves neither a dangling claim, nor a stale
  `activeExecutions` entry, nor an execution reported `admitted: true` with no terminal
  reconciliation path.

## Dependencies

`readiness-classification-split` (task 02) depends on the shared
`shared-finish-operation-replayability-classifier` (task 01) — the foundational task both
this area and Area B consume, per D2's second amendment.

`non-fatal-admission-for-remediable-blockers` (task 03) also depends on Area B's
`terminal-reconciliation-adopts-outcome` (task 06) — added 2026-09-30, spec-review F3.
Shipping non-fatal admission before Area B's terminal reconciliation understands the
broadened `resumable` outcome would reproduce the exact bug this spec exists to fix: an
agent admitted at a blocker, unable to remediate before its turn ends, would still be
classified `recovery-required` by the old binary settlement logic (since the dirty files
that caused the block are, from the old logic's point of view, indistinguishable from a
genuine settlement failure). This area is otherwise the foundation Area C's Scenario A test
depends on.

## Out of scope

- The actual terminal-classification model (Area B).
- Changing which codes exist in `readiness-policy.mjs` — only classifying the existing set.
