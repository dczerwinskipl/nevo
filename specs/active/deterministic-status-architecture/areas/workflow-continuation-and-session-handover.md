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
the claim never becomes durably visible; **the shared workspace-writer slot** (D55/D56) —
which `admitAgentExecution` also claims, for the whole lifetime of the admitted execution,
distinct from the admission gate itself and from the narrower git-finalize lease;
**continuation reconciliation** (D42), triggered from three real server-side points, never a
fictitious global turn event; and **the human dispatch path** (D47/D49) — a distinct branch,
never called "agent admission," that exposes a mutation-free interaction preview and, on the
user's own combined submit, claims the workspace-writer slot for its own short duration and
performs activation + result submission + finalization as one self-owned operation under a
nested git-finalize lease. **Dispatch priority** (D57): before admitting the sequential
queue's next automatic agent item, this area services any already-pending, explicitly
user-submitted workspace mutation first. Every eligible agent-owned destination this area
produces is handed to the sequential queue (`areas/deterministic-sequential-queue.md`) for
ordering.

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
in-process mutex. **New gap this pass closes:** the git-finalize lease alone only protects
the mutate-then-commit *instant* — it is not held while an agent is actively editing the
shared worktree for the whole duration of its turn (from `workflow step start` succeeding
until its own eventual `finishStep`), so a concurrently-submitted human decision or Publish
(legal under D45, which never gated either on "is an agent currently active") could encounter
the agent's own dirty files, fail with a scope error, or interfere with its in-progress edits.

## Requirements

- **Execution-mode/provider selection, always shown (D21).** Whenever a spec/change has no
  resolved execution policy, the first explicit `start-step`/batch-Start **always** shows the
  provider + mode picker (sensible defaults preselected) — never conditioned on provider
  capability. Confirming persists `{provider, mode}` as the change-level default via a real
  server transport.
- **Continuation is eligibility, not scheduling (D25).** Unchanged from prior passes.
- **One spec-level agent-admission gate, atomic through to durable visibility, with rollback
  (D41/D49) — and it also claims the workspace-writer slot (D55).** `admitAgentExecution(specId,
  candidate)` (`tools/dashboard/server/ai/orchestration/admission.mjs`) is the **only** path
  that can create a new agent session — never a human interaction. It reuses
  `AgentTurnRuntime.#acquireStartLock`'s exact promise-chain-mutex pattern, keyed by
  `specId`, for its own short-lived check-then-claim moment: acquire lock → re-read
  active-execution state → if occupied, reject/defer (candidate stays eligible) → if free,
  mark occupied **and claim the workspace-writer slot** (`workspace-writer.mjs`, task 27,
  `kind: 'agent'`, recording `sessionId`/`taskId`) → synchronously drive session/turn creation
  to the point its canonical identity is durably observable → only then release the
  (short-lived) admission lock — **the workspace-writer claim stays held for the entire
  active execution**, released only when that execution's turn reaches terminal (D56). **If
  creation fails after either claim but before durable visibility, both the admission marker
  and the workspace-writer claim are rolled back together** — the candidate remains
  eligible/retryable; the spec is never left falsely, permanently occupied. Manual Start,
  batch Start, automatic continuation, and remediation execution for **agent-owned**
  candidates all funnel through this one gate.
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
  - **Claims the workspace-writer slot for its own short duration, then one git-finalize
    lease nested inside it (D55/D50).** `activateAndSubmitHumanStep` first claims the
    workspace-writer slot (`kind: 'human-submit'`) — waiting for it if an agent (or another
    writer) currently holds it, per D55's arbitration rule — then, once held, acquires
    exactly **one** git-finalize lease (before `startHumanStep` — activation is itself a
    tracked mutation needing protection), calls `startHumanStep` followed by
    `submitHumanStepResult` → `finishStep`, passing that same lease through as `finishStep`'s
    `finalizeLease` input so `finishStep` does **not** acquire a second one (self-deadlock
    avoidance, D50), releases the git-finalize lease after `finishStep` returns, then releases
    the workspace-writer slot. No intervening `await` boundary hands control to another caller
    between the activation write and the eventual commit.
  - **Two nested layers of serialization, not one.** The workspace-writer slot (outer,
    D55/D56) prevents this operation from ever starting while an agent — or Publish — is
    actively holding the shared worktree; the git-finalize lease (inner, D47/D50/D51) governs
    only the mutate-then-commit instant once this operation already owns the worktree.
    `admitAgentExecution` is never called for this branch (D49) — only the workspace-writer
    slot and the git-finalize lease are, in that nesting order.
- **Session policy on the transition, role extensible (D26).** Unchanged.
- **Preserve Finding 8.** `HumanStepSurface`'s existing definition-driven rendering is
  unchanged by any of the above — only *when* the underlying mutation happens changes.
- **Dispatch priority: pending user mutations before the next automatic agent item (D57).**
  Immediately before calling `admitAgentExecution` for the sequential queue's own
  `nextRunnable` item, this area checks `workspace-writer.mjs`'s pending-waiters view for any
  already-waiting non-agent (`human-submit`/`publish`/`batch-publish`) acquisition attempt
  for this spec. If one exists, dispatch defers — the already-queued waiter resolves next via
  the slot's own FIFO order once the current holder releases; only once no non-agent waiter
  remains does dispatch proceed to `admitAgentExecution` for the next agent item. No
  application code branches on a literal action name to implement this — it is a generic,
  `kind`-based check.

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
- The agent-admission lock, the workspace-writer slot, and the git-finalize lease are never
  conflated: this area owns/calls the first directly, claims-and-releases the second around
  an admitted execution's lifetime and around `activateAndSubmitHumanStep`'s own duration, and
  threads/acquires the third only for the mutate-then-commit instant nested inside whichever
  of the first two currently applies.

## Interfaces and boundaries

Exposes: the always-shown execution-policy picker; `admitAgentExecution` (agent-owned only,
also claiming the workspace-writer slot); `reconcileWorkflowPosition`; the human interaction
preview (via `actions.mjs`); `activateAndSubmitHumanStep`; the dispatch-priority check (D57).

Consumed by: `areas/deterministic-sequential-queue.md` (agent-owned eligible destinations,
read only after this area's dispatch-priority check clears); `dependency-release-and-invalidation`
(both the git-finalize lease and the workspace-writer slot this area claims/threads).

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
  never fails with a scope error caused by the agent's own unrelated dirty files.
- Once the agent's execution reaches terminal, its workspace-writer claim is released as part
  of the same reconciliation pass that already handles that turn (D42) — a waiting
  `activateAndSubmitHumanStep`/Publish request then proceeds.
- **Dispatch priority:** when an agent finishes with both a pending human decision and a
  next-queue agent item available, the pending human decision's own operation runs before the
  next automatic agent item is admitted.
- A failed agent admission/session creation releases both the admission marker and the
  workspace-writer claim — a subsequent admission request for the same spec succeeds.
- No file in this area contains a `switch`/`if`/lookup-object keyed on a literal step id, and
  no file describes human interaction activation as "agent admission," or the workspace-writer
  slot as interchangeable with the admission lock or the git-finalize lease.

## Dependencies

`areas/agent-step-bootstrap-and-context.md`, `tasks/25-workflow-continuation-schema.md`,
`areas/deterministic-sequential-queue.md`, `areas/dependency-release-and-invalidation.md`
(the git-finalize lock this area's human operation acquires).

## Out of scope

A general-purpose action/dispatch framework. Per-provider handover routing beyond the
provider/mode selection this area's execution policy already resolves. Rolling back or
retrying already-completed work. Deciding *which* eligible agent-owned item runs next when
several are eligible (the queue's own `schedulingPriority` ordering, D34 — this area only
decides *whether* to defer to a pending user mutation first, D57). Writing dependency-
consumption records (owned by workflow core at step activation, D52/D53/D58). Per-task Git
worktrees, parallel branches, concurrent agent execution, or Git merge orchestration — the
workspace-writer slot is arbitration, not isolation. Cross-spec workspace-writer arbitration
(this area's invariant, like D33/D41/D49, is scoped per specification).
