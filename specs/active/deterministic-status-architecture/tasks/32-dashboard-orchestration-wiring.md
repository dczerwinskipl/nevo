---
id: deterministic-status-architecture.dashboard-orchestration-wiring
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/workflow-continuation-and-session-handover.md
    - specs/active/deterministic-status-architecture/areas/deterministic-batch-orchestrator.md
    - specs/active/deterministic-status-architecture/owner-decisions.md
allowed_paths:
  - tools/dashboard/ui/screens/specification-detail/specification-detail-content.tsx
  - tools/dashboard/ui/screens/specification-detail/specification-overview.tsx
  - tools/dashboard/ui/features/specifications/detail/status-board.tsx
  - tools/dashboard/ui/features/specifications/tasks/task-dialog.tsx
  - tools/tests/dashboard-orchestration-wiring.test.mjs
forbidden_paths:
  - tools/specs/workflow/**
  - tools/dashboard/server/ai/**
  - src/**
depends_on:
  [
    execution-policy-and-mode-selection,
    deterministic-batch-orchestrator,
    automatic-workflow-continuation,
    dependency-invalidation-remediation-review
  ]
semantic_references:
  decisions: [D32, D33]
---

# Task: Dashboard orchestration wiring (corrected — sequential, checkbox picker, no parallel starts)

## Goal

Wire the execution-policy selection (task 26), sequential queue (task 28), and server-side
continuation orchestrator (task 29) into the real UI: `start-step` opens the selection UI
only when actually needed, a checkbox picker lets the owner select several tasks for a
queue run (pre-checked with ready tasks, warning on a cross-selection dependency gap — never
starting more than one execution at once), and the UI reflects queue/continuation state as an
**observer**, never as the thing driving correctness (D35 — the server owns that).

## Implementation constraints

- `specification-detail-content.tsx`'s `startStep` calls task 26's execution-policy check
  first; only when unresolved does it show the selection UI.
- Add the checkbox-picker UI to `specification-overview.tsx`: pre-checks currently-ready
  tasks, freely togglable, renders cross-selection dependency warnings inline (naming the
  specific blocking task), and submits the selection via the server-side orchestration
  layer's own route (task 29 — the browser never imports `tools/specs/workflow/queue/**`
  directly) — **never** starts more than one task's session directly from this UI; the queue
  and server-side orchestrator own execution order.
- Add an affordance for triggering `dependency-invalidation-remediation-review` (task 30)
  against a derived remediation group, reusing this same checkbox/scheduling surface rather
  than a second UI.
- After a turn/finish completes, the UI reflects whatever the server-side orchestrator (task
  29) already decided (via the existing DTO/SSE refresh mechanisms) — this task adds no new
  client-side decision logic for "what runs next."
- No `switch`/`if`/lookup-object keyed on a literal step id introduced anywhere in this
  wiring.
- **No UI affordance may imply or allow starting two agent sessions concurrently for the same
  spec** — the checkbox picker's "Start batch" action submits the whole selection to the
  queue as one operation, never a per-task "Start" loop that fires multiple session-creation
  calls at once.

## Acceptance criteria

- Clicking `start-step` for a task/provider needing mode selection shows the selection UI;
  for one that doesn't, or that already has a resolved policy, it proceeds directly.
  `automated: node --test tools/tests/dashboard-orchestration-wiring.test.mjs`
- Selecting several tasks via the checkbox picker and submitting starts exactly one session
  (for the queue's first `nextRunnable` item) — never more than one, proven directly against
  the number of session-creation calls made.
  `automated: node --test tools/tests/dashboard-orchestration-wiring.test.mjs`
- After the first queued item finishes and the server-side orchestrator (task 29) starts the
  next one, the board/dialog reflects that state without any client-side code having decided
  it — proven by asserting the UI only ever reads projection state, never calls a
  "start next" function of its own.
  `automated: node --test tools/tests/dashboard-orchestration-wiring.test.mjs`
- A human step auto-activated by the server-side orchestrator renders `HumanStepSurface`'s
  real interaction immediately in both the board/dialog path and chat.
  `automated: node --test tools/tests/dashboard-orchestration-wiring.test.mjs`
- Selecting a task blocked by an unselected, unsatisfied dependency shows a warning naming
  that dependency; submitting the selection anyway is still possible.
  `automated: node --test tools/tests/dashboard-orchestration-wiring.test.mjs`
- No file in this task's scope contains a `switch`/`if`/lookup-object keyed on a literal step
  id, and no file in this task's scope contains logic that could issue more than one
  concurrent session-creation call for the same spec.

## Verification

```bash
node --test tools/tests/dashboard-orchestration-wiring.test.mjs
node tools/specs.mjs validate
```

## Out of scope

The orchestrator/queue logic itself (tasks 26/28/29 — this task only wires their results
into the UI). Any new visual redesign beyond what's needed to reflect the new states.
