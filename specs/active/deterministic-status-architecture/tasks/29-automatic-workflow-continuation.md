---
id: deterministic-status-architecture.automatic-workflow-continuation
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/workflow-continuation-and-session-handover.md
    - specs/active/deterministic-status-architecture/owner-decisions.md
allowed_paths:
  - tools/dashboard/server/ai/orchestration/**
  - tools/dashboard/server/ai/routes.mjs
  - tools/dashboard/server/ai/sessions/service.mjs
  - tools/dashboard/server/specs/human-step-transport.mjs
  - tools/dashboard/server/specs/actions.mjs
  - tools/specs/workflow/human-step/operations.mjs
  - tools/specs/workflow/cli.mjs
  - tools/tests/workflow-continuation.test.mjs
forbidden_paths:
  - tools/specs/workflow/finish-operation.mjs
  - tools/specs/workflow/queue/**
  - tools/specs/workflow/dependency-consumption.mjs
  - tools/specs/workflow/git-finalize-lock.mjs
  - tools/specs/workflow/workspace-writer.mjs
  - tools/specs/workflow/execution-settlement.mjs
  - tools/dashboard/server/ai/sessions/turns/runtime.mjs
  - src/**
depends_on: [ workflow-continuation-schema, execution-policy-and-mode-selection, deterministic-sequential-queue, dependency-release-and-invalidation ]
semantic_references:
  decisions: [D25, D26, D27, D33, D41, D42, D45, D47, D49, D50, D55, D56, D57, D59, D60, D61, D63, D65, D66, D67]
---

# Task: Automatic workflow continuation (agent admission + workspace-writer ownership + reconciliation + human dispatch)

## Goal

Build the server-side application/orchestration layer under
`tools/dashboard/server/ai/orchestration/**`: **`admitAgentExecution(specId, candidate)`
(D41/D49)** — the one spec-level, race-safe, atomic-through-to-durable-visibility admission
gate every **agent-owned** execution path funnels through, following the canonical lock
order (D66: admission mutex, then the workspace-writer claim) — which now **also claims the
shared workspace-writer slot** (D55, keyed by the physical worktree, D65) for the entire
lifetime of the admitted execution, releasing it only once that execution is proven
**settled** (D59/D60) — never merely because its turn reached terminal. Also build
**`reconcileWorkflowPosition(change, task)` (D42)**; the **human dispatch path** (D47/D49) — a
mutation-free interaction preview plus `activateAndSubmitHumanStep`, which now also claims the
workspace-writer slot for its own duration before its git-finalize lease, and is now also the
CLI's own `workflow verify-human` implementation (D63); and the **dispatch-priority check
(D57)** — before admitting the sequential queue's next automatic agent item, defer to any
already-pending non-agent workspace-mutation request, surfaced as `waiting-for-workspace`/
`blocked-by-recovery` (D67), never a generic failure. This task does **not** record
dependency-consumption (owned entirely by workflow core's durable start-operation,
D52/D53/D58), does **not** auto-activate a human step on arrival (D47), and does **not**
implement `assessExecutionSettlement`/`execution-settlement.mjs` itself (task 27) — it only
calls it.

## Implementation constraints

- **`admitAgentExecution`, atomic through to durable visibility, with rollback, claiming the
  workspace-writer slot in the canonical lock order (D41/D49/D55/D66).** New file,
  `tools/dashboard/server/ai/orchestration/admission.mjs`. Reuses the
  `AgentTurnRuntime.#acquireStartLock` promise-chain-mutex pattern (`turns/runtime.mjs`,
  forbidden path — read for reference, reimplement small, do not modify), keyed by `specId`:
  acquire the admission mutex first → re-read active-execution state → if occupied,
  reject/defer (candidate stays eligible) → if free, mark occupied **and call
  `acquireWorkspaceWriter({kind: 'agent', specId, taskId, sessionId?, turnId?})` second**
  (`workspace-writer.mjs`, task 27 — import only; the claim is keyed by the physical
  worktree, D65, not `specId`) → synchronously drive session/turn creation through to the
  point its canonical identity is durably observable → release the (short-lived) admission
  mutex. **The workspace-writer claim stays held for the whole active execution, until that
  execution is proven settled (D59/D60)** — it is not released merely because the admission
  mutex is released, and not released merely because the turn reaches terminal (see below).
  **If session/turn creation fails after either claim but before durable visibility, roll back
  both, in reverse acquisition order** (workspace-writer claim via `releaseWorkspaceWriter`,
  then the admission mutex, D66) — the candidate remains eligible/retryable; the spec is never
  left falsely, permanently occupied on either axis. No other path in this task (human-submit,
  the dispatch-priority check) ever acquires the admission mutex — only the workspace-writer
  claim.
- **Workspace-writer release requires proven settlement, never bare turn-terminal
  (D59/D60/D61).** When Hook 1 (`AgentSessionService`'s per-turn subscription) observes a turn
  reach terminal, or Hook 3 (boot/first-request reconciliation, reusing
  `reconcileOrphanedTurns()`'s own existing detection of a persisted `activeTurn` left behind
  by an ungraceful restart) finds an orphaned turn, call `assessExecutionSettlement`
  (`execution-settlement.mjs`, task 27 — import only) for that execution's task **before**
  touching its workspace-writer claim:
  - **settled** → call `forceReleaseWorkspaceWriter({repoRoot})` — the claim is released, as
    part of the same reconciliation pass that already runs `reconcileWorkflowPosition`.
  - **not settled, but canonical session/turn state shows the execution is still genuinely
    active** (a false alarm, not truly orphaned) → no action.
  - **not settled, and genuinely terminal/orphaned** → call
    `markWorkspaceWriterRecoveryRequired({repoRoot})` (task 27 — import only). The claim is
    retained, not deleted; every subsequent writer (human-submit, Publish, Batch Publish, the
    next agent admission) remains blocked until an out-of-scope-for-this-task reconciliation
    action clears it. No auto-clean/stash/discard of any file is ever performed here.
  `workspace-writer.mjs` and `execution-settlement.mjs` themselves never guess agent liveness
  or attempt settlement checking on their own initiative (D55/D60) — only this task, which has
  real session/turn state, decides when an agent-kind claim is actually terminal and orchestrates
  the settlement check + release/mark-recovery-required sequence.
- **`reconcileWorkflowPosition` (D42).** Given a task, resolves its authoritative
  `workflow_progress` position and matched transition. If the destination is **agent-owned**
  and `continuation: auto`: enqueue into the sequential queue (task 28), then call
  `admitAgentExecution`. If **human-owned** and `continuation: auto`: ensure the interaction
  preview is available; no admission, no mutation, no workspace-writer claim. On
  `owner-action` (or absent), no-op either way.
- **Dispatch-priority check, before admitting the next automatic agent item (D57).**
  Immediately before calling `admitAgentExecution` for the sequential queue's own
  `nextRunnable` item, call `listPendingWorkspaceWriters(specId)` (task 27); if any
  `kind !== 'agent'` waiter is already pending, defer — do not call `admitAgentExecution` yet.
  The already-queued waiter resolves via `workspace-writer.mjs`'s own FIFO wait order once the
  current holder releases; this task does not race it.
- **Request-level waiting status, surfaced distinctly (D67).** A pending human-submit request
  waiting on the workspace-writer slot reports `waiting-for-workspace` (ordinary contention) or
  `blocked-by-recovery` (the existing claim's `status` is `recovery-required`) — never a
  generic failure, and this task re-attempts acquisition transparently across any number of
  `acquireWorkspaceWriter`'s own internal low-level timeout cycles rather than surfacing that
  internal timeout to the caller.
- **`handleWorkflowVerifyHuman`'s CLI human-decision path unified with the dashboard's own
  combined operation (D63).** `tools/specs/workflow/cli.mjs`'s `handleWorkflowVerifyHuman`
  (`--approve`/`--request-changes` branch) is changed to call `activateAndSubmitHumanStep`
  (this task's own function, `human-step/operations.mjs`) instead of its existing
  `startHumanStep` → `submitHumanStepResult` two-call sequence — removing the CLI's own
  legacy, arbitration-free path to the identical mutation. Its `--confirm` branch (a
  `FileHumanVerificationStore` signoff write — untracked, no `workflow_progress`/`change.yaml`
  mutation) is untouched. This is the only change this task makes to `cli.mjs` — task 27 owns
  `handleWorkflowStepStart`/`handleWorkflowStepFinish`'s own, separate `cli-manual`
  workspace-writer wrapping in the same file (D62); this task does not touch those two
  functions.
- **Hooks 1–3, mechanism unchanged from the prior pass, now also driving workspace-writer
  release:** `AgentSessionService`'s own per-turn subscription (Hook 1); `human-step-
  transport.mjs`'s post-`submitHumanStepResult` call (Hook 2 — now calling the new combined
  operation); boot/first-request reconciliation (Hook 3).
- **Human interaction preview, no mutation (D47).** Extend `tools/dashboard/server/specs/
  actions.mjs` (task 14's existing, already-verified file): for a `waiting-for-step-start`
  position whose destination step is human-owned, compute the same
  `{result?, label, feedbackRequired}[]` shape the *active*-interaction descriptor already
  produces, read directly from the workflow definition's declared transitions — no
  `ensureStepActivated` call, no mutation.
- **`activateAndSubmitHumanStep` (D47/D50/D55) — workspace-writer slot outer, git-finalize
  lease inner, one of each, never recursive.** New exported function in
  `tools/specs/workflow/human-step/operations.mjs`:
  1. `acquireWorkspaceWriter({kind: 'human-submit', specId, taskId})` (task 27 — import only;
     `specId`/`taskId` are attribution fields only — the claim itself is keyed by the physical
     worktree, not `specId`, D65) — waits if an agent or another writer (for this spec or any
     other sharing the same physical worktree) currently holds the slot; if the existing
     claim's `status` is `recovery-required`, report `blocked-by-recovery` (D67) rather than
     waiting silently forever.
  2. `acquireGitFinalizeLease()` once, up front (task 27 — import only).
  3. Call `startHumanStep` (now protected by both claims).
  4. Call `submitHumanStepResult(change, task, definition, {...context, finalizeLease: lease},
     {result, feedback, artifacts})` — threading the git-finalize lease through `context` so
     the internal `finishStep` call uses it as `existingLease` and does not acquire a second
     one.
  5. Release the git-finalize lease in a `finally` after step 4 settles.
  6. Release the workspace-writer claim in a `finally` after step 5.
  `human-step-transport.mjs`'s handler calls this new function instead of the two operations
  separately.
- **Session policy application (D26), human-step auto-activation removed (D27/D45/D47).**
  Unchanged from the prior pass.
- No `switch`/`if`/lookup-object keyed on a literal step id anywhere in this task's code.

## Acceptance criteria

- Two simultaneous `admitAgentExecution` calls for the same spec never both return "admitted."
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- Admitting an agent execution claims the workspace-writer slot for the whole execution — a
  concurrently-submitted `activateAndSubmitHumanStep`/Publish request, attempted while that
  execution is still active, waits and does not proceed.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- Simulating a session/turn-creation failure occurring after both claims are marked but
  before durable visibility rolls back **both** the admission marker and the workspace-writer
  claim — a subsequent admission request for the same spec succeeds.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- Simulating a turn reaching terminal **with settlement proven** (its `finishStep` completed,
  position no longer `active`, no dirty in-scope files) releases that execution's
  workspace-writer claim as part of the same reconciliation pass — a waiting
  `activateAndSubmitHumanStep`/Publish request then proceeds.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- Simulating a turn reaching **failed/cancelled with `workflow step start`'s own mutation left
  un-finalized** (no `finishStep` ever ran, position still `active`) does **not** release the
  workspace-writer claim — it is marked `recovery-required`, and a waiting
  `activateAndSubmitHumanStep`/Publish/next-agent-admission request stays blocked
  (`blocked-by-recovery`), never proceeding onto the unreconciled dirty worktree.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- Simulating a turn reaching **"completed" with its own finish-operation record still
  `running`** (an unsettled completion) also does **not** release the claim — marked
  `recovery-required` identically to the failed/cancelled case.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- Simulating a server restart with a persisted, orphaned `activeTurn` that is genuinely
  settled releases that turn's workspace-writer claim via the same boot-time reconciliation
  that already handles the orphaned turn itself; an orphaned `activeTurn` that left dirty,
  un-finalized state is instead marked `recovery-required` and blocks every subsequent writer.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- `workflow verify-human --approve`/`--request-changes` acquires the workspace-writer slot and
  git-finalize lease via `activateAndSubmitHumanStep` (not a bare `startHumanStep`/
  `submitHumanStepResult` call) — proven by racing it against an active agent execution and
  observing it wait, identically to the dashboard's own combined-submit path.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- A pending human-submit request waiting on an active agent reports `waiting-for-workspace`;
  once that agent's claim is marked `recovery-required` instead of released, the same pending
  request's reported status changes to `blocked-by-recovery` — neither ever surfaces as a
  generic timeout failure.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- When an agent execution finishes with both a pending human decision and a next-queue agent
  item available, the dispatch-priority check defers the next agent item until the pending
  human decision's own `activateAndSubmitHumanStep` call has acquired, run, and released the
  workspace-writer slot.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- A pending human interaction on one task never blocks `admitAgentExecution` from admitting a
  different, independently-eligible agent-owned task in the same spec (a *pending*, not yet
  submitted, interaction claims nothing).
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- Reaching a human-owned destination via reconciliation exposes the interaction preview with
  **zero** `workflow_progress` mutation.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- `activateAndSubmitHumanStep` acquires exactly one workspace-writer claim and exactly one
  git-finalize lease for the whole call, releases both, and never deadlocks against itself.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- A human-owned destination reached via reconciliation never calls `admitAgentExecution` and
  never calls `startHumanStep` on its own.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- Simulating a turn reaching terminal via `AgentSessionService`'s own per-turn subscription
  for `implementation → review` results in `review` being enqueued and admitted.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- This task's own diff writes no dependency-consumption record anywhere.
- A transition without `continuation: auto` results in nothing enqueued.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- No file in this task's scope contains a `switch`/`if`/lookup-object keyed on a literal step
  id, and no file describes human dispatch as "agent admission," or the workspace-writer slot
  as interchangeable with the admission lock or the git-finalize lease. No file releases a
  workspace-writer claim by wiring `forceReleaseWorkspaceWriter` directly to turn-terminal
  without an intervening `assessExecutionSettlement` call.

## Verification

```bash
node --test tools/tests/workflow-continuation.test.mjs
node tools/specs.mjs validate
```

## Out of scope

The workflow-definition schema itself (`workflow-continuation-schema`, task 25). The
execution-policy selection UI/storage (`execution-policy-and-mode-selection`, task 26). The
pure queue/scheduling plan itself (`deterministic-sequential-queue`, task 28). The
dependency-satisfaction/epoch/suspension/consumption-recording/`consumptionSequence`-allocation
logic itself, the `git-finalize-lock.mjs`/`workspace-writer.mjs`/`execution-settlement.mjs`
primitives themselves (`dependency-release-and-invalidation`, task 27 — this task only
imports and calls their exports). `handleWorkflowStepStart`/`handleWorkflowStepFinish`'s own
`cli-manual` workspace-writer wrapping in `cli.mjs` (task 27, D62 — a distinct pair of
functions from `handleWorkflowVerifyHuman`, which this task does edit, D63). Resolving a
`recovery-required` claim once marked (D61 — a future task's own scope). Any form of
concurrent agent execution. Implementing cross-spec workspace-writer arbitration itself (this
task only calls the already-cross-spec-keyed primitive, D65 — the keying correction is task
27's own scope).
