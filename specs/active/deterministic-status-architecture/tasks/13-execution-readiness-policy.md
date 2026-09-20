---
id: deterministic-status-architecture.execution-readiness-policy
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/execution-readiness-and-session-bootstrap.md
    - specs/active/deterministic-status-architecture/owner-decisions.md
allowed_paths:
  - tools/specs/workflow/readiness-policy.mjs
  - tools/specs/workflow/cli.mjs
  - tools/specs/workflow/step-context.mjs
  - tools/specs/workflow/human-step/**
  - tools/dashboard/server/ai/sessions/**
  - tools/tests/execution-readiness-policy.test.mjs
  - tools/dashboard/tests/session-task-bootstrap.test.mjs
  - tools/dashboard/tests/agent-session-workflow.test.mjs
forbidden_paths:
  - tools/specs/approve/**
  - tools/specs/start/**
  - tools/specs/complete/**
  - tools/specs/verify/**
  - tools/specs/lifecycle-primitives.mjs
  - tools/dashboard/ui/**
  - src/**
depends_on: [ workflow-task-publish-operation, deterministic-task-projection, step-executor-guard, human-step-execution-operations ]
semantic_references:
  decisions: [D10, D13, D15, D18, D19]
---

# Task: Execution readiness policy

## Goal

Build `ExecutionReadiness` (D10) — composing `TaskProjection` with the executor guard and
the engine's own, already-correct activation preconditions (D13) — and wire it into
`workflow step start`, `startHumanStep`, and the session-creation server route, without
reimplementing anything `ensureStepActivated` already does. Also correct, in place, the two
real bugs D18 found in `tools/dashboard/server/ai/sessions/service.mjs`: a single-item
contextual `taskIds` silently becoming a session's authoritative `activeTaskId`, and a
reachable `'implementation'` fallback in the turn-bootstrap path — without redesigning that
file's already-correct `resolveDeterministicWorkflowInfo()`/`formatNevoWorkflowContext()`
mechanism.

## Dependencies

`workflow-task-publish-operation`, `deterministic-task-projection` — the policy's
preconditions read both. `step-executor-guard` — reused, not reimplemented, for the
executor-mismatch precondition. `human-step-execution-operations` — this task wires the
non-executor readiness checks (draft/unpublished, unsatisfied dependency, terminal) into
`startHumanStep`'s call site, exactly as it does for `handleWorkflowStepStart`; it needs
that operation to already exist.

## Implementation constraints

- New module (e.g. `tools/specs/workflow/readiness-policy.mjs`) exposing one function
  (task + change + caller kind → ready/not-ready + reason), consuming
  `deterministic-task-projection`'s output and calling `step-executor-guard`'s function for
  the executor check — fails closed when: task is still `draft`/unpublished; a dependency
  is unsatisfied; the workflow is terminal; the executor guard rejects the caller kind; or
  the activation preconditions below reject.
- **D13 — do not reimplement the dirty-worktree/new-attempt check.**
  `ensureStepActivated` (`tools/specs/workflow/step-context.mjs`) already correctly
  distinguishes resuming an active attempt (`phase === 'active'`/`'terminal'` → no
  dirty-worktree check) from activating a step (`phase === 'new'`/`'completed'` → runs the
  dirty-worktree check). If this readiness policy needs a read-only preflight answer for
  this specific precondition (e.g. to report "would activation currently fail on a dirty
  worktree" without actually activating), extract the *existing* dirty-worktree check
  inside `ensureStepActivated` into its own small, exported, non-mutating function in
  `step-context.mjs` that `ensureStepActivated` itself also calls internally — refactor
  only, zero behavior change to `ensureStepActivated`'s own outcome for any input.
- Call this function from `handleWorkflowStepStart` (`tools/specs/workflow/cli.mjs`) before
  proceeding — do not duplicate its logic inline. `startHumanStep`
  (`tools/specs/workflow/human-step/operations.mjs`, task `human-step-execution-operations`)
  similarly composes this policy at its own call site. Both call sites already run
  `step-executor-guard`'s check directly (task 08 wired it into
  `handleWorkflowStepStart`/`handleWorkflowStepFinish`; task 09 wired it into
  `startHumanStep`/`submitHumanStepResult`) — this policy's own internal use of the same
  guard function is for callers that don't already have it wired directly (the dashboard
  action DTO, session bootstrap). Calling the guard function twice at the two CLI entry
  points is harmless (it's pure and idempotent) but not required; do not add a second,
  separate executor check there if one already runs — only wire in the parts this task
  actually adds (dependency/publish-state/terminal/activation preconditions).
- **Agent-owned step, session-creation route:** investigate
  `tools/dashboard/server/ai/sessions/{routes,service,binding-service}.mjs` first to
  establish whether a server-side readiness re-check already exists for deterministic
  execution-bound sessions; wire it to call this same policy function specifically for the
  agent-branch requests sent by the client's generic `start-step` dispatchers
  (`specification-detail-content.tsx`'s `startStep`, `agent-session-page.tsx`'s renamed
  agent-step handler, server-side — D19, `session-bootstrap-readiness-wiring`) — not at
  `CreateAgentSessionDialog`'s generic, contextual-`taskIds` path. This task does not
  construct or influence the session's initial trigger message — that stays a generic,
  step-id-agnostic message owned by the client-side entry points
  (`session-bootstrap-readiness-wiring`, task 15).
- **Human-owned step:** no session route is involved at all (item 5 — starting a human step
  never creates or binds a session). The readiness composition for this case is wired
  directly into `startHumanStep`'s own implementation
  (`tools/specs/workflow/human-step/operations.mjs`, already in this task's `allowed_paths`)
  — the human-step transport route (task `dashboard-human-step-transport`, which depends on
  this task) simply calls the already-readiness-gated `startHumanStep`, with no separate
  readiness wiring of its own.
- Neither call path itself calls `ensureStepActivated`/`startHumanStep` as a preflight —
  only the actual mutating calls do that.
- Only requests carrying an authoritative execution task id are subject to this check — a
  session with only contextual `taskIds` (including a draft task, no authoritative
  `taskId`) must never be checked against this policy.
- **D18 fix 1 — `primaryTaskId` single-task bug, `AgentSessionService#createSession()`:**
  remove the `taskIds.length === 1 ? taskIds[0] : undefined` branch entirely —
  `const primaryTaskId = options.taskId;`. Update the adjacent comment, which currently
  argues *for* the removed behavior ("a single associated task is unambiguous and may
  become the active task") — that argument is exactly what this fix rejects. This affects
  the `explicitActiveTaskId`/`bindSession` calls and the returned `activeTaskId`
  downstream, unchanged in their own logic — only the one input value changes.
- **D18 fix 2 — `'implementation'` fallback removal:** `formatNevoWorkflowContext`'s
  `step`/`attempt` parameters lose their default values (`= 'implementation'`, `= 1`) and
  become required — the function throws (e.g. a clear `TypeError`/explicit validation
  error) if either is missing, rather than silently formatting a fabricated value. The
  turn-bootstrap path's `bootstrapToRecord.step`/`.attempt` construction drops its own
  `|| 'implementation'`/`?? 1` fallbacks the same way. The automatic,
  `resolveDeterministicWorkflowInfo()`-driven path is unaffected by this change — that
  function already never returns a `workflowInfo` without a real, resolved `step`; only an
  explicit `workflowContext` override object missing `step` newly fails instead of silently
  defaulting.
- **D18 fix 3 — generic bootstrap wording:** change "When implementation and verification
  are complete, inspect StepContext.finishContract.parameters and run:" to "When the current
  step's work and required verification are complete, inspect
  StepContext.finishContract.parameters and run:" in `formatNevoWorkflowContext`'s output —
  the bootstrap text must never imply every agent step is implementation.

## Acceptance criteria

- `workflow step start <change> <task>` against a draft/unpublished task fails closed with
  a clear error (brief regression test #6, #10).
  `automated: node --test tools/tests/execution-readiness-policy.test.mjs`
- `workflow step start <change> <task>` against a task with an unsatisfied dependency fails
  closed, naming the blocking dependency. `automated: node --test tools/tests/execution-readiness-policy.test.mjs`
- `workflow step start <change> <task>` against a human-owned current step fails closed via
  the reused executor guard, not a second implementation.
  `automated: node --test tools/tests/execution-readiness-policy.test.mjs`
- An agent-step session-creation request naming an authoritative execution task id that is
  not ready is refused server-side even when sent directly, bypassing any UI-hidden button
  (brief regression test #9).
  `automated: node --test tools/tests/execution-readiness-policy.test.mjs`
- A `startHumanStep` call against an authoritative task id that is not ready (unpublished,
  unsatisfied dependency, terminal) is refused, with no session ever created or bound in
  the process — this readiness rejection and the executor-mismatch rejection (task 08/09)
  are the only two failure modes for this operation.
  `automated: node --test tools/tests/execution-readiness-policy.test.mjs`
- A request carrying only contextual `taskIds` (no authoritative `taskId`) succeeds
  regardless of any task's readiness — the policy is never invoked for it (brief regression
  test #7, #8). `automated: node --test tools/tests/execution-readiness-policy.test.mjs`
- A genuinely new attempt against a dirty baseline worktree fails closed; resuming an
  already-active attempt whose worktree contains only that attempt's own changes succeeds —
  proven by exercising the *actual*, unmodified `ensureStepActivated` behavior, not a
  reimplementation (D13). If a preflight function was extracted from `step-context.mjs`,
  every existing test covering `ensureStepActivated`'s own dirty-worktree behavior
  (`workflow-step-context.test.mjs` or equivalent) continues passing unchanged.
  `automated: node --test tools/tests/execution-readiness-policy.test.mjs tools/tests/workflow-step-context.test.mjs`
- `workflow step start`/session creation against a ready, published, dependency-satisfied,
  correctly-executor-matched task is unaffected — no new failure introduced for the
  already-working path. `automated: node --test tools/tests/workflow-cli.test.mjs`
- A session created with `{ taskIds: ['draft-task'] }` (exactly one contextual task, no
  `taskId`) results in `activeTaskId: undefined`/`taskId: undefined` on the returned
  session — not `'draft-task'` — and creation succeeds even though `draft-task` is not
  executable (item 9; this is a *new* regression, distinct from the existing zero-task and
  multi-task coverage).
  `automated: node --test tools/dashboard/tests/session-task-bootstrap.test.mjs`
- `formatNevoWorkflowContext({ changeSlug, taskId })` (no `step`/`attempt`) throws rather
  than formatting `'implementation'`/`attempt 1`. Calling it with explicit `step: 'hardening'`
  formats that value verbatim, with no `'implementation'` substring anywhere in the output,
  and its wording reads "When the current step's work and required verification are
  complete…", not "When implementation and verification are complete…".
  `automated: node --test tools/dashboard/tests/session-task-bootstrap.test.mjs`
- The automatic, `resolveDeterministicWorkflowInfo()`-driven bootstrap path is unaffected by
  fix 2 — a real deterministic task session still injects the correct, real `step`/`attempt`
  exactly as before. `automated: node --test tools/dashboard/tests/agent-session-workflow.test.mjs`

## Verification

```bash
node --test tools/tests/execution-readiness-policy.test.mjs
node --test tools/tests/workflow-step-context.test.mjs
node --test tools/tests/workflow-cli.test.mjs
node --test tools/dashboard/tests/session-task-bootstrap.test.mjs
node --test tools/dashboard/tests/agent-session-workflow.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Any change to legacy session-creation behavior. Client-side UI action projection (owned by
the UI-split tasks, which consume this same policy's results via the dashboard action DTO).
Any change to `ensureStepActivated`'s own behavior beyond the optional, behavior-preserving
extraction of an internal check into its own exported function (D13).
