# Area: Workflow continuation and session handover

## Responsibility

Own the orchestration layer between a finished workflow step and the next execution
surface — the layer the real dogfooding run showed does not exist today. This area covers:
the execution-mode/provider selection UX for a spec's first explicit `start-step` and its
persisted, **change-level** execution policy (D21, corrected pass 10); a declarative
per-transition `continuation: auto | owner-action` policy (D25, renamed from
`continueOnSuccess`) that marks eligibility only — never "execute immediately" — consumed by
the server-side, `AgentTurnRuntime`-driven trigger this area owns (D35); a declarative
per-transition `execution: {session, role}` policy (D26) so review runs in a fresh,
independently-lineaged session rather than silently reusing the implementer's; and
auto-activation of a human-owned step on arrival (D27). **Every eligible destination this
area produces is handed to the sequential queue (`areas/deterministic-batch-orchestrator.md`)
for actual scheduling — this area never itself decides "run this now" when more than one
item is eligible; the single-active-execution invariant (D33) is enforced by the queue, not
duplicated here.**

## Current state (grounded, 2026-09-21)

`startStep()` (`specification-detail-content.tsx`) creates a session with `provider:
defaultProvider` and no `mode` — the server resolves the omission to `'edit'`
(`DEFAULT_AGENT_EXECUTION_MODE`, `contracts.mjs`), which cannot satisfy `workflow step
start`'s command-approval requirement through the dashboard's non-interactive dispatch. A
separate, already-working `CreateAgentSessionDialog` supports provider + Ask/Edit/Agent
selection but is wired only to the generic "new session" affordance, never to `startStep`.

After `workflow step finish` transitions to `waiting-for-step-start`, nothing creates the
next session — confirmed absent from `agent-session-page.tsx`/
`agent-session-chat-surface.tsx`; a manual "Start" click is required. No field in
`.nevo-ai/workflows/*.yaml`/`definitions/schema.mjs` distinguishes automatic continuation
from a required owner action. `AgentTurnRuntime.#finish()`
(`tools/dashboard/server/ai/sessions/turns/runtime.mjs`) already reaches a terminal
(`turn.completed`/`turn.failed`) state entirely server-side, independent of any connected
browser client — this, not any React callback, is the real trigger boundary (D35).
`turn-recovery.mjs`'s `reconcileOrphanedTurns()`, invoked lazily on the first inbound HTTP
request via `ensureReconciled()` (`tools/dashboard/server/ai/routes.mjs`), already
establishes this repository's own precedent for idempotent, restart-safe reconciliation.

`binding-service.mjs`'s `listSessions`/`listSessionsSync` filter candidate sessions by
`taskId` only; `binding.step` exists but is never used to select a session. No
`parentSessionId`/lineage or `role` concept exists in session identity anywhere in
`tools/dashboard/server/ai/**`.

Reaching a human-owned step's `waiting-for-step-start` state shows only a generic "Start"
control (`status-board.tsx`, `agent-session-chat-surface.tsx`,
`specification-detail-content.tsx`'s `postHumanStepAction({action:'start'})`) — the real
interaction never appears before that click resolves.

## Requirements

- **Execution-mode/provider selection, change-level scope (D21, corrected).** When a
  **spec/change** has no resolved execution policy and the provider's permission model needs
  an explicit mode, the first `start-step` (or batch Start) presents the same selection
  concept `CreateAgentSessionDialog` already implements — reused, not duplicated. The
  resolved `{provider, mode}` persists as the change-level default at
  `.nevo-ai-local/execution-policy/<change>.json` via a real server transport (a new
  `GET`/`PUT /api/specs/:slug/execution-policy` route backed by a small service module — the
  browser never touches the local file directly), reused by every subsequent queued item and
  automatic handover in that spec without re-asking. Optional per-task overrides may layer on
  top; the change-level default is the only value persisted by default. A fresh session
  (D26) reuses this same policy unless a task-level override says otherwise — "fresh" and
  "different provider" are independent axes, never conflated.
- **Continuation is eligibility, not scheduling (D25, corrected — field renamed).**
  `.nevo-ai/workflows/*.yaml` transitions gain `continuation: auto | owner-action` (default
  `owner-action`, additive), legal only on an internal transition. `auto` means only "no
  owner decision is required before this destination may be scheduled" — it never means "run
  this before other queued work." Full `standard-v1.yaml` migration (audited, not only
  `implementation → review`): `implementation`'s `to: review`, `review`'s `value: fail, to:
  implementation`, `review`'s `value: pass, to: human-verification`, and
  `human-verification`'s `value: fail, to: implementation` all get `continuation: auto`;
  `human-verification`'s `value: pass, to: verified` is terminal and carries no `continuation`
  field.
- **Server-side, idempotent trigger (D35).** A new module hooks `AgentTurnRuntime`'s
  `turn.completed`/`turn.failed` event: on firing, resolve the task's authoritative
  `workflow_progress` position, check the matched transition's `continuation`, and — if
  `auto` — enqueue the destination into the sequential queue (never execute it inline). A
  second, idempotent reconciliation pass runs on the same `ensureReconciled()`-style lazy
  first-request hook `reconcileOrphanedTurns()` already uses, catching any `continuation:
  auto` destination a server crash between the turn event and the queue recording it might
  have missed. `agent-session-page.tsx`/`agent-session-chat-surface.tsx` are corrected to
  stop driving continuation themselves — they may still *display* state, never decide it.
- **Session policy on the transition, role extensible (D26, corrected — canonical location
  settled).** `execution: {session: reuse | fresh, role: <string>}` lives on the
  **transition** (never the step — `implementation` has two distinct inbound transitions
  that may legitimately want different policies). `role` is a free-form, workflow-declared
  string, never a closed application enum. Migration: `implementation → review` →
  `execution: {session: fresh, role: reviewer}`; `review` fail → `implementation` →
  `execution: {session: fresh, role: refiner}`; `human-verification` fail (Request changes)
  → `implementation` → `execution: {session: fresh, role: refiner}`. A fresh session records
  `parentSessionId` on the existing canonical session identity.
- **Human-step auto-activation (D27).** When the trigger (above) resolves an eligible
  destination whose executor is `human`, the orchestration layer calls the existing
  `startHumanStep` operation directly and the queue treats this task's turn as consumed — the
  dashboard renders `HumanStepSurface`'s real, definition-driven interaction immediately, no
  intervening generic "Start" click. `startHumanStep` itself is unmodified.
- **Preserve Finding 8.** `HumanStepSurface`'s existing definition-driven rendering is
  unchanged and must not be reintroduced as hardcoded anywhere in this area's own code.

## Constraints

- No step-id/name dispatch anywhere in this area.
- `finishStep`/`ensureStepActivated`/`startHumanStep` stay the only mutating engine entry
  points; this area's orchestration module only sequences calls to them, and only ever for
  the one item the sequential queue currently designates as active.
- This area's server-side orchestration module lives under
  `tools/dashboard/server/ai/orchestration/**` (D38) — it may freely import
  `tools/specs/workflow/**` (the normal, existing direction) but the reverse must never occur:
  `tools/specs/workflow/queue/**` (owned by `areas/deterministic-batch-orchestrator.md`) has
  zero knowledge of AI sessions, execution policy, or this area's module.
- The existing default-to-`'edit'` provider contract is unchanged for any path that has not
  gone through this area's execution-policy resolution.
- `listSessions`/`listSessionsSync`'s existing `taskId`-only filter (a UI-listing concern) is
  unchanged.

## Interfaces and boundaries

Exposes: the execution-policy resolution/selection UX and its server transport; the
server-side continuation trigger + reconciliation pass; session lineage/role fields on
session identity; human-step auto-activation.

Consumed by: `areas/deterministic-batch-orchestrator.md`'s sequential queue (this area
enqueues eligible destinations into it and, when the queue designates an item as the one
active execution, actually creates/reuses the session or calls `startHumanStep` for it).

## Area-specific acceptance criteria

- A first `start-step`/batch-Start for a change with no resolved execution policy, where the
  provider needs explicit mode selection, shows the selection UI before creating a session; a
  subsequent queued item for the same change does not re-ask.
- A `standard-v1` task's `implementation → review` turn completion (server-side, not a UI
  event) enqueues `review` as eligible with `continuation: auto`, `execution: {session:
  fresh, role: reviewer}` recorded — proven by simulating the turn-completion event directly,
  with no browser/page involved in the test.
- Killing and restarting the server process between a turn's completion and the queue
  recording it results in the destination still being enqueued once reconciliation runs on
  the next inbound request — proven by a test that simulates exactly this ordering.
- A transition without `continuation: auto` (or explicitly `owner-action`) leaves the task in
  `waiting-for-step-start` with nothing enqueued.
- Reaching a human-owned step through this trigger renders `HumanStepSurface`'s real
  interaction with no preceding generic "Start" click.
- No file in this area contains a `switch`/`if`/lookup-object keyed on a literal step id, and
  no file under `tools/dashboard/server/ai/orchestration/**` is imported by anything under
  `tools/specs/workflow/**`.

## Dependencies

`areas/agent-step-bootstrap-and-context.md` (the `StepContext` this area hands off unchanged
to a follow-on session), `tasks/25-workflow-continuation-schema.md` (schema fields this area
consumes), `areas/deterministic-batch-orchestrator.md` (the queue this area's eligible
destinations feed into and the single-active-execution gate it enforces).

## Out of scope

A general-purpose action/dispatch framework. Per-provider handover routing beyond the
provider/mode selection this area's execution policy already resolves. Any artifact/
attachment system beyond the `parentSessionId` lineage field itself. Rolling back or
retrying already-completed work. Deciding *which* eligible item runs next when several are
eligible (`areas/deterministic-batch-orchestrator.md`'s scheduling-priority ordering, D34) —
this area only produces eligible destinations, it does not order them.
