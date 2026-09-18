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
  - tools/dashboard/tests/**
forbidden_paths:
  - tools/specs/**
  - tools/dashboard/server/**
  - src/**
depends_on: [ deterministic-readiness-policy ]
---

# Task: Session bootstrap readiness wiring (client)

## Goal

Ensure the client-side session-creation flow surfaces the server-side readiness policy's
refusal clearly, and confirm (with tests) that generic task-less/draft-task chat continues
to work unaffected by the new server-side check landed in `deterministic-readiness-policy`.

## Dependencies

`deterministic-readiness-policy` — this task's tests exercise that task's server-side
behavior from the client's perspective.

## Implementation constraints

- No change to `CreateAgentSessionDialog`'s existing "zero or many tasks" selection model —
  a session with `taskIds: []` must remain fully supported, unchanged.
- If `useCreateAgentSession()`'s mutation now can receive a readiness-refusal error from the
  server for an authoritative execution task id, surface it as a clear, actionable error in
  the dialog rather than a generic failure toast — do not silently swallow it.
- Do not add any client-side readiness re-derivation (e.g. do not port
  `deterministic-task-projection` logic into the frontend) — the client trusts the server's
  answer and the existing `actionGate.availableActions` visibility check; this task only
  makes the server's refusal legible when the visibility check is bypassed.

## Acceptance criteria

- Creating a session with `taskIds: []` on a deterministic spec succeeds and behaves as
  ordinary chat, unaffected by this change (brief regression test #7, #8).
  `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
- Creating a session naming a draft (unpublished) task as the sole authoritative execution
  task id surfaces the server's readiness-refusal error clearly in the dialog.
  `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
- A draft task remains fully discussable through a `taskIds: []` (or non-execution-intent)
  chat session — no readiness check blocks the conversation itself.
  `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
- The dialog never auto-selects the first task from task context as execution intent.
  `inspection: confirm CreateAgentSessionDialog's task selection stays explicit, opt-in, defaulting to none selected`

## Verification

```bash
node --test tools/dashboard/tests/agent-session-workflow.test.tsx
```

## Out of scope

The server-side readiness check itself (owned by `deterministic-readiness-policy`). Legacy
session creation (unaffected).
