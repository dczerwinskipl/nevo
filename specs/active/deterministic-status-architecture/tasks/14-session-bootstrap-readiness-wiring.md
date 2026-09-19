---
id: deterministic-status-architecture.session-bootstrap-readiness-wiring
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/execution-readiness-and-session-bootstrap.md
allowed_paths:
  - tools/dashboard/ui/features/agent-sessions/create-agent-session-dialog.tsx
  - tools/dashboard/ui/features/agent-sessions/queries.ts
  - tools/dashboard/ui/features/specifications/detail/specification-detail-content.tsx
  - tools/dashboard/ui/features/agent-sessions/agent-session-page.tsx
  - tools/dashboard/tests/**
forbidden_paths:
  - tools/specs/**
  - tools/dashboard/server/**
  - src/**
depends_on: [ execution-readiness-policy ]
---

# Task: Session bootstrap readiness wiring (client)

## Goal

Ensure the client-side **agent**-execution entry points ("Start implementation"/"Start
review" — session-creation, per item 5 distinct from the human-step case, which is
`human-step-surface-consolidation`'s scope, not this task's) and the generic session
dialog both behave correctly against the server-side `ExecutionReadiness` policy landed in
`execution-readiness-policy`: entry points surface a refusal clearly; the generic dialog's
contextual (non-authoritative) task selection remains unaffected and is never promoted to
execution intent. This task also owns the one small, explicitly transitional D15 adapter
that decides *how* to dispatch a given agent step (edit mode vs. agent mode).

## Dependencies

`execution-readiness-policy` — this task's tests exercise that task's server-side behavior
from the client's perspective.

## Implementation constraints

- No change to `CreateAgentSessionDialog`'s existing contextual "zero or many tasks"
  selection model — a session with contextual `taskIds` and no authoritative `taskId` must
  remain fully supported, unchanged, and must never be treated as execution intent.
- `specification-detail-content.tsx`'s `handleWorkflowAction` and
  `agent-session-page.tsx`'s `handleStartReviewTask` (the actual "Start implementation"/
  "Start review" entry points, which do pass an authoritative `taskId`) surface a
  readiness-refusal error from the server clearly and actionably — do not silently swallow
  it or show a generic failure toast. Neither path creates a session for a human-owned
  step — the DTO's `start-agent-step` action (D15) only ever appears for `executor: agent`
  steps in the first place, but this task's own dispatch does not additionally branch on
  executor as a safety net; it trusts the DTO.
- **D15 adapter, isolated here:** `DashboardActionProjection` emits one generic
  `{ type: 'start-agent-step', step: { id, purpose, expectedWork, ... } }` action — it does
  not say *how* to dispatch it. Add a small, explicitly-commented-as-transitional mapping
  (e.g. a local lookup keyed by `step.id`) from today's two known step ids
  (`implementation` → edit-mode dispatch, `review` → agent-mode dispatch, matching current
  UI behavior) to the existing session-creation call each already makes — this mapping lives
  only in this task's files, never in a shared/server module, and is documented as a
  temporary stand-in for real declarative per-step dispatch metadata (out of scope for this
  change).
- Do not add any client-side readiness re-derivation (e.g. do not port
  `deterministic-task-projection`/executor-guard logic into the frontend) — the client
  trusts the server's answer and the existing `actionGate.availableActions` visibility
  check; this task only makes the server's refusal legible when the visibility check is
  bypassed.
- Never auto-select a contextual task as the authoritative execution `taskId` anywhere in
  this task's scope.

## Acceptance criteria

- Creating a session via `CreateAgentSessionDialog` with contextual `taskIds: [draftTask]`
  and no authoritative `taskId` succeeds and behaves as ordinary chat, unaffected by this
  change (brief regression test #7, #8; corrective-pass-1 item 10).
  `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
- Clicking "Start implementation"/"Start review" against a draft (unpublished) or
  executor-mismatched task surfaces the server's readiness-refusal error clearly.
  `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
- A draft task remains fully discussable through a contextual-only chat session — no
  readiness check blocks the conversation itself.
  `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
- Neither `CreateAgentSessionDialog` nor the execution entry points ever auto-select a
  contextual task as authoritative execution intent.
  `inspection: confirm task selection stays explicit and opt-in in all components`
- The transitional dispatch adapter correctly routes `implementation` to edit-mode dispatch
  and `review` to agent-mode dispatch, reading only `step.id` from the DTO's
  `start-agent-step` action — never a literal comparison against `currentStep`/`nextStep`
  elsewhere in this task's files.
  `inspection: confirm the mapping is isolated to one small, commented function and reads only the action's step.id`
- No file in this task's scope creates or binds a session for a human-owned step — this
  task's files never call any human-step operation/transport.
  `inspection: confirm no reference to startHumanStep or the human-step transport route exists in this task's scope`

## Verification

```bash
node --test tools/dashboard/tests/agent-session-workflow.test.tsx
```

## Out of scope

The server-side readiness check itself (owned by `execution-readiness-policy`). Legacy
session creation (unaffected).
