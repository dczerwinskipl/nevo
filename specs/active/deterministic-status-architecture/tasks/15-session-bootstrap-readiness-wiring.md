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
  - tools/dashboard/ui/shared/lib/human-step-request.ts
  - tools/dashboard/ui/shared/workflow/**
  - src/**
depends_on: [ execution-readiness-policy, dashboard-deterministic-action-projection, dashboard-human-step-transport ]
semantic_references:
  decisions: [D15, D18, D19]
---

# Task: Session bootstrap readiness wiring (client)

## Goal

Implement the **generic** `start-step` dispatcher for both executor protocols (D15, D19):
`specification-detail-content.tsx` owns one composition-level `startStep(task, stepDescriptor)`
function (renamed/rewritten from the prior `handleWorkflowAction`) that branches only on
`stepDescriptor.executor` — for `executor: 'agent'`, creates/reuses the task's authoritative
execution session and sends one generic, visible trigger, never a step-id-derived semantic
prompt ("Implement task…"/"Review task…"); for `executor: 'human'`, calls `startHumanStep`
directly through the shared `human-step-request.ts` transport function (D14/D17, owned by
`dashboard-human-step-transport`), creating or binding **no** AI execution session. This
task owns **no** dispatch logic keyed on a step id anywhere — the prior "transitional
adapter" concept this task previously owned stays removed outright (item 1/7 — pass 5
supersedes pass 4's D15). This task also owns updating the frontend DTO type (`types.ts`) to
the corrected server projection shape (item 14, D18), and owns renaming
`agent-session-page.tsx`'s `handleStartReviewTask` to a generic name (D19) — the chat
surface's own consumption of that renamed prop is `human-step-surface-consolidation`'s
scope, not this task's.

## Dependencies

`execution-readiness-policy` — this task's tests exercise that task's server-side behavior
from the client's perspective. `dashboard-deterministic-action-projection` — this task
consumes the `availableActions: ["start-step"]`/step-descriptor DTO contract that task
introduces; this task must not be authored or executed against a version of the DTO that
doesn't exist yet. `dashboard-human-step-transport` (D19) — this task's composition-level
dispatcher calls that task's shared, neutral `human-step-request.ts` function directly for
the human-executor branch; this task must not be authored or executed against a version of
that transport that doesn't exist yet, and must not reimplement the request itself.

## Implementation constraints

- No change to `CreateAgentSessionDialog`'s existing contextual "zero or many tasks"
  selection model — a session with contextual `taskIds` and no authoritative `taskId` must
  remain fully supported, unchanged, and must never be treated as execution intent.
- **`specification-detail-content.tsx` owns one generic composition-level dispatcher (D19),
  `startStep(task, stepDescriptor)`, replacing the prior `handleWorkflowAction`'s
  action-string branches entirely** — its only branch predicate is
  `stepDescriptor.executor`:
  - `executor === 'agent'`: creates/reuses the task's authoritative execution session
    (passing the authoritative `taskId`, never a contextual one) and sends **one generic,
    visible trigger message** — conceptually "Execute the current workflow step for task
    `<task>`" — **never** text derived from the step's `id`/`purpose` ("Implement task…"/
    "Review task…"/"Perform discovery…"). The real work contract is supplied entirely by the
    *existing*, unmodified `[Nevo Workflow Context]`/`StepContext` bootstrap mechanism in
    `tools/dashboard/server/ai/sessions/service.mjs` (D18 fixes two bugs there; this task does
    not touch that file — `forbidden_paths` enforces it — it only sends the initial generic
    trigger the server-side mechanism then augments).
  - `executor === 'human'`: calls `startHumanStep` directly through the shared, neutral
    `human-step-request.ts` function (`{ action: 'start' }`, D14/D17, owned by
    `dashboard-human-step-transport`) — creates or binds **no** AI execution session, does
    not call `useCreateAgentSession`, and does not navigate to a session. On success it
    refreshes the actions query so the board/dialog reflect the now-active human interaction.
  - The prior `'approve'`/`'request-changes'` branches (the old human-verification-gate
    action vocabulary D5 already superseded, which POSTed directly to
    `/workflow/human-decision`) are removed from this dispatcher outright — that behavior is
    `HumanStepSurface`'s `onSubmit` responsibility (`human-step-surface-consolidation`),
    reached only through `TaskDialog`/chat, never through this board-level dispatcher.
  - This same `startStep` function is passed as one `onStartStep` prop to both
    `StatusBoard`→`TaskCard` (the board entry point, `task-card-lifecycle-split`'s scope) and
    a new `onStartStep` prop this task adds to `TaskDialog`
    (`features/specifications/tasks/task-dialog.tsx` stays out of this task's `allowed_paths`
    — this task only supplies the prop value from `specification-detail-content.tsx`;
    `human-step-surface-consolidation` owns `task-dialog.tsx`'s own consumption of it).
- `agent-session-page.tsx`'s `handleStartReviewTask` is renamed to a generic name (e.g.
  `handleStartAgentStep`) and its literal `` `Review task ${taskId}` `` prompt replaced with
  the identical generic trigger wording used by the board/dialog path above — this handler
  only ever implements the agent-executor protocol (chat never starts a human-owned step
  through this task's files; that is `human-step-surface-consolidation`'s scope via its own
  feature-local adapter hook, D19). This task renames the prop `agent-session-page.tsx`
  passes down to the chat surface to match (e.g. `onStartAgentStep`); the chat surface's own
  consumption of the renamed prop, and removal of its obsolete
  `'start-review'`/`'approve'`/`'request-changes'` rendering block, is
  `human-step-surface-consolidation`'s scope, not this task's.
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
  step id, `currentStep`, or `nextStep` — the only branch predicate anywhere in this task's
  `startStep`/renamed-chat-handler is `stepDescriptor.executor`.
  `inspection: confirm no step-id-keyed construct exists anywhere in this task's allowed_paths, and the only branch predicate is executor`
- Clicking `start-step` against a `waiting-for-step-start` task whose next step has
  `executor: 'human'` calls `startHumanStep` (via the shared transport, `{ action: 'start'
  }`) and creates/binds **no** AI execution session — asserted directly, not only inferred
  from the absence of a session-creation call (D19; this reverses this task's own prior
  criterion, which forbade the human-step call before this pass wired a caller to it).
  `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
- `TaskDialog` receives an `onStartStep` prop from `specification-detail-content.tsx` wired
  to the same `startStep` function the board uses — proven by both entry points producing
  identical requests (same trigger message for the agent branch, same `{ action: 'start' }`
  body for the human branch) for the same task/step.
  `inspection: confirm specification-detail-content.tsx passes the same startStep function as onStartStep to both StatusBoard and TaskDialog`
- `agent-session-page.tsx` contains no prop or handler literally named `*ReviewTask*`, and
  its renamed handler's initial trigger text contains no step-id/purpose-derived wording.
  `inspection: confirm no *ReviewTask* identifier remains in agent-session-page.tsx and the trigger text is generic`
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
this whole change). `TaskDialog`'s own rendering/consumption of the `onStartStep` prop this
task supplies, `TaskCard`'s own rendering/consumption of the same prop, the chat surface's
own consumption of the renamed `onStartAgentStep` prop, and any submission of an *active*
human interaction's result (`HumanStepSurface`'s `onSubmit`) — all owned by
`task-card-lifecycle-split`/`human-step-surface-consolidation` (D19).
