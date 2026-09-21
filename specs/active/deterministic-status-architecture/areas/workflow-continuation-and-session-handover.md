# Area: Workflow continuation and session handover

## Responsibility

Own the orchestration layer between a finished workflow step and the next execution
surface — the layer the real dogfooding run showed does not exist today. This area covers:
the execution-mode/provider selection UX for a task's first explicit `start-step` and its
persisted execution policy (D21); a declarative per-transition continuation policy
(`continueOnSuccess`) and the orchestrator that acts on it, creating follow-on sessions
without `finishStep()` itself becoming session-aware (D25); a declarative session-reuse
policy plus session lineage/execution-role fields (`sessionPolicy`, `parentSessionId`,
`role`) so review runs in a fresh, independently-lineaged session rather than silently
reusing the implementer's (D26); and auto-activation of a human-owned step on arrival,
removing the redundant manual "Start" click before the real `HumanStepSurface` interaction
(D27). This area never becomes part of the deterministic engine itself — `finishStep`,
`ensureStepActivated`, and `startHumanStep` (D12/D13, unchanged) remain the only mutating
entry points; this area only *calls* them, deciding *when* and *with which session*.

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
from a required owner action.

`binding-service.mjs`'s `listSessions`/`listSessionsSync` filter candidate sessions by
`taskId` only; `binding.step` exists but is never used to select a session. No
`parentSessionId`/lineage or `role` concept exists in session identity anywhere in
`tools/dashboard/server/ai/**`.

Reaching a human-owned step's `waiting-for-step-start` state shows only a generic "Start"
control (`status-board.tsx`, `agent-session-chat-surface.tsx`,
`specification-detail-content.tsx`'s `postHumanStepAction({action:'start'})`) — the real
interaction never appears before that click resolves.

## Requirements

- **Execution-mode/provider selection (D21).** When a task/provider pair has no resolved
  execution policy and the provider's permission model needs an explicit mode, `start-step`
  presents the same selection concept `CreateAgentSessionDialog` already implements — reused,
  not duplicated — before creating a session. The resolved choice persists as the task's
  execution policy for later automatic handovers. No step-id-specific mode mapping. The
  existing omitted-mode-defaults-to-`'edit'` contract is unchanged wherever no policy has been
  resolved yet.
- **Continuation schema and orchestrator (D25).** `.nevo-ai/workflows/*.yaml` transitions gain
  an additive `continueOnSuccess: auto | owner-action` field (default `owner-action`,
  every existing definition unaffected until migrated). A new orchestration module observes
  a finish result and, when the matched transition declares `auto`, creates/reuses the next
  step's session (per the session policy below) and sends the existing generic trigger
  message (D15, unchanged — never step-id-derived). `finishStep()` itself gains no session
  awareness. No `if (nextStep === 'review')`-shaped dispatch anywhere in this module.
- **Session policy and lineage (D26).** A declarative `sessionPolicy: reuse | fresh` field
  (on the step or its entering transition — decide during implementation, document the
  choice) drives whether the orchestrator reuses the previous session or creates a fresh one.
  `standard-v1.yaml`'s `review` step is set to `fresh`. A fresh session records
  `parentSessionId` on the existing canonical session identity. A `role: implementer |
  reviewer | refiner` field is assigned by the orchestrator from the transition's own declared
  semantics, never from a literal step id/name comparison.
- **Human-step auto-activation (D27).** When the orchestrator reaches a position whose
  `nextStep` executor is `human`, it calls the existing `startHumanStep` operation directly
  and pauses — the dashboard renders `HumanStepSurface`'s real, definition-driven interaction
  immediately, with no intervening generic "Start" click. `startHumanStep` itself is
  unmodified; only the caller changes.
- **Preserve Finding 8.** `HumanStepSurface`'s existing definition-driven rendering
  (`interaction.actions[].{result,label,feedbackRequired}`, no hardcoded action names) is
  unchanged and must not be reintroduced as hardcoded anywhere in this area's own code.

## Constraints

- No step-id/name dispatch anywhere in this area (same invariant as D15, extended to
  continuation/session-policy decisions).
- `finishStep`/`ensureStepActivated`/`startHumanStep` stay the only mutating engine entry
  points; the orchestrator only sequences calls to them.
- The existing default-to-`'edit'` provider contract is unchanged for any path that has not
  gone through this area's execution-policy resolution.
- `listSessions`/`listSessionsSync`'s existing `taskId`-only filter (a UI-listing concern) is
  unchanged — session-policy/lineage decisions are a separate, new consumer, not a rewrite of
  that filter's semantics.

## Interfaces and boundaries

Exposes: the execution-policy resolution/selection UX; the continuation orchestrator (finish
result + definition → next action); session lineage/role fields on session identity;
human-step auto-activation.

Consumed by: the dashboard's `start-step` dispatcher (first explicit start) and the
post-finish continuation path (automatic handovers); `areas/deterministic-batch-orchestrator.md`
(each scheduled task's own continuation runs through this same orchestrator, never a
batch-specific reimplementation).

## Area-specific acceptance criteria

- A first `start-step` against a provider/mode combination with no resolved execution policy,
  where the provider needs explicit mode selection, shows the selection UI before creating a
  session; a subsequent automatic handover for the same task/provider does not re-ask.
- A `standard-v1` task's `implementation → review` continuation, once `continueOnSuccess:
  auto` is set on that transition, creates a fresh (`sessionPolicy: fresh`) session with
  `parentSessionId` pointing at the implementer's session and `role: reviewer` — proven by
  inspecting the created session's own fields, not inferred from behavior alone.
- A transition without `continueOnSuccess` (or explicitly `owner-action`) leaves the task in
  `waiting-for-step-start` with no session created — behavior identical to today.
- Reaching a human-owned step through the orchestrator renders `HumanStepSurface`'s real
  interaction with no preceding generic "Start" click; a *directly-invoked* `startHumanStep`
  (e.g. CLI/API caller bypassing the orchestrator) is unaffected — the operation itself is
  unmodified.
- No file in this area contains a `switch`/`if`/lookup-object keyed on a literal step id.

## Dependencies

`areas/agent-step-bootstrap-and-context.md` (the `StepContext` this area hands off unchanged
to a follow-on session), the schema extension in `tasks/26-workflow-continuation-schema.md`.

## Out of scope

A general-purpose action/dispatch framework. Per-provider handover routing beyond the
provider/mode selection this area's execution policy already resolves. Any artifact/
attachment system beyond the `parentSessionId` lineage field itself. Rolling back or
retrying already-completed work (see `areas/dependency-release-and-invalidation.md`'s OQ-A
for the related, still-open invalidation question).
