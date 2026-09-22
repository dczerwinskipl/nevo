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
the claim never becomes durably visible; **continuation reconciliation** (D42), triggered
from three real server-side points, never a fictitious global turn event; and **the human
dispatch path** (D47/D49) — a distinct branch, never called "agent admission," that exposes a
mutation-free interaction preview and, on the user's own combined submit, performs
activation + result submission + finalization as one self-owned operation, serialized against
other finalize operations via a shared, cross-process git-finalize lock. Every eligible
agent-owned destination this area produces is handed to the sequential queue
(`areas/deterministic-sequential-queue.md`) for ordering.

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
in-process mutex.

## Requirements

- **Execution-mode/provider selection, always shown (D21).** Whenever a spec/change has no
  resolved execution policy, the first explicit `start-step`/batch-Start **always** shows the
  provider + mode picker (sensible defaults preselected) — never conditioned on provider
  capability. Confirming persists `{provider, mode}` as the change-level default via a real
  server transport.
- **Continuation is eligibility, not scheduling (D25).** Unchanged from prior passes.
- **One spec-level agent-admission gate, atomic through to durable visibility, with rollback
  (D41/D49).** `admitAgentExecution(specId, candidate)`
  (`tools/dashboard/server/ai/orchestration/admission.mjs`) is the **only** path that can
  create a new agent session — never a human interaction. It reuses
  `AgentTurnRuntime.#acquireStartLock`'s exact promise-chain-mutex pattern, keyed by
  `specId`: acquire lock → re-read active-execution state → if occupied, reject/defer
  (candidate stays eligible) → if free, mark occupied → synchronously drive session/turn
  creation to the point its canonical identity is durably observable → only then release the
  lock. **If creation fails after the claim but before durable visibility, the claim is
  rolled back** before returning — the candidate remains eligible/retryable; the spec is
  never left falsely, permanently occupied. Manual Start, batch Start, automatic
  continuation, and remediation execution for **agent-owned** candidates all funnel through
  this one gate.
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
  - **One combined, self-owned operation on submit, one lease for the whole sequence
    (D50, corrected).** A new domain operation, `activateAndSubmitHumanStep`
    (`human-step/operations.mjs`), acquires exactly **one** git-finalize lease up front
    (before `startHumanStep` — activation is itself a tracked mutation needing protection),
    then calls `startHumanStep` followed by `submitHumanStepResult` → `finishStep`, passing
    that same lease through as `finishStep`'s `finalizeLease` input so `finishStep` does
    **not** acquire a second one (which would self-deadlock, since this operation already
    calls into `finishStep` internally) — and releases the one lease itself after
    `finishStep` returns. No intervening `await` boundary hands control to another caller
    between the activation write and the eventual commit.
  - **Serialized via the shared git-finalize lease, not the admission gate.** The lease this
    operation holds (owned by `dependency-release-and-invalidation`, task 27) is the same one
    agent-driven `finishStep` (in its own, separate acquisition, when not passed an existing
    one) and Publish acquire — so none of the three ever interleaves with another.
    `admitAgentExecution` is never involved in this branch.
- **Session policy on the transition, role extensible (D26).** Unchanged.
- **Preserve Finding 8.** `HumanStepSurface`'s existing definition-driven rendering is
  unchanged by any of the above — only *when* the underlying mutation happens changes.

## Constraints

- No step-id/name dispatch anywhere in this area.
- `finishStep`/`ensureStepActivated`/`startHumanStep`/`submitHumanStepResult` stay the only
  mutating engine entry points; `activateAndSubmitHumanStep` is a thin composition of the
  latter two, not a new implementation.
- `admitAgentExecution` must never be called for a human-owned destination, and no area/task
  artifact describes human dispatch as a form of admission.
- This area's dashboard-side modules live under `tools/dashboard/server/ai/orchestration/**`
  plus two real, existing files it corrects (`service.mjs`, `human-step-transport.mjs`); the
  git-finalize lock itself lives in workflow core (task 27), not here, since a CLI subprocess
  must be able to acquire it too.
- No new public API is added to `tools/dashboard/server/ai/sessions/turns/runtime.mjs`.

## Interfaces and boundaries

Exposes: the always-shown execution-policy picker; `admitAgentExecution` (agent-owned only);
`reconcileWorkflowPosition`; the human interaction preview (via `actions.mjs`);
`activateAndSubmitHumanStep`.

Consumed by: `areas/deterministic-sequential-queue.md` (agent-owned eligible destinations);
`dependency-release-and-invalidation` (the git-finalize lock this area's human operation
imports).

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
- No file in this area contains a `switch`/`if`/lookup-object keyed on a literal step id, and
  no file describes human interaction activation as "agent admission."

## Dependencies

`areas/agent-step-bootstrap-and-context.md`, `tasks/25-workflow-continuation-schema.md`,
`areas/deterministic-sequential-queue.md`, `areas/dependency-release-and-invalidation.md`
(the git-finalize lock this area's human operation acquires).

## Out of scope

A general-purpose action/dispatch framework. Per-provider handover routing beyond the
provider/mode selection this area's execution policy already resolves. Rolling back or
retrying already-completed work. Deciding *which* eligible agent-owned item runs next when
several are eligible (the queue's own `schedulingPriority` ordering, D34). Writing
dependency-consumption records (moved to workflow core at step activation, D48 — this area no
longer does this).
