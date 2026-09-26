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
  - tools/dashboard/ui/features/specifications/types.ts
  - tools/dashboard/tests/**
forbidden_paths:
  - tools/specs/**
  - tools/dashboard/server/**
  - tools/dashboard/ui/shared/lib/human-step-request.ts
  - tools/dashboard/ui/shared/workflow/**
  - tools/dashboard/ui/screens/specification-detail/specification-detail-content.tsx
  - tools/dashboard/ui/features/agent-sessions/agent-session-page.tsx
  - tools/dashboard/ui/features/agent-sessions/agent-session-chat-surface.tsx
  - tools/dashboard/ui/features/specifications/tasks/task-dialog.tsx
  - src/**
depends_on: [ execution-readiness-policy, dashboard-deterministic-action-projection ]
semantic_references:
  decisions: [D15, D18, D19]
---

# Task: Session bootstrap primitives (client)

## Goal

**Producer-only task (corrected per the seventh, strictly mechanical pass): establish the
reusable primitives later UI-wiring tasks consume — this task wires no button, no
dispatcher, and no screen.** Own the frontend DTO type (`types.ts`, D18), and own one small,
pure, feature-agnostic-within-`features/agent-sessions` primitive — a generic agent-step
trigger-message builder (conceptually `buildAgentStepTriggerMessage(taskId): string`,
exported from `queries.ts`) that produces the **one generic, visible trigger** — conceptually
"Execute the current workflow step for task `<task>`" — **never** text derived from the
step's `id`/`purpose` ("Implement task…"/"Review task…"/"Perform discovery…"). This function
is pure (no fetch, no React, no session creation) so both the board/dialog composition
entry point (`specification-detail-composition-wiring`, a later task) and the chat entry
point (`human-step-surface-consolidation`, a later task) can import it and get byte-for-byte
identical wording despite using different session mechanics (create-and-navigate vs.
send-turn-on-an-already-open-session). This task does **not** itself call the builder from
any UI surface, does not touch `specification-detail-content.tsx` (real path:
`tools/dashboard/ui/screens/specification-detail/specification-detail-content.tsx`, outside
`features/**` entirely — `forbidden_paths` enforces this explicitly), and does not touch
`agent-session-page.tsx`/`agent-session-chat-surface.tsx`/`task-dialog.tsx` — those are owned
by the tasks that actually wire the primitive into a screen (`specification-detail-composition-wiring`,
`human-step-surface-consolidation`).

## Dependencies

`execution-readiness-policy` — this task's tests exercise that task's server-side behavior
from the client's perspective (readiness-refusal surfacing is a caller concern this task's
own files may exercise indirectly, e.g. via `CreateAgentSessionDialog`'s existing error
handling, without owning any button that triggers it). `dashboard-deterministic-action-projection`
— this task's `types.ts` update matches the `availableActions: ["start-step"]`/step-descriptor
DTO contract that task introduces; this task must not be authored or executed against a
version of the DTO that doesn't exist yet.

## Implementation constraints

- No change to `CreateAgentSessionDialog`'s existing contextual "zero or many tasks"
  selection model — a session with contextual `taskIds` and no authoritative `taskId` must
  remain fully supported, unchanged, and must never be treated as execution intent.
- **`buildAgentStepTriggerMessage(taskId)` (or an equivalent pure export from `queries.ts`)
  is the one place the generic trigger wording is defined** — conceptually "Execute the
  current workflow step for task `<task>`," identical regardless of which step/executor is
  being started (D15). It takes no step id/purpose/executor as input, so it is structurally
  incapable of producing step-id-derived text. It performs no session creation, no fetch, and
  no navigation — those remain each caller's own mechanism (board/dialog creates or reuses a
  session and navigates; chat sends a turn on the session it is already inside), which this
  task does not implement or prescribe beyond "call this builder for the message."
- **No step-id dispatch of any kind (D15 — supersedes and removes this task's prior
  "transitional adapter" scope entirely).** No `switch`/`if`/lookup-object keyed on
  `step.id`, `currentStep`, or `nextStep` may exist anywhere in this task's files. A newly
  authored agent-owned step (any id) must produce the identical trigger message with zero
  changes to any file in this task's scope.
- If the session-creation API accepts a `mode`/archetype parameter, this task's own files
  (`create-agent-session-dialog.tsx`, `queries.ts`) keep using one consistent, existing
  default (matching today's actual default for agent-session creation) — independent of
  which step is being started. Do not choose a mode by comparing the step's `id` to a
  literal string, and do not design a new per-step mode/archetype system (out of scope,
  unchanged from prior passes).
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
  trusts the server's answer and the DTO's `availableActions` visibility check.
- Never auto-select a contextual task as the authoritative execution `taskId` anywhere in
  this task's scope.

## Acceptance criteria

- Creating a session via `CreateAgentSessionDialog` with contextual `taskIds: [draftTask]`
  (exactly one contextual task, no `taskId`) succeeds and behaves as ordinary chat — no
  execution bootstrap, no readiness check — unaffected by this change (item 9's client-side
  half; the single-task server-side fix is D18/task 13's scope).
  `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
- **Corrected invariant (this pass — the prior "byte-for-byte identical output for two
  different `taskId`s" wording was self-contradictory, since the message legitimately
  includes the task id and therefore differs whenever `taskId` differs):** for the **same**
  `taskId`, `buildAgentStepTriggerMessage(taskId)` returns the identical string regardless of
  which workflow step is about to be started — proven by calling it directly for a task
  whose next step is `review` and, separately, for the same task with its next step swapped
  to an arbitrary `hardening` fixture (item 15) and asserting the two calls return the exact
  same string. Across **different** task ids, outputs may legitimately differ, but only by
  the `taskId` value itself — never by step id, purpose, executor, or any other
  step-semantic wording.
  `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
- **Structural guarantee (stronger than the behavioral proof above):** the builder's
  signature accepts only `taskId` — no step id, purpose, or executor parameter exists at
  all, so it is structurally incapable of varying by step regardless of what any test
  exercises.
  `inspection: confirm buildAgentStepTriggerMessage's signature has no step-id/purpose/executor parameter — taskId is its only input`
- Neither `CreateAgentSessionDialog` nor any file in this task's scope ever auto-selects a
  contextual task as authoritative execution intent.
  `inspection: confirm task selection stays explicit and opt-in in all components in this task's scope`
- No file in this task's scope contains a `switch`/`if`/lookup-object keyed on a literal
  step id, `currentStep`, or `nextStep`.
  `inspection: confirm no step-id-keyed construct exists anywhere in this task's allowed_paths`
- `types.ts` carries `state`, `executor`, a current/next-step descriptor, `blockedBy`,
  terminal outcome, the human-interaction descriptor, and `availableActions?: string[]`
  matching the corrected server DTO shape from `dashboard-deterministic-action-projection`.
  `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
- This task's own test suite exercises `buildAgentStepTriggerMessage` and `types.ts` only —
  it does not assert on `StatusBoard`, `TaskCard`, `TaskDialog`, or any chat-surface
  rendering, since this task owns no UI surface (those assertions belong to the tasks that
  own those files).
  `inspection: confirm this task's own tests target only queries.ts/types.ts, not a screen or feature component`

## Verification

```bash
node --test tools/dashboard/tests/agent-session-workflow.test.tsx
```

## Out of scope

The server-side readiness check itself (owned by `execution-readiness-policy`). The two
`service.mjs` bug fixes (owned by `execution-readiness-policy`, D18). Legacy session
creation (unaffected). Any per-step dispatch/mode/archetype system (D15, out of scope for
this whole change). The composition-level `startStep(task, stepDescriptor)` dispatcher, its
wiring into `StatusBoard`/`TaskCard`/`TaskDialog`, and `specification-detail-content.tsx`
itself (owned by `specification-detail-composition-wiring`, a later task that depends on
this one). `agent-session-page.tsx`'s renamed handler, `agent-session-chat-surface.tsx`'s
generic waiting-step control, and any submission of an *active* human interaction's result
(`HumanStepSurface`'s `onSubmit`) — all owned by `human-step-surface-consolidation`, a later
task that depends on this one. `TaskCard`'s own rendering/consumption of `onStartStep` —
owned by `task-card-lifecycle-split`, a later task that depends on this one.
