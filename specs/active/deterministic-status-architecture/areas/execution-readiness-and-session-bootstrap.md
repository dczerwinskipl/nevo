# Area: Execution readiness and session bootstrap

## Responsibility

Provide `ExecutionReadiness` (D10) — the layer between the pure `TaskProjection`
(`areas/deterministic-projection-and-human-step.md`) and the dashboard action DTO
(`areas/dashboard-server-actions-wiring.md`) — composing task-projection state with the
executor guard and the engine's own, *already-correct*, existing activation preconditions
(D13), reused rather than reimplemented, and consumed identically by `workflow step start`,
`startHumanStep`, and session/execution bootstrap.

## Current state

No shared readiness layer exists yet. Client-side, `TaskCard`'s deterministic action buttons
are gated only by `actionGate.availableActions.includes(...)` — a visibility check, not a
re-validated readiness check at click/request time. Execution sessions are created from the
"Start implementation"/"Start review" action paths (`specification-detail-content.tsx`'s
`handleWorkflowAction`, `agent-session-page.tsx`'s `handleStartReviewTask`), which pass an
authoritative `taskId` — distinct from `CreateAgentSessionDialog`, which only ever passes
contextual `taskIds` and never an authoritative `taskId`. `useCreateAgentSession()` POSTs
directly to `/api/agent-sessions` with no client-side pre-check. Whether the server route
(`tools/dashboard/server/ai/sessions/{routes,service,binding-service}.mjs`) already
re-validates readiness independently was not confirmed by discovery and must be verified as
part of this area's own investigation.

**Grounded correction (D13, 2026-09-19):** `ensureStepActivated` (`step-context.mjs`)
already correctly distinguishes resuming an active attempt (`phase === 'active'`/
`'terminal'` → returns immediately, no dirty-worktree check at all) from activating a step
(`phase === 'new'`/`'completed'` → runs the dirty-worktree check, excluding
`.nevo-ai-local/`, before writing). This is *already* "new attempt + dirty baseline → fail;
resume active attempt + dirty worktree → allowed" — this area does not implement this
distinction, it reuses the existing one.

## Requirements

- `ExecutionReadiness` composes `TaskProjection` with the executor-guard function
  (`areas/step-executor-model.md`, reused not duplicated) and the engine's existing
  activation preconditions, answering "can this task start/continue deterministic execution
  right now," failing closed when: the task is still `draft`/unpublished; a dependency is
  unsatisfied; the workflow is terminal; the target step's `executor` doesn't match the
  caller kind; or the activation preconditions `ensureStepActivated` already enforces would
  reject (a genuinely new attempt against a dirty baseline).
- **Do not reimplement the dirty-worktree/new-attempt-vs-resume check.** If a read-only
  preflight query is genuinely needed (e.g. to show readiness state before a mutating call),
  extract the existing check from `step-context.mjs` into its own small, exported,
  non-mutating function that `ensureStepActivated` itself also calls internally — one
  implementation, inspected by both the mutating path and the read-only preflight, never
  two.
- `workflow step start` and `startHumanStep` (`areas/step-executor-model.md`) both resolve
  to the same `ensureStepActivated` call for the actual activation decision — this area
  never intercepts or re-decides that call, it only composes a *read* of the same facts for
  advisory/UI purposes.
- The session/execution bootstrap path calls `ExecutionReadiness` before binding a task for
  deterministic execution — never a copy of the logic — specifically at the "Start
  implementation"/"Start review"/"Start human step" entry points that pass an authoritative
  `taskId`, not at `CreateAgentSessionDialog`'s contextual-`taskIds` path. This preflight
  check never itself calls `ensureStepActivated`/activates anything — only the actual
  `workflow step start`/`startHumanStep` call does that.
- Generic chat is unaffected: a deterministic spec's chat session with contextual `taskIds`
  (including a draft task) and no authoritative `taskId` remains ordinary chat — this
  policy is never invoked for it, and contextual task selection is never treated as
  execution intent. Do not auto-select the first contextual task as authoritative.

## Constraints

- Exactly one readiness implementation, exactly one executor-guard implementation, and
  exactly one activation-precondition implementation (`ensureStepActivated`'s own,
  unmodified) — UI, session bootstrap, `workflow step start`, and `startHumanStep` each
  consume them, none re-implements any of them.
- No change to `ensureStepActivated`'s own behavior (D13 — this area corrects the spec's
  prior claim that it needed fixing; it does not).
- No change to legacy readiness (`isTaskReady()`) or legacy session bootstrap.

## Interfaces and boundaries

Exposes: the `ExecutionReadiness` function (task + caller kind → ready/not-ready + reason,
including executor-mismatch as one possible reason).

Consumed by: `areas/dashboard-server-actions-wiring.md`'s `DashboardActionProjection`, the
"Start implementation"/"Start review"/"Start human step" session-creation entry points, and
`workflow step start`/`startHumanStep` (both via the executor guard and activation-guard
composition, not via a copy).

## Area-specific acceptance criteria

- A `workflow step start <change> <task>` call against a draft/unpublished task, or against
  a human-owned step, fails closed with a clear error, independent of any UI state.
- A `startHumanStep` call against an agent-owned step fails closed the same way.
- A session-creation request from "Start implementation"/"Start review"/"Start human step"
  naming an authoritative execution task id that is not ready (unpublished, unsatisfied
  dependency, terminal, or executor-mismatched) is refused server-side, even when sent
  directly.
- A session created via `CreateAgentSessionDialog` with contextual `taskIds` (including a
  draft task) and no authoritative `taskId` behaves as ordinary chat; `ExecutionReadiness`
  is never invoked for it.
- A draft task remains fully discussable through ordinary contextual chat.
- No contextual task is ever auto-selected as authoritative execution intent.
- A genuinely new attempt against a dirty baseline worktree fails closed; resuming an
  already-active attempt whose worktree contains only that attempt's own changes succeeds —
  proven by exercising the *existing*, unmodified `ensureStepActivated` behavior through
  this area's composition, not a reimplementation.
- If a preflight query function was extracted from `step-context.mjs`, it returns the
  identical answer `ensureStepActivated`'s own internal check would give for the same
  state, for both the allow and reject cases.

## Dependencies

`areas/deterministic-task-publish.md` (published state),
`areas/deterministic-projection-and-human-step.md` (`TaskProjection`, the pure state this
composes), `areas/step-executor-model.md` (the executor guard and
`ensureStepActivated`/`startHumanStep` this area reuses).

## Out of scope

Any change to legacy session-creation behavior. Handover/session-reuse policy. Any change
to `ensureStepActivated`'s own behavior (D13).
