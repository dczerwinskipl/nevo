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
dashboard and CLI share one arbitration-safe implementation. **Dispatch priority** (D57):
before admitting the sequential queue's next automatic agent item, this area services any
already-pending, explicitly user-submitted workspace mutation first — reported to the caller
as `waiting-for-workspace` or, if the workspace is in `recovery-required`, `blocked-by-recovery`
(D67), never a generic failure. Every eligible agent-owned destination this area produces is
handed to the sequential queue (`areas/deterministic-sequential-queue.md`) for ordering.

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
  (D41/D49) — and it also claims the workspace-writer slot, in one fixed lock order (D55/D66).**
  `admitAgentExecution(specId, candidate)`
  (`tools/dashboard/server/ai/orchestration/admission.mjs`) is the **only** path that can
  create a new agent session — never a human interaction. It reuses
  `AgentTurnRuntime.#acquireStartLock`'s exact promise-chain-mutex pattern, keyed by
  `specId`, for its own short-lived check-then-claim moment: acquire the admission mutex →
  re-read active-execution state → if occupied, reject/defer (candidate stays eligible) → if
  free, mark occupied **and claim the workspace-writer slot second** (`workspace-writer.mjs`,
  task 27, `kind: 'agent'`, recording `sessionId`/`taskId` — the workspace-writer claim is now
  scoped to the whole physical worktree, D65, not merely this spec) → synchronously drive
  session/turn creation to the point its canonical identity is durably observable → only then
  release the (short-lived) admission mutex — **the workspace-writer claim stays held for the
  entire active execution, until that execution is proven *settled*** (D59/D60), never merely
  because its turn reached terminal. **If creation fails after either claim but before durable
  visibility, both are rolled back together, in reverse acquisition order** (workspace-writer
  claim, then admission mutex, D66) — the candidate remains eligible/retryable; the spec is
  never left falsely, permanently occupied. Manual Start, batch Start, automatic continuation,
  and remediation execution for **agent-owned** candidates all funnel through this one gate.
  No other workspace-writing path (human-submit, Publish, Batch Publish, `cli-manual`) ever
  acquires the admission mutex — only the workspace-writer claim (D66).
- **Settlement-gated release, not turn-terminal (D59/D60/D61).** Hook 1 (per-turn
  subscription) and Hook 3 (boot-time orphaned-turn reconciliation) no longer release an
  agent's workspace-writer claim directly on terminal/orphan detection. Each first calls
  `assessExecutionSettlement` (`execution-settlement.mjs`, task 27): no in-flight
  start-operation or finish-operation record remains for the task, its `workflow_progress`
  position for that attempt is not `active`, and no dirty tracked change remains within the
  task's own owned scope. All hold → `forceReleaseWorkspaceWriter`. Any fail, with the
  execution genuinely no longer running → `markWorkspaceWriterRecoveryRequired` — the claim is
  retained, blocking every subsequent writer, never silently released, never auto-cleaned. A
  false alarm (the execution is, on inspection, still genuinely active) leaves the claim
  untouched.
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
  - **One implementation, two callers (D63).** `cli.mjs`'s `handleWorkflowVerifyHuman`
    (`--approve`/`--request-changes`) calls this exact same `activateAndSubmitHumanStep`
    instead of retaining its own legacy `startHumanStep` → `submitHumanStepResult` path — the
    CLI never bypasses workspace-writer/git-finalize arbitration. Its `--confirm` branch
    (writing an untracked signoff record, no `workflow_progress`/`change.yaml` mutation) is
    unaffected and needs no claim.
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
- **Request-level waiting survives low-level acquisition timeouts (D67).** A pending
  human-submit's own durable request reports `waiting-for-workspace` (ordinary contention) or
  `blocked-by-recovery` (the workspace-writer claim it's waiting on is `recovery-required`) —
  never a generic failure, and never allowed to fail outright merely because
  `acquireWorkspaceWriter`'s own internal bounded retry timeout elapsed once; the request
  transparently re-attempts across any number of such internal cycles.

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
- **Canonical lock ordering, no exceptions (D66):** admission mutex before workspace-writer
  claim, always, on the one path (agent) that ever acquires both; no other path acquires the
  admission mutex at all. Rollback on failure releases in the reverse order.
- A workspace-writer claim's release is never wired directly to AI/session turn-terminal —
  always gated on `assessExecutionSettlement` (D59/D60), and `forceReleaseWorkspaceWriter` is
  called only once that check reports settled (D61).
- The workspace-writer slot's scope is the physical worktree (D65) — this area's own
  invariant is therefore no longer "per specification" for that one primitive, even though
  the agent-admission lock and D33's "one active execution per spec" remain unchanged and
  spec-scoped.

## Interfaces and boundaries

Exposes: the always-shown execution-policy picker; `admitAgentExecution` (agent-owned only,
also claiming the workspace-writer slot per D66's ordering); `reconcileWorkflowPosition`; the
human interaction preview (via `actions.mjs`); `activateAndSubmitHumanStep` (now also the
CLI's own `workflow verify-human` implementation, D63); the dispatch-priority check (D57); the
settlement-gated release wired into Hooks 1/3 (D59/D61).

Consumed by: `areas/deterministic-sequential-queue.md` (agent-owned eligible destinations,
read only after this area's dispatch-priority check clears); `dependency-release-and-invalidation`
(the git-finalize lease, the workspace-writer slot, and `execution-settlement.mjs` this area
claims/threads/calls); `tools/specs/workflow/cli.mjs` (`handleWorkflowVerifyHuman`'s
delegation to `activateAndSubmitHumanStep`, D63 — a distinct function from the same file's
`cli-manual` wiring, owned by task 27).

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
- No file in this area contains a `switch`/`if`/lookup-object keyed on a literal step id, and
  no file describes human interaction activation as "agent admission," or the workspace-writer
  slot as interchangeable with the admission lock or the git-finalize lease. No file releases
  a workspace-writer claim by wiring `forceReleaseWorkspaceWriter` directly to turn-terminal
  without an intervening settlement check.

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
`recovery-required` claim once marked (D61). **The workspace-writer slot's own scope is no
longer "per specification"** — D65 corrects it to the physical worktree, and this area's own
agent-admission invariant (D33/D41/D49) remains the only piece of this design that is still
scoped strictly per spec.
