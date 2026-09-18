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
depends_on: [ deterministic-readiness-policy ]
---

# Task: Session bootstrap readiness wiring (client)

## Goal

Ensure the client-side execution entry points ("Start implementation"/"Start review") and
the generic session dialog both behave correctly against the server-side readiness policy
landed in `deterministic-readiness-policy`: execution entry points surface a refusal
clearly; the generic dialog's contextual (non-authoritative) task selection remains
unaffected and is never promoted to execution intent.

## Dependencies

`deterministic-readiness-policy` — this task's tests exercise that task's server-side
behavior from the client's perspective.

## Implementation constraints

- No change to `CreateAgentSessionDialog`'s existing contextual "zero or many tasks"
  selection model — a session with contextual `taskIds` and no authoritative `taskId` must
  remain fully supported, unchanged, and must never be treated as execution intent.
- `specification-detail-content.tsx`'s `handleWorkflowAction` and
  `agent-session-page.tsx`'s `handleStartReviewTask` (the actual "Start implementation"/
  "Start review" entry points, which do pass an authoritative `taskId`) surface a
  readiness-refusal error from the server clearly and actionably — do not silently swallow
  it or show a generic failure toast.
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
  change (brief regression test #7, #8; corrective-pass item 10).
  `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
- Clicking "Start implementation"/"Start review" against a draft (unpublished) or
  executor-mismatched task surfaces the server's readiness-refusal error clearly.
  `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
- A draft task remains fully discussable through a contextual-only chat session — no
  readiness check blocks the conversation itself.
  `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
- Neither `CreateAgentSessionDialog` nor the two execution entry points ever auto-select a
  contextual task as authoritative execution intent.
  `inspection: confirm task selection stays explicit and opt-in in all three components`

## Verification

```bash
node --test tools/dashboard/tests/agent-session-workflow.test.tsx
```

## Out of scope

The server-side readiness check itself (owned by `deterministic-readiness-policy`). Legacy
session creation (unaffected).
