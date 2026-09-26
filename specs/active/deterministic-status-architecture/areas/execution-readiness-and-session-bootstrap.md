# Area: Execution readiness and session bootstrap

## Responsibility

Provide `ExecutionReadiness` (D10) — the layer between the pure `TaskProjection`
(`areas/deterministic-projection-and-human-step.md`) and the dashboard action DTO
(`areas/dashboard-server-actions-wiring.md`) — composing task-projection state with the
executor guard and the engine's own, *already-correct*, existing activation preconditions
(D13), reused rather than reimplemented, and consumed identically by `workflow step start`
and `startHumanStep`. What happens *after* a positive readiness answer is explicitly
**not** identical: an agent-owned step's positive answer is followed by AI execution
session creation/reuse, then `workflow step start`; a human-owned step's positive answer is
followed by `startHumanStep` directly, with **no** AI execution session created or bound.
Per D15, this is a **protocol** distinction only — it must never become a semantic one
("agent = implementation/review," "human = approval"). This area owns the client-side
agent-session-bootstrap entry points, and — per D15's correction of this area's own prior
content — owns **no** step-id-keyed dispatch of any kind: an agent session's initial
trigger is one generic, visible message, identical for every agent step, and the actual
work contract comes entirely from the existing `[Nevo Workflow Context]`/`StepContext`
mechanism already implemented in `tools/dashboard/server/ai/sessions/service.mjs` (D18 —
two real bugs in that same file corrected in place, not redesigned).

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

**Grounded facts (D15/D18, 2026-09-19, second read):** `compileStepContext()`
(`tools/specs/workflow/step-context.mjs`) already returns everything an agent needs —
`currentStep`, `attempt`, `instructions`, `stepContract.purpose`/`.expectedWork`/`.hints`,
`expectedWork.allowedPaths`/`.forbiddenPaths`, `relevantDocs`, `previousTransition`,
`entryState`, `finishContract` — there is no second instruction system to build.
`resolveDeterministicWorkflowInfo()`/`formatNevoWorkflowContext()`
(`tools/dashboard/server/ai/sessions/service.mjs`) already resolve the authoritative
current step from real `workflow_progress` and inject the hidden `[Nevo Workflow Context]`
header telling the agent to run `workflow step start` — this mechanism is real and correct
for its *automatic* path. Two real bugs remain in that same file, both owned by this area's
readiness-policy task rather than redesigned: `formatNevoWorkflowContext`'s own default
parameters (`step = 'implementation'`, `attempt = 1`) and a turn-bootstrap fallback
(`... || 'implementation'`) can surface that literal string for an explicit
`workflowContext` override missing its own `step`; and
`AgentSessionService#createSession()`'s `const primaryTaskId = options.taskId ||
(taskIds.length === 1 ? taskIds[0] : undefined)` silently promotes a single-item contextual
`taskIds` array to the session's authoritative `activeTaskId` — contradicting this area's
own "contextual `taskIds` is never authoritative" requirement below, for exactly the
one-task case that requirement most needs to hold.

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
- **Agent-owned step (`start-step` + `executor: agent`, D15):** the client entry point
  calls `ExecutionReadiness` (via the server) before creating or reusing an authoritative AI
  execution session bound to the task, then sends **one generic, visible trigger** —
  conceptually "Execute the current workflow step for task `<task>`" — never a step-id- or
  purpose-derived semantic prompt ("Implement task…"/"Review task…"). This is genuine
  session-creation/-bootstrap, at `specification-detail-content.tsx`'s generic `startStep`
  dispatcher/`agent-session-page.tsx`'s renamed handler (D19), not at
  `CreateAgentSessionDialog`'s contextual-`taskIds` path. The actual, step-specific work
  contract is supplied entirely by the existing bootstrap mechanism this area corrects two
  bugs in (below) — this entry point does not, and must not, construct its own second
  instruction system.
- **Human-owned step (`start-step` + `executor: human`, `startHumanStep`):** the readiness
  check still runs first, but the positive-answer path never creates or binds an AI
  execution session — it calls `startHumanStep` directly (via the transport in
  `areas/dashboard-server-actions-wiring.md`). A contextual chat/session may already exist
  and display `HumanStepSurface`, but starting the human step is never itself a
  session-bootstrap action, regardless of whether such a session happens to exist.
  Concretely (D19), the board and `TaskDialog` reach this branch through
  `specification-detail-content.tsx`'s single `startStep(task, stepDescriptor)` dispatcher
  (the same function used for the agent branch, differing only by the `executor` check);
  chat reaches it through its own feature-local `human-step-mutations.ts` adapter hook
  directly, since chat never needs to cross the specifications/agent-sessions boundary the
  board/dialog case does. Neither `TaskCard` nor `TaskDialog` (both
  `features/specifications`) implements this branch itself — both only call an
  `onStartStep`/equivalent callback prop supplied from above.
- Neither entry point's preflight check itself calls `ensureStepActivated`/activates
  anything — only the actual `workflow step start`/`startHumanStep` call does that.
- **No step-id dispatch of any kind (D15, supersedes this area's own earlier "transitional
  adapter" content).** No `switch`/`if`/lookup-object keyed on `step.id`,
  `currentStep`/`nextStep`, or any other literal step name may exist in this area's
  client-side entry points, the readiness-policy module, or anywhere else in this area's
  scope. A newly authored agent-owned step (any id) must work through this entry point with
  zero code changes here.
- **Two real bugs in `tools/dashboard/server/ai/sessions/service.mjs`, corrected in place
  (D18):**
  1. `formatNevoWorkflowContext`'s `step`/`attempt` parameters lose their default values
     (`= 'implementation'`, `= 1`) and become required — the function throws if either is
     missing, rather than silently defaulting. The turn-bootstrap path's
     `bootstrapToRecord.step`/`.attempt` construction drops its own `|| 'implementation'`/
     `?? 1` fallbacks the same way — an explicit `workflowContext` override missing `step`
     is a caller error, never a guessed default. The automatic,
     `resolveDeterministicWorkflowInfo()`-driven path is unaffected (it already never
     returns a `workflowInfo` without a real, resolved `step`).
  2. Generalize the turn-bootstrap wording "When implementation and verification are
     complete…" to "When the current step's work and required verification are complete…" —
     the bootstrap must never imply every agent step is implementation.
  3. `AgentSessionService#createSession()`'s `primaryTaskId` computation drops the
     `taskIds.length === 1 ? taskIds[0] : undefined` branch entirely —
     `const primaryTaskId = options.taskId;`. A session's `activeTaskId`/`taskId` is
     authoritative if and only if the caller explicitly supplied `options.taskId`;
     contextual `taskIds` of any length never sets it (item 9, below).
- Generic chat is unaffected: a deterministic spec's chat session with contextual `taskIds`
  (including a draft task) and no authoritative `taskId` remains ordinary chat — this
  policy is never invoked for it, and contextual task selection is never treated as
  execution intent. This holds for **every** `taskIds` length, including exactly one
  (item 9) — `{ taskIds: ['draft-task'] }` alone must never set `activeTaskId`, trigger
  `ExecutionReadiness`, trigger execution bootstrap, or fail because that task isn't
  executable. Do not auto-select `taskIds[0]` (or any single contextual entry) as
  authoritative.

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
single composition-level `startStep` dispatcher (D19) that reaches both the agent-owned-step
session-bootstrap entry point and the human-owned-step entry point (`startHumanStep`, no
session involved) via the same generic `start-step` action, and `workflow step start`/
`startHumanStep` (both via the executor guard and activation-guard composition, not via a
copy).

## Area-specific acceptance criteria

- A `workflow step start <change> <task>` call against a draft/unpublished task, or against
  a human-owned step, fails closed with a clear error, independent of any UI state.
- A `startHumanStep` call against an agent-owned step fails closed the same way.
- A `startHumanStep` call against a ready, correctly-executor-matched human step succeeds
  and does **not** create or bind any AI execution session — asserted directly, not just
  inferred from the absence of a session-creation call.
- A session-creation request from an agent-owned `start-step` click naming an authoritative
  execution task id that is not ready (unpublished, unsatisfied dependency, terminal, or
  executor-mismatched) is refused server-side, even when sent directly.
- For the same task, the session's initial trigger message is byte-for-byte identical
  regardless of which agent step is being started (proven for at least two differently-named
  steps run against the same task, e.g. `implementation` and an arbitrary `hardening`
  fixture, item 15) — no step-id/purpose text appears in it. (Across different tasks, the
  message may legitimately differ by the task id it names — never by step id/purpose.)
- No file in this area's scope contains a `switch`/`if`/lookup-object keyed on a literal
  step id, `currentStep`, or `nextStep`.
- A session created with `{ taskIds: ['draft-task'] }` (exactly one contextual task, no
  `taskId`) behaves as ordinary chat: no `activeTaskId` is set, `ExecutionReadiness` is
  never invoked, and creation does not fail because `draft-task` isn't executable — this is
  tested explicitly, not only the zero-task and multi-task cases (item 9).
- A session created via `CreateAgentSessionDialog` with contextual `taskIds` of any other
  length (zero or many) and no authoritative `taskId` behaves as ordinary chat;
  `ExecutionReadiness` is never invoked for it.
- A draft task remains fully discussable through ordinary contextual chat.
- No contextual task is ever auto-selected as authoritative execution intent, regardless of
  `taskIds` length.
- An explicit `workflowContext` override missing its own `step` fails
  (`formatNevoWorkflowContext` throws) rather than silently formatting `'implementation'`.
  The turn-bootstrap wording no longer literally names "implementation."
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
to `ensureStepActivated`'s own behavior (D13). A real, declarative per-step dispatch/
execution-mode metadata system (D15 — `start-step` uses one consistent existing session/
provider default for every agent step, independent of which step it is; no per-step mode
is chosen here). Full archetype/handover/provider-selection design for agent orchestration.
Any redesign of `resolveDeterministicWorkflowInfo()`/`formatNevoWorkflowContext()`'s own
mechanism beyond the two bugs named above (D18) — the `[Nevo Workflow Context]`/
`StepContext` bootstrap itself is correct and unchanged.
