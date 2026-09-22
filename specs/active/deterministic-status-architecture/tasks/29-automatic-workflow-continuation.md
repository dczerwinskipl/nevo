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
  - tools/tests/workflow-continuation.test.mjs
forbidden_paths:
  - tools/specs/workflow/finish-operation.mjs
  - tools/specs/workflow/human-step/**
  - tools/specs/workflow/queue/**
  - tools/dashboard/server/ai/sessions/turns/runtime.mjs
  - src/**
depends_on: [ workflow-continuation-schema, execution-policy-and-mode-selection, deterministic-sequential-queue, dependency-release-and-invalidation ]
semantic_references:
  decisions: [D25, D26, D27, D33, D41, D42, D43, D45]
---

# Task: Automatic workflow continuation (server-side admission + reconciliation, not a React page)

## Goal

Build the server-side application/orchestration layer under
`tools/dashboard/server/ai/orchestration/**`: **`admitExecution(specId, candidate)` (D41)**
— the one spec-level, race-safe admission gate every execution path (manual Start, batch
Start, automatic continuation, remediation) must funnel through — and
**`reconcileWorkflowPosition(change, task)` (D42)** — the one shared continuation-
reconciliation operation, triggered from three real, verified server-side points (not a
fictitious global turn event). Also records dependency-consumption provenance (D43) at the
moment a task is actually admitted against a release-epoch-satisfied dependency.

## Implementation constraints

- **`admitExecution` (D41).** New file, `tools/dashboard/server/ai/orchestration/
  admission.mjs`. Reuses the exact promise-chain-mutex pattern
  `AgentTurnRuntime.#acquireStartLock` already proves (`turns/runtime.mjs`, forbidden path —
  read for reference, do not modify), reimplemented here keyed by `specId` instead of session
  id (a small, ~20-line pattern, not a cross-file import of a private method): acquire the
  spec's lock, check whether an agent execution is already active for the spec (reading real
  session/binding state, read-only), and if not, atomically mark it occupied before returning
  "admitted" — check and claim inside the same held lock. Only ever gates on an **agent**
  execution — a pending human interaction never blocks admission (D45).
- **`reconcileWorkflowPosition` (D42).** New file under `orchestration/**`. Given a task,
  resolves its authoritative `workflow_progress` position, finds the matched transition, and
  — if `continuation: auto` — enqueues the destination into the sequential queue (task 28)
  then calls `admitExecution`. On `owner-action` (or absent), no-op.
- **Hook 1 — `AgentSessionService` (`service.mjs`).** `AgentTurnRuntime` has **no** global
  "any turn, anywhere, terminal" event (confirmed: `#eventStream.emit` is keyed per-`turnId`
  for streaming; `startTurn()` returns before the turn actually completes, fired via
  `queueMicrotask`). Correct: when `service.mjs` starts a turn for a session bound to a
  deterministic task, it attaches its own listener via the **existing** per-turn
  `subscribeToSession`-style mechanism (already used for streaming to browser clients) and
  calls `reconcileWorkflowPosition` when that specific turn reaches terminal. Do not add any
  new public API to `runtime.mjs` itself.
- **Hook 2 — `human-step-transport.mjs`.** Its handler already `await`s
  `submitHumanStepResult(...)` synchronously and returns `finishResult`. Add a call to
  `reconcileWorkflowPosition` immediately after that `await` succeeds — this is what makes
  human "Request changes" → `continuation: auto` → agent work re-enqueue immediately and
  deterministically, with no separate mechanism for the human path.
- **Hook 3 — boot/first-request reconciliation (`ai/routes.mjs`).** Extend the existing
  `ensureReconciled()`-style lazy first-request hook (same one `reconcileOrphanedTurns()`
  already uses) to also call `reconcileWorkflowPosition` for every in-progress deterministic
  task across every active spec — covers a server crash/restart between hook 1/2 firing and
  the queue recording it.
- **Dependency-consumption recording, at admission (D43).** When `admitExecution` admits a
  task whose readiness depended on a dependency satisfied only via a release epoch (not a
  terminal `outcome: success`), call `dependency-consumption.mjs`'s
  `recordDependencyConsumption` (task 27, imported not edited) naming the exact epoch relied
  on — this is the one place "this task is starting, and here is which release epoch its
  currently-satisfied dependency relies on" is actually known.
- **Session policy application (D26).** On an admitted agent-owned destination, create/reuse
  a session per the matched transition's `execution: {session, role}` and the resolved
  execution policy (task 26) — reusing D15's existing generic trigger, unchanged.
- **Human-step auto-activation, no admission needed (D27/D45).** On an admitted (enqueued,
  not gated by `admitExecution`) human-owned destination, call `startHumanStep` directly —
  no session, no agent-execution slot claimed.
- No `switch`/`if`/lookup-object keyed on a literal step id anywhere in this task's code.

## Acceptance criteria

- Two simultaneous `admitExecution` calls for the same spec never both return "admitted" —
  proven with a test that races two concurrent calls and asserts exactly one wins.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- A pending human interaction on one task never blocks `admitExecution` from admitting a
  different, independently-eligible agent-owned task in the same spec.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- Simulating a turn reaching terminal via `AgentSessionService`'s own per-turn subscription
  (not a fictitious global event) for `implementation → review` results in `review` being
  enqueued and admitted with `execution: {session: fresh, role: reviewer}`.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- Simulating `submitHumanStepResult` resolving with a `continuation: auto` result (e.g.
  human-verification's "Request changes") results in the resulting agent work being enqueued
  and admitted with no further user action — proven via `human-step-transport.mjs`'s own
  handler, not a separate simulated path.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- Simulating a server restart between a reconciliation-triggering event and the queue
  recording it results in the destination still being enqueued once the boot/first-request
  hook runs.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- A human-owned destination reached via reconciliation calls `startHumanStep` directly with
  no session created and no `admitExecution` call.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- A task admitted against a dependency satisfied only via a release epoch produces a
  dependency-consumption record naming that exact epoch.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- A transition without `continuation: auto` results in nothing enqueued.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- `tools/dashboard/server/ai/sessions/turns/runtime.mjs` gains no new exported API from this
  task's diff.
- No file in this task's scope contains a `switch`/`if`/lookup-object keyed on a literal step
  id.

## Verification

```bash
node --test tools/tests/workflow-continuation.test.mjs
node tools/specs.mjs validate
```

## Out of scope

The workflow-definition schema itself (`workflow-continuation-schema`, task 25). The
execution-policy selection UI/storage (`execution-policy-and-mode-selection`, task 26). The
pure queue/scheduling plan itself (`deterministic-sequential-queue`, task 28 — this task only
consumes it). The dependency-satisfaction/epoch/suspension logic itself
(`dependency-release-and-invalidation`, task 27 — this task only calls its exported
functions). Any form of concurrent execution.
