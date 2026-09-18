# Area: Execution readiness and session bootstrap

## Responsibility

Provide the one deterministic readiness policy — consumed identically by UI action
projection, session/execution bootstrap, and `workflow step start` itself — so a session or
a direct CLI call cannot bypass what the UI merely hides.

## Current state

No shared readiness policy exists for deterministic tasks. Client-side, `TaskCard`'s
deterministic action buttons are gated only by `actionGate.availableActions.includes(...)` —
a visibility check, not a re-validated readiness check at click/request time. Execution
sessions are created from the "Start implementation"/"Start review" action paths
(`specification-detail-content.tsx`'s `handleWorkflowAction`, `agent-session-page.tsx`'s
`handleStartReviewTask`), which pass an authoritative `taskId` — distinct from
`CreateAgentSessionDialog`, which only ever passes contextual `taskIds` (zero or many,
discussion-only) and never an authoritative `taskId`. `useCreateAgentSession()` POSTs
directly to `/api/agent-sessions` with no client-side pre-check. Whether the server route
(`tools/dashboard/server/ai/sessions/{routes,service,binding-service}.mjs`) already
re-validates readiness independently was not confirmed by discovery and must be verified as
part of this area's own investigation before deciding whether server-side logic needs to
change or already exists to hook into. Today's clean-worktree requirement in `start`-style
operations does not distinguish "allocating a new attempt" from "resuming the worktree of
an already-active attempt" — this area must not blanket-block the latter.

## Requirements

- One readiness policy function, built on the canonical projection
  (`areas/deterministic-projection-and-human-step.md`) and the executor guard
  (`areas/step-executor-model.md`), answering "can this task start/continue deterministic
  execution right now," failing closed when: the task is still `draft`/unpublished; a
  dependency is unsatisfied (per that area's dependency-satisfaction result); the workflow
  is terminal; the target step's `executor` doesn't match the caller kind (agent bootstrap
  vs. a human-owned step — reusing `step-executor-model`'s guard function, not a second
  implementation); or an existing clean-worktree/operation guard fails for a *genuinely new*
  attempt.
- The clean-worktree requirement applies only when allocating a new attempt or starting the
  next step — resuming an already-active agent attempt whose worktree contains that
  attempt's own in-progress changes is not blocked by this policy. This is a correction to
  the original design, which did not distinguish the two cases.
- `workflow step start` calls this policy before proceeding — a direct CLI invocation with
  an authoritative task id cannot start execution on a not-ready task or a human-owned step,
  regardless of what the UI shows.
- The session/execution bootstrap path calls the same policy before binding a task for
  deterministic execution — never a copy of the logic — specifically at the "Start
  implementation"/"Start review" entry points that pass an authoritative `taskId`, not at
  `CreateAgentSessionDialog`'s contextual-`taskIds` path.
- Generic chat is unaffected: a deterministic spec's chat session with contextual `taskIds`
  (including a draft task) and no authoritative `taskId` remains ordinary chat — this
  policy is never invoked for it, and contextual task selection is never treated as
  execution intent. Do not auto-select the first contextual task as authoritative.

## Constraints

- Exactly one readiness implementation, and exactly one executor-guard implementation
  (reused from `areas/step-executor-model.md`, not duplicated) — UI, session bootstrap, and
  `workflow step start` each call them, none re-implements either.
- No change to legacy readiness (`isTaskReady()`) or legacy session bootstrap.

## Interfaces and boundaries

Exposes: the readiness policy function (task → ready/not-ready + reason, including
executor-mismatch as one possible reason).

Consumed by: `areas/dashboard-server-actions-wiring.md` and `areas/ui-dashboard-board-split.md`
(action projection), the "Start implementation"/"Start review" session-creation entry
points, and `workflow step start` (`tools/specs/workflow/cli.mjs`).

## Area-specific acceptance criteria

- A `workflow step start <change> <task>` call against a draft/unpublished task, or against
  a human-owned step, fails closed with a clear error, independent of any UI state.
- A session-creation request from "Start implementation"/"Start review" naming an
  authoritative execution task id that is not ready (unpublished, unsatisfied dependency,
  terminal, or executor-mismatched) is refused server-side, even when sent directly —
  proving the UI-hidden-button bypass risk is actually closed, not just visually hidden.
- A session created via `CreateAgentSessionDialog` with contextual `taskIds` (including a
  draft task) and no authoritative `taskId` behaves as ordinary chat; the readiness policy
  is never invoked for it.
- A draft task remains fully discussable through ordinary contextual chat (no readiness
  check blocks the conversation itself, only execution-intent actions).
- No contextual task is ever auto-selected as authoritative execution intent.
- A genuinely new attempt against a dirty baseline worktree fails closed (unchanged
  behavior). Resuming an already-active attempt whose worktree contains only that attempt's
  own changes succeeds — proving the new-attempt-vs-resume distinction is real, not just
  documented.

## Dependencies

`areas/deterministic-task-publish.md` (published state), `areas/deterministic-projection-and-human-step.md`
(the projection and dependency-satisfaction result this policy is built on),
`areas/step-executor-model.md` (the executor guard this policy reuses).

## Out of scope

Any change to how sessions are created for legacy specs. Handover/session-reuse policy
(explicitly out of scope for this whole change).
