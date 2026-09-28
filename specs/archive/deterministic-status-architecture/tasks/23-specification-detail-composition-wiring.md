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
  - tools/dashboard/ui/screens/specification-detail/specification-overview.tsx
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
  decisions: [D5, D14, D15, D17, D18, D19, D20]
---

# Task: `SpecificationDetailContent`/`SpecificationOverview` composition wiring

## Goal

**Final, small UI-integration task (added by the seventh, strictly mechanical pass to fix a
producer/consumer ordering defect — see D19's corrected decomposition; this eighth pass
corrects this task's own real composition path).** Build the actual composition-level
`startStep(task, stepDescriptor)` dispatcher inside
`specification-detail-content.tsx`, and wire it all the way to both real render targets:

```
SpecificationDetailContent.startStep
        ↓ (onStartStep prop)
SpecificationOverview.onStartStep
        ↓ (onStartStep prop, forwarded unchanged)
StatusBoard.onStartStep → TaskCard
```

for `TaskDialog` (rendered directly by `specification-detail-content.tsx`, not through
`SpecificationOverview` — confirmed by reading the file directly), the same `startStep`
function is passed straight in as `onStartStep`, no intermediate hop needed.
**Grounded fact (2026-09-20, this pass):** `SpecificationDetailContent` does not render
`StatusBoard` directly — it renders `SpecificationOverview`
(`tools/dashboard/ui/screens/specification-detail/specification-overview.tsx`, confirmed by
reading its import block and JSX), which itself renders `StatusBoard` and today owns the
intermediate prop contract `onWorkflowAction?: (task, action: string) => void | Promise<void>`,
forwarded unchanged into `StatusBoard`'s own `onWorkflowAction` prop. A task that owns only
`specification-detail-content.tsx` cannot satisfy "pass the generic `onStartStep` dispatcher
into `StatusBoard`," because the actual forwarding code lives in a different file this task
did not previously own. **`onWorkflowAction` is exclusively the deterministic-path prop** —
confirmed by reading both files: `SpecificationOverview` and `StatusBoard` each also have a
wholly separate, `SpecificationOwnerAction`-typed `onDirectTaskAction`/`onTaskAction` (and
`onBatchTaskAction`/`onBatchAction`) pair that legacy cards use instead; `onWorkflowAction`
is read only inside `TaskCard`'s `isDeterministic` branch. Replacing it with `onStartStep`
therefore cannot affect legacy behavior, which this task's own acceptance criteria confirm
directly rather than merely assume.

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
`TaskCard` already accept; this task supplies the value, routed through
`SpecificationOverview`. `human-step-surface-consolidation` — defines the
`onStartStep(stepDescriptor)` prop `TaskDialog` already accepts; this task supplies the
value directly (no intermediate file — `TaskDialog` is rendered by
`specification-detail-content.tsx` itself).

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
- **`specification-overview.tsx` migrates from `onWorkflowAction` to `onStartStep` (this
  pass's correction)** — its prop interface drops
  `onWorkflowAction?: (task: SpecificationTask, action: string) => void | Promise<void>` and
  gains `onStartStep?: (task: SpecificationTask, stepDescriptor: <the tier-1 descriptor
  shape>) => void | Promise<void>` (matching `task-card-lifecycle-split`'s own `StatusBoard`/
  `TaskCard` contract exactly), and its JSX forwards that prop unchanged into `StatusBoard`'s
  own `onStartStep` prop (previously `onWorkflowAction={onWorkflowAction}`, now
  `onStartStep={onStartStep}`) — a pure rename/forward, no new branching logic added in this
  file. `specification-overview.tsx`'s separate `onDirectTaskAction`/`onBatchTaskAction`
  props (legacy, `SpecificationOwnerAction`-typed) and their forwarding to `StatusBoard`'s
  `onTaskAction`/`onBatchAction` are completely untouched — this task's edit is scoped to the
  `onWorkflowAction`→`onStartStep` rename alone.
- `specification-detail-content.tsx` passes its `startStep` function as `onStartStep` into
  `SpecificationOverview` (replacing its prior `onWorkflowAction={handleWorkflowAction}`
  call) and, separately, directly into `TaskDialog`'s own `onStartStep` prop (no
  `SpecificationOverview` hop for the dialog, since `TaskDialog` is rendered by
  `specification-detail-content.tsx` itself) — the same function instance reaches both real
  render targets, board and dialog.
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
  enforces this; it only supplies the callback value those already-built components call,
  and (for `SpecificationOverview` only) the pure pass-through wiring between this task's own
  two files.

## Acceptance criteria

- Clicking the generic `start-step` control against a draft (unpublished) or
  executor-mismatched agent task surfaces the server's readiness-refusal error clearly.
  `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
- The session's initial trigger message is byte-for-byte identical for two differently-named,
  differently-purposed agent steps started for the **same** task (e.g. one run where the next
  step is `review`, one where it is an arbitrary `hardening` fixture, item 15) — no
  step-id/purpose text appears in it, and no dashboard/server code change is required to add
  the `hardening` case.
  `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
- **`TaskCard` human Start (board):** clicking `start-step` on the board against a
  `waiting-for-step-start` task whose next step has `executor: 'human'` calls
  `startHumanStep` (via the shared transport, `{ action: 'start' }`) and creates/binds **no**
  AI execution session — asserted directly, not only inferred from the absence of a
  session-creation call. Proven through the real chain:
  `SpecificationDetailContent.startStep` → `SpecificationOverview.onStartStep` →
  `StatusBoard`/`TaskCard.onStartStep`.
  `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
- **`TaskDialog` human Start (dialog):** the identical scenario, triggered from `TaskDialog`'s
  own generic Start control instead of the board — same composition `startStep`, same shared
  `human-step-request.ts` call, same `{ action: 'start' }` body, same "no AI session created"
  assertion. This is this task's own real integration proof for `TaskDialog`'s human-start
  path — `human-step-surface-consolidation` (task 20) only proves `TaskDialog` *calls*
  `onStartStep` with a test double; this task proves what the real call does.
  `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
- `TaskCard`'s and `TaskDialog`'s human-start requests are identical in shape (both a plain
  `{ action: 'start' }` body through the same shared transport function) — the two real
  composition entry points use the same dispatcher, not two independent implementations.
  `inspection: confirm both call sites route through the identical startStep function instance`
- Neither entry point ever auto-selects a contextual task as authoritative execution intent.
  `inspection: confirm task selection stays explicit and opt-in`
- No file in this task's scope contains a `switch`/`if`/lookup-object keyed on a literal
  step id, `currentStep`, or `nextStep` — the only branch predicate anywhere in `startStep`
  is `stepDescriptor.executor`.
  `inspection: confirm no step-id-keyed construct exists anywhere in this task's allowed_paths, and the only branch predicate is executor`
- `specification-overview.tsx` no longer declares or forwards an `onWorkflowAction` prop —
  its interface has `onStartStep` in its place, and its `onDirectTaskAction`/
  `onBatchTaskAction` props/forwarding are byte-for-byte unchanged (legacy behavior is
  provably unaffected by this rename, not merely assumed unaffected).
  `inspection: confirm onWorkflowAction is gone from specification-overview.tsx and onDirectTaskAction/onBatchTaskAction are untouched`
- A legacy (non-deterministic) specification's board rendering is byte-for-byte unchanged
  after this task (legacy cards never read `onWorkflowAction`/`onStartStep` in the first
  place, per the grounded fact above — this criterion proves that isolation held, not just
  states it).
  `automated: node --test tools/dashboard/tests/ux-improvements-regression.test.mjs`
- This task's own test suite exercises the full `startStep` dispatcher end-to-end (real
  `SpecificationOverview`→`StatusBoard`/`TaskCard` rendering and real `TaskDialog` rendering,
  not a stub) — proving the full, previously-missing wiring gap (D19, item 23) is actually
  closed: a human-owned step's "Start" control is not a no-op anywhere in the real app, on
  the board or in the dialog.
  `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`

## Verification

```bash
node --test tools/dashboard/tests/agent-session-workflow.test.tsx
node --test tools/dashboard/tests/ux-improvements-regression.test.mjs
```

## Out of scope

`StatusBoard`/`TaskCard`'s own rendering and their `onStartStep` contract's shape (owned by
`task-card-lifecycle-split`) — this task only supplies the callback value, it does not touch
`status-board.tsx` itself (`forbidden_paths` enforces this). `TaskDialog`/chat and
`HumanStepSurface` itself, and their own `onStartStep`/generic waiting-control rendering
(owned by `human-step-surface-consolidation`). `agent-session-page.tsx`/
`agent-session-chat-surface.tsx` (owned by `human-step-surface-consolidation`) — chat's own
agent/human "start" wiring never routes through this task. The pure
`buildAgentStepTriggerMessage` primitive's own implementation, and `types.ts` (owned by
`session-bootstrap-readiness-wiring`). The shared human-step transport function's own
implementation (owned by `dashboard-human-step-transport`). `SpecificationOverview`'s
`onDirectTaskAction`/`onBatchTaskAction`/legacy rendering logic beyond confirming this
task's rename didn't touch it. Any per-step dispatch/mode/archetype system (D15, out of
scope for this whole change).
