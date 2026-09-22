# Area: Workflow continuation and session handover

## Responsibility

Own the application/orchestration layer between a finished workflow position and the next
execution surface. This area covers: the execution-mode/provider selection UX for a spec's
first explicit `start-step`/batch-Start, **always** shown when no change-level policy exists
(D21, corrected pass 11 — never conditional on provider capability); a declarative
per-transition `continuation: auto | owner-action` policy (D25) that marks eligibility only
— never immediate execution; a declarative per-transition `execution: {session, role}`
policy (D26); auto-activation of a human-owned step on arrival (D27), which never occupies
the spec's single-execution slot (D33/D45); **the one spec-level admission gate**
(`admitExecution`, D41) every execution path funnels through, atomically enforcing "at most
one active agent execution per spec"; and **continuation reconciliation** (D42), triggered
from three real server-side points, never a fictitious global turn event. Every eligible
destination this area produces is handed to the sequential queue
(`areas/deterministic-sequential-queue.md`) for ordering — this area decides *whether* an
execution may start (via `admitExecution`) and *how* (session policy), the queue decides
*which* eligible item is next.

## Current state (grounded, 2026-09-22)

`startStep()` (`specification-detail-content.tsx`) creates a session directly with
`provider: defaultProvider` and no `mode` — bypassing any queue/admission concept entirely.
After `workflow step finish` transitions to `waiting-for-step-start`, nothing creates the
next session. `AgentTurnRuntime.#eventStream.emit(state.turnId, type, data)`
(`turns/runtime.mjs`) emits **keyed by `turnId`** for per-turn streaming — there is **no**
global "any turn, anywhere, reached terminal" bus; `startTurn()` itself returns as soon as
the turn is established (fired via `queueMicrotask`), not once it completes, so
`AgentSessionService`'s own call site does not already run code after every turn finishes.
`AgentSessionService` (`service.mjs`) is nonetheless the one module that already centralizes
every `startTurn()` call server-wide (one shared `turnRuntime` instance) — the real
ownership point for adding a per-turn completion hook. `human-step-transport.mjs`'s handler
already `await`s `submitHumanStepResult(...)` synchronously, a clean existing hook point for
the human path. `AgentTurnRuntime.#acquireStartLock(key)` (a promise-chain mutex keyed by
session id, serializing concurrent callers within the single Node process) is an existing,
proven pattern for exactly the kind of atomic claim `admitExecution` needs, just keyed
differently. `binding-service.mjs`'s `listSessions`/`listSessionsSync` filter by `taskId`
only; no `parentSessionId`/lineage or `role` concept exists yet.

## Requirements

- **Execution-mode/provider selection, always shown (D21, corrected).** When a spec/change
  has no resolved execution policy, the first explicit `start-step`/batch-Start **always**
  shows the provider + mode picker (sensible defaults preselected) — never conditioned on
  whether a provider "needs" it. Confirming persists `{provider, mode}` as the change-level
  default at `.nevo-ai-local/execution-policy/<change>.json` via a real server transport.
  Optional per-task overrides may layer on top.
- **Continuation is eligibility, not scheduling (D25).** `.nevo-ai/workflows/*.yaml`
  transitions gain `continuation: auto | owner-action` (default `owner-action`). `auto` means
  only "no owner decision required before this destination may be scheduled." Full
  `standard-v1.yaml` migration (all four internal transitions, per task 25's schema).
- **One spec-level admission gate for every execution path (D41).** `admitExecution(specId,
  candidate)` (`tools/dashboard/server/ai/orchestration/admission.mjs`) is the **only** path
  capable of creating a new agent session or calling `startHumanStep` for deterministic
  execution. It reuses `AgentTurnRuntime.#acquireStartLock`'s exact promise-chain-mutex
  pattern, keyed by `specId`: acquire the lock, check for an already-active agent execution
  for the spec, and if none, atomically claim the slot before returning "admitted" — check
  and claim happen inside the same held lock so two simultaneous callers can never both
  observe "free." Manual single Start, batch Start, automatic continuation, and remediation
  execution all enqueue their candidate(s) into the sequential queue and then call this same
  gate — `startStep()` and every other UI entry point are corrected to call it exclusively,
  never `createSession`/`startHumanStep` directly for deterministic execution.
- **Continuation reconciliation, three real hook points, never a fictitious event (D42).**
  One shared function, `reconcileWorkflowPosition(change, task)`, resolves the authoritative
  workflow position, checks the matched transition's `continuation`, and — if `auto` —
  enqueues the destination then calls `admitExecution`. Invoked from: (1) `AgentSessionService`,
  corrected to attach its own listener via the existing per-turn `subscribeToSession`-style
  mechanism when it starts a turn for a deterministic-task-bound session, firing
  `reconcileWorkflowPosition` on that turn's terminal event; (2) `human-step-transport.mjs`'s
  handler, immediately after `submitHumanStepResult` resolves; (3) the existing
  `ensureReconciled()`-style lazy first-request hook, extended to also reconcile every
  in-progress deterministic task (restart/crash recovery). `finishStep()` stays exactly as
  provider-neutral as before — none of this logic moves into `tools/specs/workflow/**`.
- **Session policy on the transition, role extensible (D26).** `execution: {session: reuse |
  fresh, role: <string>}` lives on the transition. Migration: `implementation → review` →
  `{session: fresh, role: reviewer}`; `review` fail → `implementation` →
  `{session: fresh, role: refiner}`; `human-verification` fail (Request changes) →
  `implementation` → `{session: fresh, role: refiner}`.
- **Human-step auto-activation never occupies the execution slot (D27/D45).** When
  `reconcileWorkflowPosition` resolves an eligible human-owned destination, it calls
  `startHumanStep` directly — no session, no `admitExecution` call (a human decision is not
  an agent execution). Per D45, other agent-owned queued work for the same spec may continue
  while this human decision is pending; several may accumulate.
- **Preserve Finding 8.** `HumanStepSurface`'s existing definition-driven rendering is
  unchanged.

## Constraints

- No step-id/name dispatch anywhere in this area.
- `finishStep`/`ensureStepActivated`/`startHumanStep` stay the only mutating engine entry
  points; this area's orchestration module only sequences calls to them, and only for the one
  item `admitExecution` actually admitted.
- This area's modules live under `tools/dashboard/server/ai/orchestration/**` plus two real,
  existing files it corrects (`tools/dashboard/server/ai/sessions/service.mjs`,
  `tools/dashboard/server/specs/human-step-transport.mjs`) — it may freely import
  `tools/specs/workflow/**`; the reverse must never occur.
- No new public API is added to `tools/dashboard/server/ai/sessions/turns/runtime.mjs` itself
  — `AgentSessionService` uses only its existing per-turn subscription mechanism.
- The existing default-to-`'edit'` provider contract is unchanged for any path that has not
  gone through this area's execution-policy resolution.

## Interfaces and boundaries

Exposes: the always-shown execution-policy picker and its server transport;
`admitExecution`; `reconcileWorkflowPosition`; session lineage/role fields on session
identity; human-step auto-activation.

Consumed by: `areas/deterministic-sequential-queue.md` (this area calls the queue for "what's
next," then separately admits it); `AgentSessionService`/`human-step-transport.mjs` (the two
real files this area's reconciliation hooks into).

## Area-specific acceptance criteria

- A first `start-step`/batch-Start for a change with no resolved execution policy always
  shows the picker — proven for a provider that would not have needed an explicit mode under
  the old, retracted conditional logic.
- Two simultaneous admission requests for the same spec never both result in a created
  session — proven with a test that races two concurrent `admitExecution` calls.
- Simulating a turn-completion event for `implementation → review` via `AgentSessionService`'s
  own per-turn subscription (not a fictitious global event) results in `review` being
  enqueued and admitted with `execution: {session: fresh, role: reviewer}`.
- Simulating `submitHumanStepResult` returning a `continuation: auto` result (e.g. "Request
  changes") results in the resulting agent work being enqueued and admitted without any
  further user action.
- Killing and restarting the server between a reconciliation-triggering event and the queue
  recording it results in the destination still being enqueued once the boot/first-request
  reconciliation runs.
- A human-owned destination reached via reconciliation renders `HumanStepSurface` immediately
  with no session created and no `admitExecution` call.
- While a human decision is pending on one task, `admitExecution` still admits a different,
  independently-eligible agent-owned task in the same spec.
- No file in this area contains a `switch`/`if`/lookup-object keyed on a literal step id, and
  `tools/dashboard/server/ai/sessions/turns/runtime.mjs` gains no new exported API.

## Dependencies

`areas/agent-step-bootstrap-and-context.md`, `tasks/25-workflow-continuation-schema.md`,
`areas/deterministic-sequential-queue.md`, `areas/dependency-release-and-invalidation.md`
(this area writes dependency-consumption records at admission, D43).

## Out of scope

A general-purpose action/dispatch framework. Per-provider handover routing beyond the
provider/mode selection this area's execution policy already resolves. Any artifact/
attachment system beyond the `parentSessionId` lineage field itself. Rolling back or
retrying already-completed work. Deciding *which* eligible item runs next when several are
eligible (the queue's own `schedulingPriority` ordering, D34).
