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
  - tools/dashboard/ui/features/agent-sessions/agent-session-page.tsx
  - tools/dashboard/ui/features/agent-sessions/agent-session-chat-surface.tsx
  - tools/dashboard/tests/workflow-continuation.test.mjs
forbidden_paths:
  - tools/specs/workflow/finish-operation.mjs
  - tools/specs/workflow/human-step/**
  - tools/specs/workflow/queue/**
  - src/**
depends_on: [ workflow-continuation-schema, execution-policy-and-mode-selection, deterministic-batch-orchestrator ]
semantic_references:
  decisions: [D25, D26, D27, D33, D35, D38]
---

# Task: Automatic workflow continuation (corrected — server-side, not a React page)

## Goal

Build the **server-side** application/orchestration layer under
`tools/dashboard/server/ai/orchestration/**` (D38) that: (1) hooks `AgentTurnRuntime`'s
`turn.completed`/`turn.failed` event to check the matched transition's `continuation` field
and enqueue eligible destinations into the sequential queue (task 28) — never execute them
inline (D25, corrected: `continuation: auto` means eligibility, not immediate execution);
(2) runs an idempotent reconciliation pass on the existing `ensureReconciled()`-style lazy
first-request hook, mirroring `reconcileOrphanedTurns()`'s established pattern, so a missed
event (server crash, restart) is still caught (D35); (3) when the queue's single
`nextRunnable` item is agent-owned, creates/reuses a session per `execution.session`/`role`
(D26) and the resolved execution policy (task 26), sending the existing generic trigger
(D15, unchanged); when human-owned, calls `startHumanStep` directly and pauses (D27). This
task corrects the prior draft's assumption that `agent-session-page.tsx`'s `onTurnCompleted`
callback could own this — it cannot, since it only fires while a specific browser tab is
open and only re-fetches client-side state.

## Implementation constraints

- New module tree, `tools/dashboard/server/ai/orchestration/**`. Hook into
  `AgentTurnRuntime`'s existing `turn.completed`/`turn.failed` emission
  (`tools/dashboard/server/ai/sessions/turns/runtime.mjs`) — do not modify that file itself
  beyond what's needed to expose a subscription point if one doesn't already exist cleanly
  (investigate first; prefer an existing event-emitter pattern over adding new coupling).
- On the hook firing: resolve the task's authoritative `workflow_progress` position, find the
  matched transition, and — if `continuation: auto` — call the queue module's function
  (task 28) to enqueue the destination. This orchestration module is the **only** caller that
  ever creates a session or calls `startHumanStep` for an automatic continuation — the queue
  itself never does either (D38's boundary).
- **Single-active-execution gate (D33).** Before starting anything, this module checks
  whether an agent execution is already active for the spec (reading existing session/binding
  state under `tools/dashboard/server/ai/sessions/**`, read-only from this module's
  perspective) — if one is active, it does not start another; it waits for that execution's
  own `turn.completed`/`turn.failed` to re-trigger this same flow. There is no concurrency
  limit to configure because there is no concurrency.
- **Idempotent reconciliation (D35).** Add a reconciliation function invoked from the same
  `ensureReconciled()`-style lazy first-request hook `reconcileOrphanedTurns()` already uses
  (`tools/dashboard/server/ai/routes.mjs`) — inspect every in-progress spec's authoritative
  workflow position against the queue's own durable state (task 28) and enqueue any
  `continuation: auto` destination the real-time event path might have missed.
- **Execution-policy consumption.** Read the change-level execution policy (task 26) when
  creating a session for a queued agent-owned item — never guess a mode; if no policy is
  resolved yet (should not normally happen once task 26's first-Start flow has run, but must
  be handled), surface the same selection requirement a first Start would rather than
  defaulting silently.
- **Human-step auto-activation (D27).** When the queue's next-runnable item is human-owned,
  call `startHumanStep` directly (unmodified operation) and stop — the dashboard renders
  `HumanStepSurface`'s real interaction immediately.
- **Client files corrected, not extended.** `agent-session-page.tsx`'s `onTurnCompleted` and
  `agent-session-chat-surface.tsx` are corrected to stop being treated as any part of the
  continuation trigger — they may still refresh/display projection state for the open tab,
  but no continuation logic depends on either file executing.
- No `switch`/`if`/lookup-object keyed on a literal step id anywhere in this task's code.

## Acceptance criteria

- Simulating an `AgentTurnRuntime` `turn.completed` event directly (no browser/page involved
  in the test) for a `standard-v1` task's `implementation → review` transition results in
  `review` being enqueued with `execution: {session: fresh, role: reviewer}` — proven without
  any UI code executing.
  `automated: node --test tools/dashboard/tests/workflow-continuation.test.mjs`
- With one execution already active for a spec, a second eligible item's turn-completion does
  not start a second session — it is enqueued and started only once the first execution's own
  terminal event fires and the gate re-checks.
  `automated: node --test tools/dashboard/tests/workflow-continuation.test.mjs`
- Simulating a server restart between a turn's completion and the queue recording it results
  in the destination still being enqueued once the reconciliation hook runs on the next
  request.
  `automated: node --test tools/dashboard/tests/workflow-continuation.test.mjs`
- A transition without `continuation: auto` results in nothing enqueued — behavior identical
  to today (manual "Start" required).
  `automated: node --test tools/dashboard/tests/workflow-continuation.test.mjs`
- A human-owned destination reached via `continuation: auto` is auto-activated
  (`startHumanStep` called by this module, not the user) with no session created, and its
  real interaction is immediately visible.
  `automated: node --test tools/dashboard/tests/workflow-continuation.test.mjs`
- An agent-step auto-continuation for a change with no resolved execution policy does not
  guess a mode.
  `automated: node --test tools/dashboard/tests/workflow-continuation.test.mjs`
- No file in this task's scope contains a `switch`/`if`/lookup-object keyed on a literal step
  id.

## Verification

```bash
node --test tools/dashboard/tests/workflow-continuation.test.mjs
node tools/specs.mjs validate
```

## Out of scope

The workflow-definition schema itself (`workflow-continuation-schema`, task 25). The
execution-policy selection UI/storage (`execution-policy-and-mode-selection`, task 26). The
pure queue/scheduling plan itself (`deterministic-batch-orchestrator`, task 28 — this task
only consumes it). Dependency release/invalidation (`dependency-release-and-invalidation`,
task 27). Any form of concurrent execution.
