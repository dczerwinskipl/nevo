---
id: deterministic-status-architecture.specification-detail-composition-wiring
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/execution-readiness-and-session-bootstrap.md
    - specs/active/deterministic-status-architecture/areas/ui-dashboard-board-split.md
    - specs/active/deterministic-status-architecture/areas/human-step-surface.md
    - specs/active/deterministic-status-architecture/owner-decisions.md
allowed_paths:
  - tools/dashboard/ui/screens/specification-detail/specification-detail-content.tsx
  - tools/dashboard/tests/**
forbidden_paths:
  - tools/specs/**
  - tools/dashboard/server/**
  - tools/dashboard/ui/shared/workflow/**
  - tools/dashboard/ui/features/specifications/tasks/task-dialog.tsx
  - tools/dashboard/ui/features/specifications/detail/status-board.tsx
  - tools/dashboard/ui/features/agent-sessions/agent-session-page.tsx
  - tools/dashboard/ui/features/agent-sessions/agent-session-chat-surface.tsx
  - src/**
depends_on: [ session-bootstrap-readiness-wiring, dashboard-human-step-transport, task-card-lifecycle-split, human-step-surface-consolidation ]
semantic_references:
  decisions: [D15, D19, D20]
---

# Task: `SpecificationDetailContent` composition wiring

## Goal

**Final, small UI-integration task (added by the seventh, strictly mechanical pass to fix a
producer/consumer ordering defect — see D19's corrected decomposition).** Build the actual
composition-level `startStep(task, stepDescriptor)` dispatcher inside the real screen file,
`tools/dashboard/ui/screens/specification-detail/specification-detail-content.tsx`
(`screens/**`, not `features/specifications/**` — this file does not exist under
`features/specifications/detail/`, and this task does not create a duplicate there), and
wire it as the `onStartStep` prop into both `StatusBoard` (the contract
`task-card-lifecycle-split` already defined) and `TaskDialog` (the contract
`human-step-surface-consolidation` already defined). By the time this task starts, every
prop/contract it consumes already exists, built by its four dependencies — this task adds no
new contract of its own, it only supplies the one real implementation multiple earlier tasks
deliberately left as a callback.

## Dependencies

`session-bootstrap-readiness-wiring` — provides the frontend DTO type (`types.ts`) this
screen reads, and the pure `buildAgentStepTriggerMessage(taskId)` primitive this task's
agent branch calls to produce its generic trigger text (never reimplemented locally).
`dashboard-human-step-transport` — provides the neutral, feature-agnostic
`shared/lib/human-step-request.ts` function this task's human branch calls directly
(`{ action: 'start' }`) — this task does not reimplement the request or go through a
feature-local adapter hook (those exist for `TaskDialog`/chat's own active-interaction
submission, a different call site owned by `human-step-surface-consolidation`).
`task-card-lifecycle-split` — defines the `onStartStep(stepDescriptor)` prop `StatusBoard`/
`TaskCard` already accept; this task supplies the value. `human-step-surface-consolidation`
— defines the `onStartStep(stepDescriptor)` prop `TaskDialog` already accepts; this task
supplies the value.

## Implementation constraints

- **`specification-detail-content.tsx` owns one generic composition-level dispatcher (D19),
  `startStep(task, stepDescriptor)`, replacing the prior `handleWorkflowAction`'s
  action-string branches entirely** — its only branch predicate is
  `stepDescriptor.executor`:
  - `executor === 'agent'`: creates/reuses the task's authoritative execution session
    (passing the authoritative `taskId`, never a contextual one) and sends the trigger
    message produced by `session-bootstrap-readiness-wiring`'s
    `buildAgentStepTriggerMessage(taskId)` — this task does not construct its own trigger
    text. The real work contract is supplied entirely by the *existing*, unmodified
    `[Nevo Workflow Context]`/`StepContext` bootstrap mechanism in
    `tools/dashboard/server/ai/sessions/service.mjs` (D18 fixes two bugs there; this task
    does not touch that file — `forbidden_paths` enforces it).
  - `executor === 'human'`: calls `startHumanStep` directly through the shared, neutral
    `human-step-request.ts` function (`{ action: 'start' }`, D14/D17, owned by
    `dashboard-human-step-transport`) — creates or binds **no** AI execution session, does
    not call `useCreateAgentSession`, and does not navigate to a session. On success it
    refreshes the actions query so the board/dialog reflect the now-active human
    interaction.
  - The old `'approve'`/`'request-changes'` branches (the pre-existing human-verification-gate
    action vocabulary D5 already superseded, which POSTed directly to
    `/workflow/human-decision`) are removed from this dispatcher outright — that behavior is
    `HumanStepSurface`'s `onSubmit` responsibility (`human-step-surface-consolidation`),
    reached only through `TaskDialog`/chat, never through this board-level dispatcher.
- This same `startStep` function is passed as one `onStartStep` prop to both
  `StatusBoard`→`TaskCard` (the board entry point, whose `onStartStep` contract
  `task-card-lifecycle-split` already built and tested against a stub) and `TaskDialog`
  (whose `onStartStep` contract `human-step-surface-consolidation` already built and tested
  against a stub) — both prop names/shapes are already fixed by their owning tasks; this
  task supplies a matching implementation, it does not renegotiate either contract.
- **No step-id dispatch of any kind (D15).** No `switch`/`if`/lookup-object keyed on
  `step.id`, `currentStep`, or `nextStep` may exist anywhere in this task's files. A newly
  authored agent-owned step (any id) must reach this entry point and execute correctly with
  zero changes to any file in this task's scope.
- Both branches surface a readiness-refusal error from the server clearly and actionably —
  do not silently swallow it or show a generic failure toast.
- Do not add any client-side readiness re-derivation — the client trusts the server's answer
  and the DTO's `availableActions` visibility check; this task only makes the server's
  refusal legible when the visibility check is bypassed.
- Never auto-select a contextual task as the authoritative execution `taskId`.
- This task does not modify `StatusBoard`/`TaskCard` (`task-card-lifecycle-split`'s files) or
  `TaskDialog`/chat (`human-step-surface-consolidation`'s files) — `forbidden_paths`
  enforces this; it only supplies the callback value those already-built components call.

## Acceptance criteria

- Clicking the generic `start-step` control against a draft (unpublished) or
  executor-mismatched agent task surfaces the server's readiness-refusal error clearly.
  `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
- The session's initial trigger message is byte-for-byte identical for at least two
  differently-named, differently-purposed agent steps (e.g. `review` and an arbitrary
  `hardening` fixture, item 15) — no step-id/purpose text appears in it, and no
  dashboard/server code change is required to add the `hardening` case.
  `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
- Clicking `start-step` against a `waiting-for-step-start` task whose next step has
  `executor: 'human'` calls `startHumanStep` (via the shared transport, `{ action: 'start'
  }`) and creates/binds **no** AI execution session — asserted directly, not only inferred
  from the absence of a session-creation call.
  `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
- `TaskDialog` receives an `onStartStep` prop from `specification-detail-content.tsx` wired
  to the same `startStep` function the board uses — proven by both entry points producing
  identical requests (same trigger message for the agent branch, same `{ action: 'start' }`
  body for the human branch) for the same task/step.
  `inspection: confirm specification-detail-content.tsx passes the same startStep function as onStartStep to both StatusBoard and TaskDialog`
- Neither entry point ever auto-selects a contextual task as authoritative execution intent.
  `inspection: confirm task selection stays explicit and opt-in`
- No file in this task's scope contains a `switch`/`if`/lookup-object keyed on a literal
  step id, `currentStep`, or `nextStep` — the only branch predicate anywhere in `startStep`
  is `stepDescriptor.executor`.
  `inspection: confirm no step-id-keyed construct exists anywhere in this task's allowed_paths, and the only branch predicate is executor`
- This task's own test suite exercises `specification-detail-content.tsx`'s `startStep`
  dispatcher end-to-end (real board/dialog rendering, not a stub) — proving the full,
  previously-missing wiring gap (D19, item 23) is actually closed: a human-owned step's
  "Start" control is not a no-op anywhere in the real app.
  `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`

## Verification

```bash
node --test tools/dashboard/tests/agent-session-workflow.test.tsx
```

## Out of scope

`StatusBoard`/`TaskCard`'s own rendering and their `onStartStep` contract's shape (owned by
`task-card-lifecycle-split`). `TaskDialog`/chat and `HumanStepSurface` itself, and their own
`onStartStep`/generic waiting-control rendering (owned by `human-step-surface-consolidation`).
`agent-session-page.tsx`/`agent-session-chat-surface.tsx` (owned by
`human-step-surface-consolidation`) — chat's own agent/human "start" wiring never routes
through this task. The pure `buildAgentStepTriggerMessage` primitive's own implementation,
and `types.ts` (owned by `session-bootstrap-readiness-wiring`). The shared human-step
transport function's own implementation (owned by `dashboard-human-step-transport`). Any
per-step dispatch/mode/archetype system (D15, out of scope for this whole change).
