# Area: Execution readiness and session bootstrap

## Responsibility

Provide the one deterministic readiness policy — consumed identically by UI action
projection, session/execution bootstrap, and `workflow step start` itself — so a session or
a direct CLI call cannot bypass what the UI merely hides.

## Current state

No shared readiness policy exists for deterministic tasks. Client-side, `TaskCard`'s
deterministic action buttons are gated only by `actionGate.availableActions.includes(...)` —
a visibility check, not a re-validated readiness check at click/request time.
`useCreateAgentSession()` POSTs `{ specId, taskId, taskIds, mode }` directly to
`/api/agent-sessions` with no client-side pre-check. Whether the server route
(`tools/dashboard/server/ai/sessions/{routes,service,binding-service}.mjs`) already
re-validates readiness independently was not confirmed by discovery and must be verified as
part of this area's own investigation before deciding whether server-side logic needs to
change or already exists to hook into.

## Requirements

- One readiness policy function, built on the canonical projection
  (`areas/deterministic-projection-and-human-interaction.md`), answering "can this task
  start/continue deterministic execution right now," failing closed when: the task is still
  `draft`/unpublished; a dependency is unsatisfied (per that area's dependency-satisfaction
  result); the workflow is terminal; execution state is otherwise invalid; or any existing
  clean-worktree/operation guard fails.
- `workflow step start` calls this policy before proceeding — a direct CLI invocation with
  an authoritative task id cannot start execution on a not-ready task, regardless of what
  the UI shows.
- The session/execution bootstrap path (server-side `/api/agent-sessions` handling, or
  whichever layer actually creates the execution-bound session) calls the same policy before
  binding a task for deterministic execution — never a copy of the logic.
- Generic chat is unaffected: a deterministic spec's chat session with no authoritative task
  id (`taskIds: []`, already supported today per discovery) remains ordinary chat; a draft
  task may still be discussed through it. Only explicit task-execution intent (an
  authoritative execution `taskId` bound to the session) enters this readiness check. Do not
  auto-select the first task from task context to manufacture that intent.

## Constraints

- Exactly one readiness implementation — UI, session bootstrap, and `workflow step start`
  each call it, none re-implements it.
- No change to legacy readiness (`isTaskReady()`) or legacy session bootstrap.

## Interfaces and boundaries

Exposes: the readiness policy function (task → ready/not-ready + reason).

Consumed by: `areas/ui-dashboard-board-split.md` and `areas/ui-task-details-human-review.md`
(action projection), the session-creation server route, and `workflow step start`
(`tools/specs/workflow/cli.mjs`).

## Area-specific acceptance criteria

- A `workflow step start <change> <task>` call against a draft/unpublished task fails
  closed with a clear error, independent of any UI state.
- A session-creation request naming an authoritative execution task id that is not ready
  (unpublished, unsatisfied dependency, or terminal) is refused server-side, even when sent
  directly (not through the UI's hidden button) — proving the UI-hidden-button bypass risk
  is actually closed, not just visually hidden.
- A session created with `taskIds: []` (no authoritative task) behaves as ordinary chat; the
  readiness policy is never invoked for it.
- A draft task remains fully discussable through ordinary chat (no readiness check blocks
  the conversation itself, only execution-intent actions).
- The first task in a spec's task list is never auto-selected as execution intent by session
  bootstrap.

## Dependencies

`areas/deterministic-task-publish.md` (published state), `areas/deterministic-projection-and-human-interaction.md`
(the projection and dependency-satisfaction result this policy is built on).

## Out of scope

Any change to how sessions are created for legacy specs. Handover/session-reuse policy
(explicitly out of scope for this whole change).
