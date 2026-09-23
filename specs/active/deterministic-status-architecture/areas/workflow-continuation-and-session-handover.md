# Area: Workflow continuation and session handover

## Responsibility

Own the application/orchestration layer between a finished workflow position and the next
execution surface. This area covers: the execution-mode/provider selection UX for a spec's
first explicit `start-step`/batch-Start, **always** shown when no change-level policy exists
(D21); a declarative per-transition `continuation: auto | owner-action` policy (D25) that
marks eligibility only — never immediate execution; a declarative per-transition `execution:
{session, role}` policy (D26); **the one spec-level agent-admission gate**
(`admitAgentExecution`, D41/D49) every **agent-owned** execution path funnels through,
atomically enforcing "at most one active agent execution per spec," with a rollback path if
the claim never becomes durably visible; **the shared workspace-writer slot** (D55/D56, now
scoped to the whole physical worktree, D65) — which `admitAgentExecution` also claims, for the
whole lifetime of the admitted execution *until that execution is proven settled* (D59/D60),
distinct from the admission gate itself and from the narrower git-finalize lease, acquired
after it in one fixed, documented ordering (D66); **continuation reconciliation** (D42),
triggered from three real server-side points, never a fictitious global turn event — the same
three points now also drive settlement-gated workspace-writer release (D59/D61), never a bare
turn-terminal release; and **the human dispatch path** (D47/D49) — a distinct branch, never
called "agent admission," that exposes a mutation-free interaction preview and, on the user's
own combined submit, claims the workspace-writer slot for its own short duration and performs
activation + result submission + finalization as one self-owned operation under a nested
git-finalize lease, reused identically by the CLI's own `workflow verify-human` (D63) so
dashboard and CLI share one arbitration-safe implementation, and now persisting a durable
human-submit request (D73), CAS-transitioned through its own lifecycle (D83), before any of
that begins. **All workspace-writer claim reconciliation this area performs (turn-terminal,
boot orphan recovery, failed-admission rollback) is ownership-conditional and atomic under the
workspace-control lock** — it verifies the exact claim it means to touch, by `requestId` for
its own human-submit requests (D82) and by `workspaceOwnerId` for agent claims, before touching
it, as one indivisible critical section, never a blind worktree-global mutation and never a
separate read-then-later-write (D70/D71/D80). A dead pid on this area's own human-submit claim
never means safe release — it triggers durable request/operation reconciliation instead (D79).
**Dispatch priority** (D57): before
admitting the sequential queue's next automatic agent item, this area services any
already-pending, explicitly user-submitted workspace mutation first, read from a durable,
physical-worktree-scoped request queue — not one spec's own in-process waiters (D65/D72/D74) —
reported to the caller as `waiting-for-workspace` or, if the workspace is in
`recovery-required`, `blocked-by-recovery` (D67), never a generic failure, and surviving a
dashboard restart (D75). Every eligible agent-owned destination this area produces is handed to
the sequential queue (`areas/deterministic-sequential-queue.md`) for ordering.

## Current state (grounded, 2026-09-22)

`startStep()` (`specification-detail-content.tsx`) creates a session directly, bypassing any
queue/admission concept. `startHumanStep` (`human-step/operations.mjs`) calls
`ensureStepActivated` directly — confirmed by reading the function — mutating
`workflow_progress` (hence `change.yaml`) with no commit of its own; only
`submitHumanStepResult` → `finishStep` later commits. `CommitAndPushAction`
(`commit-and-push.mjs`) always `derived.push('specs/active/<changeSlug>/change.yaml')` —
confirmed by reading it — so *any* task's own commit-and-push in the same change stages and
commits the entire current on-disk `change.yaml`, including another task's still-uncommitted
mutation. Under D45 (pending human decisions don't block the agent queue), a different task's
own agent-driven `finishStep` can run concurrently with a human decision — creating exactly
this leak risk for human auto-activation, the same class of bug D29 already fixed for
Publish. `AgentTurnRuntime.#eventStream.emit` is keyed per-`turnId` (no global "any turn
terminal" bus); `startTurn()` returns before the turn completes. `AgentSessionService`
(`service.mjs`) centralizes every `startTurn()` call server-wide. `human-step-transport.mjs`
already `await`s `submitHumanStepResult` synchronously. `AgentTurnRuntime.#acquireStartLock`
is an in-process promise-chain mutex — correct for admission (dashboard-internal), but an
agent's `workflow step finish` runs in its own **CLI subprocess**, a separate OS process from
the dashboard server, so a finalize-serialization lock must be cross-process, not an
in-process mutex. **Prior-pass gap (D55/D56):** the git-finalize lease alone only protects
the mutate-then-commit *instant* — it is not held while an agent is actively editing the
shared worktree for the whole duration of its turn (from `workflow step start` succeeding
until its own eventual `finishStep`), so a concurrently-submitted human decision or Publish
(legal under D45, which never gated either on "is an agent currently active") could encounter
the agent's own dirty files, fail with a scope error, or interfere with its in-progress edits
— closed by the workspace-writer slot. **New gaps this pass closes (D59–D67):** releasing
that same workspace-writer claim merely because the AI/session turn reached terminal is
itself unsafe — a failed/cancelled turn can leave `workflow step start`'s own mutation
un-finalized, and a "completed" turn's own `finishStep` may not have fully settled; boot-time
orphan reconciliation unconditionally force-releasing an ambiguous claim compounds this; the
raw CLI (`workflow step start`/`finish`/`verify-human`) had no workspace-writer coverage at
all, a second, arbitration-free path to the identical mutation; and the workspace-writer
record was keyed by `specId`, so two different specs sharing this one physical checkout never
arbitrated against each other at all.

## Requirements

- **Execution-mode/provider selection, always shown (D21).** Whenever a spec/change has no
  resolved execution policy, the first explicit `start-step`/batch-Start **always** shows the
  provider + mode picker (sensible defaults preselected) — never conditioned on provider
  capability. Confirming persists `{provider, mode}` as the change-level default via a real
  server transport.
- **Continuation is eligibility, not scheduling (D25).** Unchanged from prior passes.
- **One spec-level agent-admission gate, atomic through to durable visibility, with rollback
  (D41/D49) — claims the workspace-writer slot in one fixed lock order, enriches it with
  `sessionId` before `AgentTurnRuntime.startTurn()` is ever called, `turnId` only after it
  returns (D55/D66/D89, sequencing corrected D93, grounded in the real runtime API).**
  `admitAgentExecution(specId, candidate)`
  (`tools/dashboard/server/ai/orchestration/admission.mjs`) is the **only** path that can
  create a new agent session — never a human interaction. `startTurn()`
  (`turns/runtime.mjs`, forbidden path) allocates `turnId` synchronously inside its own call and
  schedules the actual provider spawn via `queueMicrotask` before the caller's own `await`
  resumes — no external caller can hold a known `turnId` and still delay that spawn without
  editing that forbidden file. `sessionId`, by contrast, is genuinely available first, via the
  already-accepted `AgentSessionService.createSession()`, which allocates and persists it
  synchronously before any provider-native side effect runs. It reuses
  `AgentTurnRuntime.#acquireStartLock`'s exact promise-chain-mutex pattern, keyed by
  `specId`, for its own short-lived check-then-claim moment: acquire the admission mutex →
  re-read active-execution state → if occupied, reject/defer (candidate stays eligible) → if
  free, mark occupied **and claim the workspace-writer slot second** (`workspace-writer.mjs`,
  task 27, `kind: 'agent'`, `specId`/`taskId` only — `sessionId`/`turnId` genuinely do not exist
  yet — the workspace-writer claim is now scoped to the whole physical worktree, D65, not merely
  this spec) → `createSession(...)` → obtain the canonical `sessionId` → **first
  ownership-conditional enrichment**, `sessionId` only (`updateWorkspaceWriterIfOwned`, D89/D93
  — a `not-current-owner` result here fails the whole admission closed) → persist
  `workspaceOwnerId` through `AgentSessionBindingService.setWorkspaceOwnerId` (D71, grounded)
  → release the (short-lived) admission mutex → call `startTurn({..., sessionId, ...})`,
  **passing the already-decided `sessionId` in**, so the provider's own already-scheduled spawn
  sets `NEVO_SESSION_ID` to a value that already matches the claim, even though the spawn itself
  precedes the next step → once `startTurn()`'s own promise resolves, **second
  ownership-conditional enrichment**, adding `turnId` (same mechanism, called again; it does not
  gate the already-real, already-running turn). **The workspace-writer claim stays held for the
  entire active execution, until that execution is proven *settled*** (D59/D60), never merely
  because its turn reached terminal. **If session creation or the first enrichment fails after
  the claim exists but before durable visibility, everything is rolled back together, in reverse
  acquisition order** (workspace-writer claim, via the ownership-conditional release using the
  `ownerId` this same attempt just acquired, D70, then admission mutex, D66) — the candidate
  remains eligible/retryable; `startTurn()` is never called against a claim whose `sessionId`
  never got durably enriched. Manual Start, batch Start,
  automatic continuation, and remediation execution for **agent-owned** candidates all funnel
  through this one gate. No other workspace-writing path (human-submit, Publish, Batch
  Publish, `cli-manual`) ever acquires the admission mutex — only the workspace-writer claim
  (D66).
- **Settlement-gated, ownership-conditional release, not turn-terminal (D59/D60/D61/D70/D71).**
  Hook 1 (per-turn subscription) and Hook 3 (boot-time orphaned-turn reconciliation) no longer
  release an agent's workspace-writer claim directly on terminal/orphan detection. Each first
  calls `assessExecutionSettlement` (`execution-settlement.mjs`, task 27): no in-flight
  start-operation or finish-operation record remains for the task, its `workflow_progress`
  position for that attempt is not `active`, and no dirty tracked change remains within the
  task's own owned scope. All hold → read `workspaceOwnerId` from the same durable session/turn
  record (never an in-memory closure, D71) and call `releaseWorkspaceWriterIfOwned` with that
  exact expected owner/session/turn identity (D70) — a mismatch (the claim already belongs to a
  *different*, later execution because this reconciliation ran late) is a safe no-op, never a
  corruption of that other execution's own active claim. Any settlement fail, with the
  execution genuinely no longer running → the same ownership-conditional
  `markWorkspaceWriterRecoveryRequiredIfOwned` call — the claim is retained, blocking every
  subsequent writer, never silently released, never auto-cleaned. A false alarm (the execution
  is, on inspection, still genuinely active) leaves the claim untouched. If no persisted
  `workspaceOwnerId` can be found for the execution being reconciled at all, identity is
  unestablished — do nothing, fail closed (D71).
- **Continuation reconciliation, three real hook points (D42).** Unchanged in mechanism
  (`AgentSessionService`'s per-turn subscription; `human-step-transport.mjs`'s post-submit
  call; boot/first-request reconciliation) — but for a **human-owned** destination, it no
  longer calls `startHumanStep` automatically (see below); it only makes the interaction
  available.
- **Human dispatch is a distinct branch — never "agent admission" (D47/D49).**
  - **Interaction preview requires no mutation.** For a `waiting-for-step-start` position
    whose destination step is human-owned, the dashboard action DTO (`actions.mjs`, task 14's
    existing file) computes an interaction-actions preview
    (`{result?, label, feedbackRequired}[]`) purely from the workflow definition's own
    declared transitions for that step — no `ensureStepActivated` call, no mutation.
    `HumanStepSurface` renders this identically to the active-interaction case.
  - **Persists a durable human-submit request first, before any contention or mutation, at
    most one non-terminal per attempt (D73/D90).** The submitted transition/result/feedback/
    inputs are written to a new durable record (`human-step/submit-request.mjs`, task 29) and a
    paired workspace-request (`kind: 'human-submit'`, D72) is created `status: 'queued'`
    **before** `activateAndSubmitHumanStep` ever calls `acquireWorkspaceWriter` — this is what
    makes the submitted decision survive a dashboard restart while waiting; the mutation-free
    preview itself is completely unaffected. An identical resubmission while a prior one is
    still non-terminal reuses it idempotently; a conflicting one is rejected
    (`HUMAN_DECISION_CONFLICT`), never overwriting the stored decision (D90).
  - **Claims the workspace-writer slot for its own short duration, embedding its own
    `requestId`, then one git-finalize lease nested inside it (D55/D50/D82).**
    `activateAndSubmitHumanStep` claims the workspace-writer slot (`kind: 'human-submit'`,
    `requestId` embedded at acquisition, D82) — waiting for it if an agent (or another writer)
    currently holds it, per D55's arbitration rule, its own wait reported via the durable
    request's `waiting-for-workspace`/`blocked-by-recovery` status (D67/D72); a dead pid found
    on a live request-backed claim here is reconciled by the one shared, generic
    `reconcileRequestBackedWorkspaceClaim` (D79/D88) — never a bare delete, and this area's own
    code contains no per-kind reconciliation logic of its own. Once held, **re-reads the
    request's own authoritative durable state and attempts a CAS transition to `running`
    (`expectedStatus: ['queued', 'waiting-for-workspace']`, storing the acquired
    `workspaceOwnerId`, D83)**; only on a successful transition does it proceed — a failed CAS
    (the request is already `running`/`completed`/`failed`/`reconciliation-required`, meaning a
    different processor already owns it) releases the just-acquired claim
    (ownership-conditionally) and does **not** execute the operation. On success, acquires
    exactly **one** git-finalize lease (before `startHumanStep` — activation is itself a
    tracked mutation needing protection), calls `startHumanStep` followed by
    `submitHumanStepResult` → `finishStep`, passing that same lease through as `finishStep`'s
    `finalizeLease` input so `finishStep` does **not** acquire a second one (self-deadlock
    avoidance, D50), releases the git-finalize lease after `finishStep` returns (unaffected by
    the correction below — its own narrow correctness never depended on the wider operation's
    settlement).
  - **The workspace-writer slot releases only after the combined operation is proven settled —
    never in a bare `finally` (D87).** Whatever `finishStep`'s own outcome — a returned result
    of any shape, or a thrown error — call `assessExecutionSettlement` (D60, reused unchanged).
    **Settled** → mark the durable human-submit operation record and its paired
    workspace-request `completed`/`failed` **first**, then release the workspace-writer slot
    (ownership-conditionally, using the request's own stored `workspaceOwnerId`, D70) — in that
    order, so the durable records are already authoritative the instant the slot frees up.
    **Not settled** → mark the request `reconciliation-required`; mark the claim
    `recovery-required` if the execution is genuinely no longer running — **the claim is
    retained, not released, in this branch.** No intervening `await` boundary hands control to
    another caller between the activation write and the eventual commit. A crash after the Git
    commit lands but before the durable completion markers are written is recovered on restart
    by the identical settlement check (D75).
  - **Restart resumes a pending human-submit exactly once, never drops it, never duplicates it
    (D73/D75/D82/D83).** After a restart, a `pending` human-submit operation record paired with
    a non-terminal workspace-request is rediscovered, its ordering preserved via the request's
    own `requestSequence`, and resumed by re-invoking `activateAndSubmitHumanStep` — which
    re-attempts the same CAS transition above, so a request another processor already promoted
    to `running` (or completed) is never re-executed — reconciled via `requestId` matching, not
    a `kind`/`specId`/`taskId` heuristic, if it may have already partially landed.
  - **Two nested layers of serialization, not one.** The workspace-writer slot (outer,
    D55/D56) prevents this operation from ever starting while an agent — or Publish — is
    actively holding the shared worktree; the git-finalize lease (inner, D47/D50/D51) governs
    only the mutate-then-commit instant once this operation already owns the worktree.
    `admitAgentExecution` is never called for this branch (D49) — only the workspace-writer
    slot and the git-finalize lease are, in that nesting order.
  - **One implementation, two callers (D63).** `cli.mjs`'s `handleWorkflowVerifyHuman`
    (`--approve`/`--request-changes`) calls this exact same `activateAndSubmitHumanStep`
    instead of retaining its own legacy `startHumanStep` → `submitHumanStepResult` path — the
    CLI never bypasses workspace-writer/git-finalize arbitration. Its `--confirm` branch
    (writing an untracked signoff record, no `workflow_progress`/`change.yaml` mutation) is
    unaffected and needs no claim.
- **Session policy on the transition, role extensible (D26).** Unchanged.
- **Preserve Finding 8.** `HumanStepSurface`'s existing definition-driven rendering is
  unchanged by any of the above — only *when* the underlying mutation happens changes.
- **Dispatch priority: pending user mutations before the next automatic agent item, read from
  the durable, worktree-wide request queue (D57/D65/D74).** Immediately before calling
  `admitAgentExecution` for the sequential queue's own `nextRunnable` item, this area queries
  `workspace-request.mjs`'s durable queue (task 27) for any `queued`/`waiting-for-workspace`
  request **anywhere in the physical worktree** — not filtered by the spec whose next agent
  item is under consideration, since D65 already made the underlying claim itself
  worktree-scoped. If one exists, dispatch defers for *every* spec sharing that worktree — only
  once no such request remains does dispatch proceed to `admitAgentExecution` for the next
  eligible agent item, in any spec. `workspace-writer.mjs`'s own in-process pending-waiters
  view is retained only as a same-process wakeup optimization, never consulted as the
  scheduling authority. No application code branches on a literal action name to implement
  this — it is a generic, `kind`-based check over durable records.
- **Request-level waiting survives low-level acquisition timeouts, and survives a restart
  (D67/D72/D75).** A pending human-submit's own durable request reports `waiting-for-workspace`
  (ordinary contention) or `blocked-by-recovery` (the workspace-writer claim it's waiting on is
  `recovery-required`) — never a generic failure, and never allowed to fail outright merely
  because `acquireWorkspaceWriter`'s own internal bounded retry timeout elapsed once; the
  request transparently re-attempts across any number of such internal cycles. Because the
  request itself is a durable record (D72), this survives a dashboard restart too — a request
  still `queued`/`waiting-for-workspace` after restart is rediscovered and simply resumes
  waiting, never silently lost the way an in-process-only waiter would be.

## Constraints

- No step-id/name dispatch anywhere in this area.
- `finishStep`/`ensureStepActivated`/`startHumanStep`/`submitHumanStepResult` stay the only
  mutating engine entry points; `activateAndSubmitHumanStep` is a thin composition of the
  latter two, not a new implementation.
- `admitAgentExecution` must never be called for a human-owned destination, and no area/task
  artifact describes human dispatch as a form of admission.
- This area's dashboard-side modules live under `tools/dashboard/server/ai/orchestration/**`
  plus two real, existing files it corrects (`service.mjs`, `human-step-transport.mjs`); both
  the git-finalize lease and the workspace-writer slot live in workflow core (task 27), not
  here, since a CLI subprocess must be able to acquire the git-finalize lease too, and the
  workspace-writer record's own reconciliation must be readable/writable from wherever it's
  needed.
- No new public API is added to `tools/dashboard/server/ai/sessions/turns/runtime.mjs`.
- The agent-admission lock, the workspace-control lock, the workspace-writer slot, and the
  git-finalize lease are never conflated: this area owns/calls the first directly,
  claims-and-releases the third around an admitted execution's lifetime and around
  `activateAndSubmitHumanStep`'s own duration (via the second, briefly, for each record
  mutation), and threads/acquires the fourth only for the mutate-then-commit instant nested
  inside whichever of the first/third currently applies.
- **Canonical lock ordering, no exceptions, now including the control lock (D66/D84):**
  admission mutex before the workspace-control lock, always, on the one path (agent) that ever
  acquires both; no other path acquires the admission mutex at all. The workspace-control lock
  is always the innermost, briefest-held primitive in any sequence — never held while waiting
  on the workspace-writer claim itself, an agent turn, `activateAndSubmitHumanStep`, or the
  git-finalize lease. Rollback on failure releases in the reverse order.
- A workspace-writer claim's release is never wired directly to AI/session turn-terminal —
  always gated on `assessExecutionSettlement` (D59/D60), and the ownership-conditional release
  is called only once that check reports settled, using `workspaceOwnerId` read from this
  execution's own durable record (D61/D70/D71), as one atomic critical section under the
  workspace-control lock (D80) — never a blind, unconditional release, and never a
  separate read-then-later-write.
- Dispatch priority (D57) is decided from the durable `workspace-request.mjs` queue for the
  whole physical worktree, never from a single spec's own `listPendingWorkspaceWriters` view
  (D65/D74).
- A human-submit is never acquired/mutated before its own durable request record exists (D73),
  and its own workspace-writer claim always embeds that request's own `requestId` (D82); no
  processor executes its underlying operation without first winning the CAS transition to
  `running` (D83).
- A dead pid on this area's own `human-submit` claims never triggers a bare delete — always
  durable request/operation reconciliation first (D79).
- The workspace-writer slot's scope is the physical worktree (D65) — this area's own
  invariant is therefore no longer "per specification" for that one primitive, even though
  the agent-admission lock and D33's "one active execution per spec" remain unchanged and
  spec-scoped.

## Interfaces and boundaries

Exposes: the always-shown execution-policy picker; `admitAgentExecution` (agent-owned only,
also claiming the workspace-writer slot per D66/D84's ordering and persisting `workspaceOwnerId`,
D71); `reconcileWorkflowPosition`; the human interaction preview (via `actions.mjs`);
`activateAndSubmitHumanStep` (now also the CLI's own `workflow verify-human` implementation,
D63, now creating a durable human-submit request/operation first (D73) and CAS-transitioning
it before executing (D83)); the worktree-wide dispatch-priority check (D57/D74); the
settlement-gated, ownership-conditional, control-lock-protected release wired into Hooks 1/3
(D59/D61/D70/D71/D80); dead-pid reconciliation for its own `human-submit` claims (D79).

Consumed by: `areas/deterministic-sequential-queue.md` (agent-owned eligible destinations,
read only after this area's dispatch-priority check clears); `dependency-release-and-invalidation`
(the git-finalize lease, the workspace-writer slot, `execution-settlement.mjs`, and
`workspace-request.mjs` this area claims/threads/calls); `tools/specs/workflow/cli.mjs`
(`handleWorkflowVerifyHuman`'s delegation to `activateAndSubmitHumanStep`, D63 — a distinct
function from the same file's `cli-manual` wiring, owned by task 27).

## Area-specific acceptance criteria

- A first `start-step`/batch-Start for a change with no resolved execution policy always
  shows the picker.
- Two simultaneous `admitAgentExecution` requests for the same spec never both result in a
  created session.
- A session/turn-creation failure occurring after the claim is marked but before it becomes
  durably visible leaves the spec's slot free again — a subsequent admission request for the
  same spec succeeds, proving no stale occupied state survives the failure.
- Reaching a human-owned destination via reconciliation exposes the interaction preview with
  **no** `workflow_progress`/`change.yaml` mutation — proven by inspecting git status before
  the user submits anything.
- Clicking Approve/Request-changes performs activation + submission + commit as one
  operation, under exactly **one** acquired lease — proven by asserting exactly one
  acquire/release pair for the whole call, never two, and never a self-deadlock/timeout.
- While `activateAndSubmitHumanStep` holds its lease, a concurrently-triggered agent
  `finishStep` for a different task in the same spec (which acquires its own lease, since it
  wasn't given one) waits rather than committing a dirty `change.yaml`.
- A human-owned destination reached via reconciliation never calls `admitAgentExecution`.
- **Workspace-writer arbitration:** while an agent's execution holds the workspace-writer
  slot (actively editing source files, worktree dirty), a concurrently-submitted
  `activateAndSubmitHumanStep`/Publish request waits for the slot rather than proceeding — it
  never observes or absorbs the agent's own dirty tracked files or `change.yaml` state, and
  never fails with a scope error caused by the agent's own unrelated dirty files. This holds
  even when the waiting request targets a **different spec** sharing the same physical
  worktree (D65).
- **Settlement-gated release, not bare turn-terminal:** a turn that reaches terminal with
  `finishStep` never invoked (its own `workflow step start` mutation left un-finalized), or
  whose finish-operation record is still `running`, does **not** release the workspace-writer
  claim — it moves to `recovery-required`, and a waiting `activateAndSubmitHumanStep`/Publish
  request stays blocked (reporting `blocked-by-recovery`, D67), never proceeding onto
  unreconciled dirty state. Only a turn whose settlement is actually proven (`finishStep`
  completed, position no longer `active`, no dirty in-scope files) releases the claim — and
  only then does a waiting request proceed.
- **Dispatch priority:** when an agent finishes with both a pending human decision and a
  next-queue agent item available, the pending human decision's own operation runs before the
  next automatic agent item is admitted — but only once the agent's claim is actually released
  under the settlement-gated rule above, not merely once its turn reports terminal.
- A failed agent admission/session creation releases both the admission marker and the
  workspace-writer claim, in reverse acquisition order (D66) — a subsequent admission request
  for the same spec succeeds.
- **CLI parity:** `workflow verify-human --approve`/`--request-changes` acquires the
  workspace-writer slot and git-finalize lease via the same `activateAndSubmitHumanStep` the
  dashboard uses (D63) — proven by racing it against an active agent execution exactly as the
  dashboard path is raced elsewhere in this area's own criteria.
- **Stale-reconciliation race, proven at this area's own call sites:** a delayed Hook 1
  callback for an execution whose claim was already released and reacquired by a different
  execution is rejected by `releaseWorkspaceWriterIfOwned` as `not-current-owner` and does not
  touch the newer execution's claim.
- **`workspaceOwnerId` recoverable after restart:** boot-time reconciliation (Hook 3) for an
  orphaned turn reads `workspaceOwnerId` from that turn's own durable record, not from any
  in-memory value that a restart would have destroyed; absent that field, no release/mark is
  attempted.
- **Human-submit survives a restart, exactly once:** a submitted Approve/Request-changes whose
  durable request is still `queued`/`waiting-for-workspace`/`running` when the dashboard
  restarts is rediscovered and resumed (or reconciled, never blindly re-run) — the user's
  decision is never silently dropped.
- **Worktree-wide dispatch priority:** Spec A's agent finishes with Spec B's own pending
  Publish/human-submit request already durable and `queued`/`waiting-for-workspace`, and Spec
  A's own next agent item is also eligible — dispatch defers Spec A's next agent item until
  Spec B's request is no longer pending, proven directly with two fixture specs sharing one
  worktree.
- **Dead pid on a `human-submit` claim never means safe release, and is reconciled through the
  same generic path any other kind uses (D88):** a `human-submit` claim whose pid is confirmed
  dead is reconciled through its paired request/operation state — released only if genuinely
  settled, marked `reconciliation-required`/`recovery-required` otherwise — never deleted
  merely because the pid is dead, and never via this area's own bespoke reconciliation code.
- **`requestId` distinguishes two otherwise-identical human-submit requests across attempts —
  never within one non-terminal attempt (D82/D90):** two human-submit requests for *different*
  attempts of the same spec/task remain unambiguously distinguishable via their own claims'
  `requestId`; a crash after claim acquisition but before the request's `running` transition is
  reconciled using the exact `requestId` match.
- **Only one processor executes a given human-submit request:** a stale-viewing processor that
  later acquires the workspace for an already-completed request fails its own CAS transition
  to `running` and does not re-execute `activateAndSubmitHumanStep`'s underlying mutation.
- **Settlement-gated release ordering (D87):** a `finishStep` returning `reconciliation-required`
  leaves the claim held; a successful submission marks the durable records `completed` strictly
  before releasing the claim; a crash after the commit lands but before those markers exist is
  recovered on restart by the identical settlement check, releasing the exact claim only once
  settled.
- **Duplicate/conflict invariant, step-scoped (D90, corrected D94):** two rapid identical
  submissions for one non-terminal attempt collapse to one request; a conflicting decision for
  that same attempt is rejected without overwriting the stored result; a later attempt may
  create a new request normally; a terminal record at that exact `(step, attempt)` is found via
  `loadHumanSubmitOperation` (never `findInFlightHumanSubmitOperation`, which excludes it) and
  is never overwritten by a stale resubmission.
- **Identity enrichment, two steps grounded in the real runtime API (D89, corrected D93):** a
  fresh admission's claim carries `sessionId` before `startTurn()` is ever called; `turnId` only
  after it returns, and its absence during that window never blocks a legitimate CLI reuse; a
  stale enrichment attempt cannot modify a newer claim; a crash before `sessionId` enrichment
  leaves the claim's identity unestablished and blocks release/marking until explicitly
  resolved.
- No file in this area contains a `switch`/`if`/lookup-object keyed on a literal step id, and
  no file describes human interaction activation as "agent admission," or the workspace-writer
  slot as interchangeable with the admission lock or the git-finalize lease. No file releases
  a workspace-writer claim by wiring an unconditional force-release directly to turn-terminal
  without an intervening settlement *and* ownership check. No file reads
  `listPendingWorkspaceWriters(specId)` as the authority for dispatch priority. No file
  implements its own copy of D79's dead-pid reconciliation logic for a kind it doesn't own.

## Dependencies

`areas/agent-step-bootstrap-and-context.md`, `tasks/25-workflow-continuation-schema.md`,
`areas/deterministic-sequential-queue.md`, `areas/dependency-release-and-invalidation.md`
(the git-finalize lock, the workspace-writer slot, and `execution-settlement.mjs` this area's
human operation and reconciliation hooks acquire/call).

## Out of scope

A general-purpose action/dispatch framework. Per-provider handover routing beyond the
provider/mode selection this area's execution policy already resolves. Rolling back or
retrying already-completed work. Deciding *which* eligible agent-owned item runs next when
several are eligible (the queue's own `schedulingPriority` ordering, D34 — this area only
decides *whether* to defer to a pending user mutation first, D57). Writing dependency-
consumption records (owned by workflow core at step activation, D52/D53/D58). Per-task Git
worktrees, parallel branches, concurrent agent execution, or Git merge orchestration — the
workspace-writer slot is arbitration, not isolation. The `cli-manual` workspace-writer kind
and `workflow step start`/`step finish`'s own CLI wrapping (task 27, D62 — this area only
reuses the same claim/settlement primitives for its own dashboard-side paths). Resolving a
`recovery-required` claim, or a `reconciliation-required` workspace-request, once marked
(D61/D75). The `workspace-writer.mjs`/`workspace-request.mjs`/`execution-settlement.mjs`
primitives themselves, and the ownership-conditional API's own mechanics (task 27, D70/D72 —
this area only calls them with the right identity). The durable Publish/Batch Publish
workspace-request's own creation (task 31, D76). **The workspace-writer slot's own scope is no
longer "per specification"** — D65 corrects it to the physical worktree, and this area's own
agent-admission invariant (D33/D41/D49) remains the only piece of this design that is still
scoped strictly per spec.
