# Area: Dashboard batch review UX

## Responsibility

Define the required interaction semantics (not final visual design) for selecting a compatible
task set, starting one batch reviewer session, and inspecting the resulting per-task verdicts and
shared report — restricted to the reviewer role for v1 (D13).

## Current state

The dashboard's checkbox-picker UI (`dashboard-orchestration-wiring`,
`specs/active/deterministic-status-architecture`) already supports selecting multiple tasks for
the existing sequential queue — pre-selected with whichever tasks are currently ready, freely
adjustable by the owner. No "start one session covering several tasks" affordance exists; every
current entry point creates a single-task session.

## Requirements

- When several tasks in the same change are simultaneously eligible for `review`/`reviewer`, the
  UI surfaces the existing compatible-set check (`batch-queue-reservation`'s selection function)
  and offers both:
  - **Review individually** — existing single-task flow, unchanged.
  - **Review together** — follows D33/D38 exactly: resolve the owner-selected provider/model/mode
    and its catalog capacity trait first → atomically reserve the compatible set while freezing
    that `executionConfigSnapshot` (the reservation also activates the barrier, D31) →
    `admitAgentExecution(scope: task-batch, batchExecutionId)` using exactly the frozen
    configuration → create the canonical batch `AgentSession` plus every member binding → start
    provider turn → inject a bootstrap prompt carrying `batchExecutionId` as protocol context
    only → **the agent's own first `workflow batch start` call activates members**. Prompt/tool
    arguments never become authoritative provider/model/capacity input.
- **Execution policy handling (D12)**:
  - Provider and mode are selected once for the batch session.
  - If member tasks have conflicting task-level overrides in `executionPolicy`, the UI surfaces
    the conflict in the configuration dialog and requires an explicit batch configuration choice
    (or one-off selection), rather than silently inheriting the first task's policy.
  - If member tasks agree or fall back to the role/default policy, that effective configuration is
    preselected as the starting baseline in the picker.
- The owner can freely choose to review one task individually even when a compatible batch is
  available — batch review is always optional, never forced.
- No hard batch-size limit is enforced by the UI (D6); the UI may recommend a small practical
  scope (e.g. visually deprioritizing a very large selection) without refusing it.
- Once a batch session completes, the UI shows each member task's own verdict/feedback
  individually (never one aggregate status standing in for the group) and a link to the one
  shared batch report (`review-batch-<batchExecutionId>.md`).
- **Context-capacity snapshot/preflight (D26/D34/D38).** This UI/server route resolves
  `traits.maxContextTokens` **before reservation** and freezes either
  `known(maxContextTokens, source)` or `unknown(reason)` in the reservation's execution
  snapshot. Batch-start later reads that durable snapshot; the model cannot change it. If known
  capacity produces `BATCH_CONTEXT_TOO_LARGE`, surface a distinct actionable failure and keep
  zero members activated. If capacity is unknown (valid for providers/models whose catalog lacks
  the trait), show an explicit warning that hard capacity preflight was unavailable; do not invent
  a number, block the batch solely for missing metadata, or silently truncate context.

## Constraints

- Reuses the existing checkbox-picker component and its eligibility/warning display — this area
  adds the "review together" affordance and the batch-scoped session creation call, it does not
  redesign task selection from scratch.
- No UI path exists yet for any role other than reviewer to start a batch execution (D13) — this
  is a v1 scope boundary, not an oversight.
- Every batch session is created through `admitAgentExecution` — this area's server-side transport
  wiring lives alongside the existing AI turn/admission transport
  (`tools/dashboard/server/ai/sessions/turns/**`, `tools/dashboard/server/ai/orchestration/**`), not
  as an independent `tools/dashboard/server/specs/**`-only path that could invent a second
  session-creation mechanism.

## Interfaces and boundaries

Exposes: the "review individually"/"review together" choice, the frozen execution/capacity
snapshot written with reservation, unknown-capacity warning, and post-batch per-task verdict
display. Consumes:
`batch-queue-reservation`'s compatibility check and reservation call, `execution-scope-model`'s
scope (to create the batch session via `admitAgentExecution`),
`batch-start-and-context-bootstrap`'s `BATCH_CONTEXT_TOO_LARGE` preflight result, `batch-report`'s
report link and per-task references, the existing role-based execution-policy provider/model/mode
picker (also the source of `traits.maxContextTokens`).

## Area-specific acceptance criteria

- Given three compatible review-eligible tasks, the UI offers both "review individually" and
  "review together"; choosing the latter reserves exactly those three and starts one session.
- After a batch completes, each of the three tasks shows its own verdict/feedback independently,
  plus one shared report link common to all three.
- Choosing to review one of the three individually while the others remain unselected still works
  exactly as it does today.

## Dependencies

`areas/batch-queue-reservation.md`, `areas/batch-start-and-context-bootstrap.md` (the
agent-invoked bootstrap the session this UI creates will call as its own first action, D33, and
the context-capacity preflight it surfaces), `areas/batch-finish-operation.md`,
`areas/batch-completion-orchestration.md` (per-task verdicts are only final once the barrier
releases), `areas/multi-task-review-skill.md` (the session this UI starts runs the skill).

## Out of scope

Final visual design. Any role other than reviewer getting a UI entry point (D13). A dedicated
`/nevo-ai:*` command wrapper.
