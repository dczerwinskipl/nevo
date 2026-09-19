---
id: deterministic-status-architecture.session-bootstrap-readiness-wiring
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/execution-readiness-and-session-bootstrap.md
    - specs/active/deterministic-status-architecture/areas/dashboard-server-actions-wiring.md
    - specs/active/deterministic-status-architecture/owner-decisions.md
allowed_paths:
  - tools/dashboard/ui/features/agent-sessions/create-agent-session-dialog.tsx
  - tools/dashboard/ui/features/agent-sessions/queries.ts
  - tools/dashboard/ui/features/specifications/detail/specification-detail-content.tsx
  - tools/dashboard/ui/features/agent-sessions/agent-session-page.tsx
  - tools/dashboard/ui/features/specifications/types.ts
  - tools/dashboard/tests/**
forbidden_paths:
  - tools/specs/**
  - tools/dashboard/server/**
  - src/**
depends_on: [ execution-readiness-policy, dashboard-deterministic-action-projection ]
semantic_references:
  decisions: [D15, D18]
---

# Task: Session bootstrap readiness wiring (client)

## Goal

Implement the **generic** agent-step execution bootstrap entry point (D15): clicking
`start-step` for an `executor: agent` task creates/reuses the task's authoritative
execution session and sends one generic, visible trigger — never a step-id-derived
semantic prompt ("Implement task…"/"Review task…"). This task owns **no** dispatch logic
keyed on a step id — the prior "transitional adapter" concept this task previously owned is
removed outright, not kept smaller (item 1/7 — pass 5 supersedes pass 4's D15). This task
also owns updating the frontend DTO type (`types.ts`) to the corrected server projection
shape (item 14), since it is the first frontend consumer that needs it.

## Dependencies

`execution-readiness-policy` — this task's tests exercise that task's server-side behavior
from the client's perspective. `dashboard-deterministic-action-projection` — this task
consumes the `availableActions: ["start-step"]`/step-descriptor DTO contract that task
introduces; this task must not be authored or executed against a version of the DTO that
doesn't exist yet.

## Implementation constraints

- No change to `CreateAgentSessionDialog`'s existing contextual "zero or many tasks"
  selection model — a session with contextual `taskIds` and no authoritative `taskId` must
  remain fully supported, unchanged, and must never be treated as execution intent.
- `specification-detail-content.tsx`'s `handleWorkflowAction` and
  `agent-session-page.tsx`'s `handleStartReviewTask` become the two client entry points
  that respond to the DTO's generic `"start-step"` action for an `executor: agent` step:
  each creates/reuses the task's authoritative execution session (passing the authoritative
  `taskId`, never a contextual one) and sends **one generic, visible trigger message** —
  conceptually "Execute the current workflow step for task `<task>`" — **never** text
  derived from the step's `id`/`purpose` ("Implement task…"/"Review task…"/"Perform
  discovery…"). The real work contract is supplied entirely by the *existing*, unmodified
  `[Nevo Workflow Context]`/`StepContext` bootstrap mechanism in
  `tools/dashboard/server/ai/sessions/service.mjs` (D18 fixes two bugs there; this task does
  not touch that file — `forbidden_paths` enforces it — it only sends the initial generic
  trigger the server-side mechanism then augments).
- **No step-id dispatch of any kind (D15 — supersedes and removes this task's prior
  "transitional adapter" scope entirely).** No `switch`/`if`/lookup-object keyed on
  `step.id`, `currentStep`, or `nextStep` may exist anywhere in this task's files. A newly
  authored agent-owned step (any id) must reach this entry point and execute correctly with
  zero changes to any file in this task's scope.
- If the session-creation API accepts a `mode`/archetype parameter, use one consistent,
  existing default (matching today's actual default for agent-session creation) —
  independent of which step is being started. Do not choose a mode by comparing the step's
  `id` to a literal string, and do not design a new per-step mode/archetype system (out of
  scope, unchanged from prior passes) — if the existing default already varies by something
  other than step id (e.g. provider/session-level configuration), that existing behavior is
  preserved as-is; this task only removes the *step-id-keyed* selection, it does not
  redesign mode selection generally.
- Both entry points surface a readiness-refusal error from the server clearly and
  actionably — do not silently swallow it or show a generic failure toast.
- **Frontend DTO type ownership (D18, item 14):** update
  `tools/dashboard/ui/features/specifications/types.ts` to the corrected server projection
  shape — add `state`, `executor`, a current/next-step descriptor (`{ id, executor, purpose,
  expectedWork }`), `blockedBy`, terminal outcome, and the human-interaction descriptor;
  keep `availableActions?: string[]` (generic strings, e.g. `"start-step"` — not a new
  object-union type, per D18's explicit preference). Remove/deprecate the fields this
  replaces (`currentStep`/`attempt`/`workflowState` as bare strings) only to the extent the
  legacy branch doesn't still need them — coordinate with (do not contradict)
  `dashboard-deterministic-action-projection`'s actual server DTO shape.
- Do not add any client-side readiness re-derivation (e.g. do not port
  `deterministic-task-projection`/executor-guard logic into the frontend) — the client
  trusts the server's answer and the DTO's `availableActions` visibility check; this task
  only makes the server's refusal legible when the visibility check is bypassed.
- Never auto-select a contextual task as the authoritative execution `taskId` anywhere in
  this task's scope.

## Acceptance criteria

- Creating a session via `CreateAgentSessionDialog` with contextual `taskIds: [draftTask]`
  (exactly one contextual task, no `taskId`) succeeds and behaves as ordinary chat — no
  execution bootstrap, no readiness check — unaffected by this change (item 9's client-side
  half; the single-task server-side fix is D18/task 13's scope).
  `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
- Clicking the generic `start-step` control against a draft (unpublished) or
  executor-mismatched agent task surfaces the server's readiness-refusal error clearly.
  `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
- The session's initial trigger message is byte-for-byte identical for at least two
  differently-named, differently-purposed agent steps (e.g. `review` and an arbitrary
  `hardening` fixture, item 15) — no step-id/purpose text appears in it, and no
  dashboard/server code change is required to add the `hardening` case.
  `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
- A draft task remains fully discussable through a contextual-only chat session — no
  readiness check blocks the conversation itself.
  `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
- Neither `CreateAgentSessionDialog` nor the execution entry points ever auto-select a
  contextual task as authoritative execution intent.
  `inspection: confirm task selection stays explicit and opt-in in all components`
- No file in this task's scope contains a `switch`/`if`/lookup-object keyed on a literal
  step id, `currentStep`, or `nextStep`.
  `inspection: confirm no such construct exists anywhere in this task's allowed_paths`
- No file in this task's scope creates or binds a session for a human-owned step — this
  task's files never call any human-step operation/transport.
  `inspection: confirm no reference to startHumanStep or the human-step transport route exists in this task's scope`
- `types.ts` carries `state`, `executor`, a current/next-step descriptor, `blockedBy`,
  terminal outcome, the human-interaction descriptor, and `availableActions?: string[]`
  matching the corrected server DTO shape from `dashboard-deterministic-action-projection`.
  `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`

## Verification

```bash
node --test tools/dashboard/tests/agent-session-workflow.test.tsx
```

## Out of scope

The server-side readiness check itself (owned by `execution-readiness-policy`). The two
`service.mjs` bug fixes (owned by `execution-readiness-policy`, D18). Legacy session
creation (unaffected). Any per-step dispatch/mode/archetype system (D15, out of scope for
this whole change).
