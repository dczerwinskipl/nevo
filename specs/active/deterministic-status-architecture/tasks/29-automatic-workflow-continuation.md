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
  - tools/specs/workflow/human-step/submit-request.mjs
  - tools/specs/workflow/cli.mjs
  - tools/tests/workflow-continuation.test.mjs
forbidden_paths:
  - tools/specs/workflow/finish-operation.mjs
  - tools/specs/workflow/queue/**
  - tools/specs/workflow/dependency-consumption.mjs
  - tools/specs/workflow/git-finalize-lock.mjs
  - tools/specs/workflow/workspace-writer.mjs
  - tools/specs/workflow/workspace-request.mjs
  - tools/specs/workflow/execution-settlement.mjs
  - tools/dashboard/server/ai/sessions/turns/runtime.mjs
  - src/**
depends_on: [ workflow-continuation-schema, execution-policy-and-mode-selection, deterministic-sequential-queue, dependency-release-and-invalidation ]
semantic_references:
  decisions: [D25, D26, D27, D33, D41, D42, D45, D47, D49, D50, D55, D56, D57, D59, D60, D61, D63, D65, D66, D67, D70, D71, D72, D73, D74, D75, D76, D77, D78]
---

# Task: Automatic workflow continuation (agent admission + workspace-writer ownership + reconciliation + human dispatch)

## Goal

Build the server-side application/orchestration layer under
`tools/dashboard/server/ai/orchestration/**`: **`admitAgentExecution(specId, candidate)`
(D41/D49)** — the one spec-level, race-safe, atomic-through-to-durable-visibility admission
gate every **agent-owned** execution path funnels through, following the canonical lock
order (D66: admission mutex, then the workspace-writer claim) — which now **also claims the
shared workspace-writer slot** (D55, keyed by the physical worktree, D65) for the entire
lifetime of the admitted execution, **persisting the acquired `workspaceOwnerId` onto this
execution's own durable session/turn record** (D71 — never left only in an in-memory
closure), releasing it only once that execution is proven **settled** (D59/D60) via an
**ownership-conditional** release/mark-recovery-required call (D70) — never merely because its
turn reached terminal, and never a blind mutation of whatever claim happens to be live at
reconciliation time. Also build **`reconcileWorkflowPosition(change, task)` (D42)**; the
**human dispatch path** (D47/D49) — a mutation-free interaction preview plus
`activateAndSubmitHumanStep`, which now **persists a durable human-submit request before any
contention or mutation** (D73), then claims the workspace-writer slot for its own duration
before its git-finalize lease, and is now also the CLI's own `workflow verify-human`
implementation (D63); and the **worktree-wide dispatch-priority check (D57/D74)** — before
admitting the sequential queue's next automatic agent item, defer to any already-pending
durable workspace-request **anywhere in the physical worktree**, not filtered by spec,
surfaced as `waiting-for-workspace`/`blocked-by-recovery` (D67), never a generic failure, and
surviving a dashboard restart (D75). This task does **not** record dependency-consumption
(owned entirely by workflow core's durable start-operation, D52/D53/D58), does **not**
auto-activate a human step on arrival (D47), and does **not** implement
`assessExecutionSettlement`/`execution-settlement.mjs`/`workspace-writer.mjs`/
`workspace-request.mjs` themselves (task 27) — it only calls them.

## Implementation constraints

- **`admitAgentExecution`, atomic through to durable visibility, with rollback, claiming the
  workspace-writer slot in the canonical lock order, persisting its owner id (D41/D49/D55/D66/D71).**
  New file, `tools/dashboard/server/ai/orchestration/admission.mjs`. Reuses the
  `AgentTurnRuntime.#acquireStartLock` promise-chain-mutex pattern (`turns/runtime.mjs`,
  forbidden path — read for reference, reimplement small, do not modify), keyed by `specId`:
  acquire the admission mutex first → re-read active-execution state → if occupied,
  reject/defer (candidate stays eligible) → if free, mark occupied **and call
  `acquireWorkspaceWriter({kind: 'agent', specId, taskId, sessionId?, turnId?})` second**
  (`workspace-writer.mjs`, task 27 — import only; the claim is keyed by the physical
  worktree, D65, not `specId`) → **persist the returned `workspaceOwnerId` onto this
  execution's own durable session/turn record**, as part of the same write that makes that
  record's canonical identity durably observable (D71 — this task owns that record; task 27
  only defines the field's meaning) → synchronously drive session/turn creation through to the
  point its canonical identity is durably observable → release the (short-lived) admission
  mutex. **The workspace-writer claim stays held for the whole active execution, until that
  execution is proven settled (D59/D60)** — it is not released merely because the admission
  mutex is released, and not released merely because the turn reaches terminal (see below).
  **If session/turn creation fails after either claim but before durable visibility, roll back
  both, in reverse acquisition order** (workspace-writer claim via
  `releaseWorkspaceWriterIfOwned` using the `ownerId` this same attempt just acquired, D70,
  then the admission mutex, D66) — the candidate remains eligible/retryable; the spec is never
  left falsely, permanently occupied on either axis. No other path in this task (human-submit,
  the dispatch-priority check) ever acquires the admission mutex — only the workspace-writer
  claim.
- **Workspace-writer release requires proven settlement AND matching ownership — never bare
  turn-terminal, never a blind mutation of whatever claim is currently live
  (D59/D60/D61/D70/D71).** When Hook 1 (`AgentSessionService`'s per-turn subscription) observes
  a turn reach terminal, or Hook 3 (boot/first-request reconciliation, reusing
  `reconcileOrphanedTurns()`'s own existing detection of a persisted `activeTurn` left behind
  by an ungraceful restart) finds an orphaned turn, call `assessExecutionSettlement`
  (`execution-settlement.mjs`, task 27 — import only) for that execution's task **before**
  touching its workspace-writer claim:
  - **settled** → read `workspaceOwnerId`/`sessionId`/`turnId`/`taskId` from that execution's
    own durable session/turn record (never an in-memory closure — a delayed callback or a
    boot-time pass may run long after any in-process value would still be trustworthy) and call
    `releaseWorkspaceWriterIfOwned({expectedOwnerId, expectedSessionId, expectedTurnId,
    expectedTaskId})` (task 27 — import only). **A `not-current-owner` result (the live claim
    already belongs to a different, later execution because this reconciliation ran late) is a
    safe no-op — never an error, never a retry, never touches the other execution's claim**
    (this is precisely the stale-reconciliation race the brief describes).
  - **not settled, but canonical session/turn state shows the execution is still genuinely
    active** (a false alarm, not truly orphaned) → no action.
  - **not settled, and genuinely terminal/orphaned** → call
    `markWorkspaceWriterRecoveryRequiredIfOwned({expectedOwnerId, ...same identity fields})`
    (task 27 — import only), same ownership-conditional discipline. The claim is retained, not
    deleted; every subsequent writer (human-submit, Publish, Batch Publish, the next agent
    admission) remains blocked until an out-of-scope-for-this-task reconciliation action clears
    it. No auto-clean/stash/discard of any file is ever performed here.
  - **If no persisted `workspaceOwnerId` can be found at all for the execution being
    reconciled** (a legacy record predating this field, or a crash before it was ever written)
    — identity is unestablished: do nothing, fail closed (treat as `recovery-required`-
    equivalent), never guess and never fall back to an unconditional release.
  `workspace-writer.mjs` and `execution-settlement.mjs` themselves never guess agent liveness
  or attempt settlement checking on their own initiative (D55/D60), and never expose an
  unconditional worktree-global mutation as the ordinary API (D70) — only this task, which has
  real session/turn state, decides when an agent-kind claim is actually terminal and
  orchestrates the settlement check + ownership-conditional release/mark-recovery-required
  sequence.
- **`reconcileWorkflowPosition` (D42).** Given a task, resolves its authoritative
  `workflow_progress` position and matched transition. If the destination is **agent-owned**
  and `continuation: auto`: enqueue into the sequential queue (task 28), then call
  `admitAgentExecution`. If **human-owned** and `continuation: auto`: ensure the interaction
  preview is available; no admission, no mutation, no workspace-writer claim. On
  `owner-action` (or absent), no-op either way.
- **Dispatch-priority check, worktree-wide, read from the durable request queue — not
  `listPendingWorkspaceWriters(specId)` (D57/D65/D74).** Immediately before calling
  `admitAgentExecution` for the sequential queue's own `nextRunnable` item, call
  `workspace-request.mjs`'s `listWorkspaceRequests({status: ['queued', 'waiting-for-workspace']})`
  (task 27 — import only) for the **entire physical worktree**, not filtered by the spec whose
  next agent item is under consideration; if any such request exists (for *any* `specId*`),
  defer — do not call `admitAgentExecution` yet, for *any* spec sharing that worktree. The
  in-process `listPendingWorkspaceWriters` view may still be consulted as a same-process
  wakeup optimization but is never the scheduling authority.
- **Request-level waiting status, surfaced distinctly, backed by a durable request (D67/D72).**
  A pending human-submit's own durable workspace-request (below) reports
  `waiting-for-workspace` (ordinary contention) or `blocked-by-recovery` (the existing claim's
  `status` is `recovery-required`) — never a generic failure, and this task re-attempts
  acquisition transparently across any number of `acquireWorkspaceWriter`'s own internal
  low-level timeout cycles rather than surfacing that internal timeout to the caller. Because
  the request is a durable record, this status (and the request's own existence) survives a
  dashboard restart — the in-process waiter list alone never did.
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
- **Hooks 1–3, mechanism unchanged from the prior pass, now also driving ownership-conditional
  workspace-writer release and workspace-request reconciliation:** `AgentSessionService`'s own
  per-turn subscription (Hook 1); `human-step-transport.mjs`'s post-`submitHumanStepResult`
  call (Hook 2 — now calling the new combined operation); boot/first-request reconciliation
  (Hook 3 — now also scanning `workspace-request.mjs`'s durable queue, D75, in addition to its
  existing orphaned-turn detection).
- **Human interaction preview, no mutation (D47).** Extend `tools/dashboard/server/specs/
  actions.mjs` (task 14's existing, already-verified file): for a `waiting-for-step-start`
  position whose destination step is human-owned, compute the same
  `{result?, label, feedbackRequired}[]` shape the *active*-interaction descriptor already
  produces, read directly from the workflow definition's declared transitions — no
  `ensureStepActivated` call, no mutation.
- **Durable human-submit request, persisted before any contention or mutation (D73).** New
  file, `tools/specs/workflow/human-step/submit-request.mjs`: record family at
  `.nevo-ai-local/human-submit-operations/<change>/<task>/attempt-<n>.json` — `{taskId,
  transition/result, feedback, inputs, requestId, createdAt, status: 'pending'|'completed'|
  'failed'}`, mirroring Publish's own `PUBLISH_STAGE_IDS`-style atomic-write convention (own
  small local record-shaping helper, not a shared one). Written **before**
  `activateAndSubmitHumanStep` creates its paired workspace-request or calls
  `acquireWorkspaceWriter` at all.
- **`activateAndSubmitHumanStep` (D47/D50/D55/D72/D73) — durable request first, workspace-writer
  slot outer, git-finalize lease inner, one of each, never recursive.** New exported function in
  `tools/specs/workflow/human-step/operations.mjs`:
  1. Write the durable human-submit operation record (D73, above): `status: 'pending'`.
  2. Create a paired workspace-request (`workspace-request.mjs`, task 27 — import only;
     `kind: 'human-submit'`, `operationRef` naming the record from step 1): `status: 'queued'`.
  3. `acquireWorkspaceWriter({kind: 'human-submit', specId, taskId})` (task 27 — import only;
     `specId`/`taskId` are attribution fields only — the claim itself is keyed by the physical
     worktree, not `specId`, D65) — waits if an agent or another writer (for this spec or any
     other sharing the same physical worktree) currently holds the slot, transitioning the
     request to `waiting-for-workspace`; if the existing claim's `status` is
     `recovery-required`, transition the request to `blocked-by-recovery` (D67) rather than
     waiting silently forever.
  4. Once acquired: transition the request to `running`, storing the acquired
     `workspaceOwnerId` into its own record (D77) — before any further mutation.
  5. `acquireGitFinalizeLease()` once, up front (task 27 — import only).
  6. Call `startHumanStep` (now protected by both claims).
  7. Call `submitHumanStepResult(change, task, definition, {...context, finalizeLease: lease},
     {result, feedback, artifacts})` — threading the git-finalize lease through `context` so
     the internal `finishStep` call uses it as `existingLease` and does not acquire a second
     one.
  8. Release the git-finalize lease in a `finally` after step 7 settles.
  9. Release the workspace-writer claim in a `finally` after step 8, via
     `releaseWorkspaceWriterIfOwned` using the request's own stored `workspaceOwnerId` (D70) —
     never an unconditional release.
  10. Mark the durable human-submit operation record and its paired workspace-request
      `completed`/`failed` to match the real outcome.
  `human-step-transport.mjs`'s handler calls this new function instead of the two operations
  separately. **After a restart**, a `pending` human-submit operation record paired with a
  non-terminal workspace-request is rediscovered (Hook 3), its ordering preserved via the
  request's own `requestSequence`, and resumed by re-invoking `activateAndSubmitHumanStep` with
  the exact stored transition/feedback/inputs — reconciled via D75's own
  resume/no-op/`reconciliation-required` discipline if it may have already partially landed,
  never blindly re-run, never silently dropped.
- **Session policy application (D26), human-step auto-activation removed (D27/D45/D47).**
  Unchanged from the prior pass.
- No `switch`/`if`/lookup-object keyed on a literal step id anywhere in this task's code.

## Acceptance criteria

- Two simultaneous `admitAgentExecution` calls for the same spec never both return "admitted."
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- Admitting an agent execution claims the workspace-writer slot for the whole execution and
  persists the acquired `workspaceOwnerId` onto its own durable session/turn record — a
  concurrently-submitted `activateAndSubmitHumanStep`/Publish request, attempted while that
  execution is still active, waits and does not proceed.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- Simulating a session/turn-creation failure occurring after both claims are marked but
  before durable visibility rolls back **both** the admission marker and the workspace-writer
  claim (via `releaseWorkspaceWriterIfOwned`, using the just-acquired `ownerId`) — a subsequent
  admission request for the same spec succeeds.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- Simulating a turn reaching terminal **with settlement proven** (its `finishStep` completed,
  position no longer `active`, no dirty in-scope files) releases that execution's
  workspace-writer claim (via `releaseWorkspaceWriterIfOwned`, using `workspaceOwnerId` read
  from its own durable record) as part of the same reconciliation pass — a waiting
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
- **Stale-reconciliation race, proven directly (D70/D71):** execution A reaches terminal and
  its claim is released through the normal path; execution B then acquires the workspace-writer
  claim for the same physical worktree; a *delayed* Hook 1 callback for A (representing a
  reconciliation event scheduled while A was still active but only run after B's own
  acquisition) is then invoked — it reads A's own persisted `workspaceOwnerId`, calls
  `releaseWorkspaceWriterIfOwned` with it, receives `{released: false, reason:
  'not-current-owner'}`, and B's claim is completely unaffected (session/turn state, `status`,
  every field unchanged).
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- Simulating a server restart with a persisted, orphaned `activeTurn` that is genuinely
  settled releases that turn's workspace-writer claim (via `workspaceOwnerId` recovered from
  its own durable record, never an in-memory value) via the same boot-time reconciliation that
  already handles the orphaned turn itself; an orphaned `activeTurn` that left dirty,
  un-finalized state is instead marked `recovery-required` (ownership-conditionally) and blocks
  every subsequent writer.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- **Boot reconciliation with no persisted `workspaceOwnerId` available at all fails closed:**
  no release, no mark-recovery-required — the claim is left exactly as found.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- `workflow verify-human --approve`/`--request-changes` acquires the workspace-writer slot and
  git-finalize lease via `activateAndSubmitHumanStep` (not a bare `startHumanStep`/
  `submitHumanStepResult` call) — proven by racing it against an active agent execution and
  observing it wait, identically to the dashboard's own combined-submit path.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- **A human-submit's durable request is persisted, `status: 'pending'`/`'queued'`, before
  `acquireWorkspaceWriter` is ever called (D73):** proven by inspecting both durable records'
  existence immediately after submission, before any contention attempt begins, and before
  `startHumanStep` runs (no `workflow_progress` mutation yet).
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- **A human-submit request survives a simulated dashboard restart while
  `waiting-for-workspace`:** rediscovered afterward with identical content, resumes contending
  for the slot, and completes normally once the slot frees — the submitted decision is never
  silently dropped.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- **A partially-started human-submit (durable operation record `pending`, workspace-request
  `running`, but `finishStep`'s own state ambiguous) is reconciled after restart — never
  blindly re-run, never duplicated.**
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- A pending human-submit request waiting on an active agent reports `waiting-for-workspace`;
  once that agent's claim is marked `recovery-required` instead of released, the same pending
  request's reported status changes to `blocked-by-recovery` — neither ever surfaces as a
  generic timeout failure.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- When an agent execution finishes with both a pending human decision and a next-queue agent
  item available, the worktree-wide dispatch-priority check defers the next agent item until
  the pending human decision's own `activateAndSubmitHumanStep` call has acquired, run, and
  released the workspace-writer slot.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- **Worktree-wide dispatch priority across specs (D74):** Spec A's agent finishes with Spec
  B's own pending Publish request already durable and `queued`/`waiting-for-workspace`, and
  Spec A's own next agent item is also eligible — dispatch defers Spec A's next agent item
  until Spec B's request is no longer pending, proven directly with two fixture specs sharing
  one physical worktree; a request for one worktree never influences dispatch for a
  genuinely independent worktree (not applicable to this single-checkout architecture today,
  but the query itself must not silently assume a single global list).
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
  workspace-writer claim by wiring an unconditional force-release directly to turn-terminal
  without an intervening `assessExecutionSettlement` call **and** an ownership check. No file
  reads `listPendingWorkspaceWriters(specId)` as the authority for dispatch priority.

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
logic itself, the `git-finalize-lock.mjs`/`workspace-writer.mjs`/`workspace-request.mjs`/
`execution-settlement.mjs` primitives themselves — including the ownership-conditional API's
own mechanics and the durable request queue's own record shape/atomicity
(`dependency-release-and-invalidation`, task 27 — this task only imports and calls their
exports with the right identity). `handleWorkflowStepStart`/`handleWorkflowStepFinish`'s own
`cli-manual` workspace-writer wrapping in `cli.mjs` (task 27, D62 — a distinct pair of
functions from `handleWorkflowVerifyHuman`, which this task does edit, D63). Resolving a
`recovery-required` claim or a `reconciliation-required` workspace-request once marked
(D61/D75 — a future task's own scope). Publish's/Batch Publish's own durable workspace-request
creation and stage machine (`user-mutation-source-control-finalization`, task 31, D76). Any
form of concurrent agent execution. Implementing cross-spec workspace-writer arbitration
itself (this task only calls the already-cross-spec-keyed primitive, D65 — the keying
correction is task 27's own scope).
