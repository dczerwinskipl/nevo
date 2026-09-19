---
id: deterministic-status-architecture.task-card-lifecycle-split
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/ui-dashboard-board-split.md
allowed_paths:
  - tools/dashboard/ui/features/specifications/detail/status-board.tsx
  - tools/dashboard/ui/features/specifications/detail/lane-presentation.ts
  - tools/dashboard/tests/**
forbidden_paths:
  - tools/specs/**
  - tools/dashboard/server/**
  - src/**
depends_on: [ dashboard-deterministic-action-projection, session-bootstrap-readiness-wiring ]
semantic_references:
  decisions: [D15, D18]
---

# Task: `TaskCard` lifecycle split

## Goal

Separate `TaskCard`'s legacy and deterministic responsibility into clearly distinct
sub-components sharing the card shell, covering the card's **full visible state** — status
label/tone, blockedBy, and actions, not only the action footer — and stop a deterministic
card's status label from reading `formatTaskStatus(task.status)`/`taskStatusTone(task.status)`
once a workflow has started. The deterministic footer's action buttons/wording are driven
entirely by the corrected generic DTO — **not** the original design's
`start-implementation`/`start-review`/`approve`/`request-changes` action ids, which are
obsolete as of D15 and must not survive into the split component (item 12).

## Dependencies

`dashboard-deterministic-action-projection` — the deterministic sub-component reads the
corrected action DTO (`state`, `availableActions`, etc.), not the raw `TaskProjection`
directly, since the UI has never talked to backend projection modules directly and
`availableActions` specifically only exists on the composed DTO (D10).
`session-bootstrap-readiness-wiring` — that task owns the frontend `types.ts` DTO type
(D18); this task consumes it and must not be authored against a stale type.

## Implementation constraints

- Extract `TaskCard`'s two branches (currently inline in `status-board.tsx`, lines ~84–160,
  action-footer only) into two small sub-components (e.g. `LegacyTaskCard`/
  `DeterministicTaskCard`) that each own their **entire** visible state — status label/tone,
  blockedBy, and action footer — not just the footer. Keep only the genuinely identical
  parts (order badge, title button) in a common card shell both render inside.
- For a deterministic task, the status label/tone is chosen from the action DTO's `state`
  alone — never from `formatTaskStatus(task.status)`/`taskStatusTone(task.status)`, and
  never by branching on `currentStep`/`nextStep` (this is the concrete correction from the
  original design, corrective-pass-1 item 8, tightened by D15 to also forbid step-id
  branching). The card may still **display** the step descriptor's real `id`/`purpose` as
  informational text alongside the state-derived label/tone.
- **Deterministic footer, corrected per D15/item 12** — the original inline branch this
  task extracts from (`status-board.tsx`'s current `isDeterministic` footer) renders
  `'start-implementation'`/`'start-review'`/`'approve'`/`'request-changes'` action buttons;
  none of those ids survive into `DeterministicTaskCard`. For a task whose `availableActions`
  includes `"start-step"`, the card shows one generic "Start" control plus the step
  descriptor (`id`/`purpose`) — identical rendering regardless of the step's actual id or
  `executor`. For a task with an active human interaction, its result buttons come entirely
  from the human-interaction descriptor's own `actions` (`label`/`feedbackRequired`,
  `result` only when conditional) — never from a hardcoded `approve`/`request-changes` pair.
  No literal workflow step id appears in this component's control flow.
- `StatusBoard`'s own `isDeterministic` branch (hiding the legacy batch-approve button) is
  unaffected by this task — do not fold it into the card split.
- Deterministic action availability continues to come from the action DTO's
  `availableActions` (now backed by `ExecutionReadiness`/`TaskProjection` server-side) — no
  new client-side readiness logic.

## Acceptance criteria

- `TaskCard`'s legacy rendering output (a legacy spec's card) is byte-for-byte unchanged
  after the split (brief regression test #14).
  `automated: node --test tools/dashboard/tests/ux-improvements-regression.test.mjs`
- A deterministic card whose task's `status` is still `approved` (compatibility value) but
  whose `state` is `active` shows a state-derived status label/tone, not "Approved" or any
  other `formatTaskStatus(task.status)`-derived label.
  `inspection: confirm DeterministicTaskCard's status label reads the action DTO's state, not formatTaskStatus(task.status)`
- Two deterministic cards, both `state: 'active'`, whose step ids are `review` and an
  arbitrary non-standard fixture (e.g. `hardening`, item 15), render identical status
  label/tone/lane treatment — differing only in the displayed step descriptor's `id`/
  `purpose`.
  `inspection: confirm DeterministicTaskCard's status label/tone never differs by step id`
- `DeterministicTaskCard`'s footer renders a generic "Start" control plus the step
  descriptor for `availableActions: ["start-step"]`, and renders the human-interaction
  descriptor's own actions for an active human step — **never** `'start-implementation'`,
  `'start-review'`, `'approve'`, or `'request-changes'` as action identifiers anywhere in
  this component (item 12 — the prior inline branch it replaces did use those; this is a
  deliberate behavior change, not a preservation).
  `inspection: confirm neither of these four legacy action ids appears in DeterministicTaskCard`
- No component in this task's scope calls `stageForStatus()`, `isTaskReady()`,
  `formatTaskStatus()`, or `taskStatusTone()` for a deterministic task (brief regression
  test #13's card half), and none branches on `currentStep`/`nextStep`/a literal step id.
  `inspection: confirm neither sub-component calls these or branches on a step id for a deterministic task`

## Verification

```bash
node --test tools/dashboard/tests/ux-improvements-regression.test.mjs
```

## Out of scope

The server-side lane projection (task `deterministic-board-lane-projection`). The action DTO
itself (task `dashboard-deterministic-action-projection`). `TaskDialog`/chat (task
`human-step-surface-consolidation`).
