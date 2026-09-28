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
  - **Review together** — reserves the compatible set (`batch-queue-reservation`), then creates the
    batch session strictly through the canonical `admitAgentExecution` gate (the same single entry
    point every execution — single-task or batch — must pass through; this UI never opens a second,
    parallel session-creation path), which in turn triggers `batch-start-and-context-bootstrap`
    with fresh session semantics (`session: fresh`).
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
- **Context-capacity preflight (D26).** If `batch-start-and-context-bootstrap` rejects the batch
  with `BATCH_CONTEXT_TOO_LARGE`, the UI surfaces this as a distinct, explicit failure (e.g.
  suggesting a smaller selection or a different provider/model) — never a generic error, and never
  silently retried with truncated context.

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

Exposes: the "review individually"/"review together" choice and the post-batch per-task verdict
display. Consumes: `batch-queue-reservation`'s compatibility check and reservation call,
`execution-scope-model`'s scope (to create the batch session via `admitAgentExecution`),
`batch-start-and-context-bootstrap`'s `BATCH_CONTEXT_TOO_LARGE` preflight result,
`batch-context-and-report`'s report link and per-task references, the existing role-based
execution-policy provider/model/mode picker.

## Area-specific acceptance criteria

- Given three compatible review-eligible tasks, the UI offers both "review individually" and
  "review together"; choosing the latter reserves exactly those three and starts one session.
- After a batch completes, each of the three tasks shows its own verdict/feedback independently,
  plus one shared report link common to all three.
- Choosing to review one of the three individually while the others remain unselected still works
  exactly as it does today.

## Dependencies

`areas/batch-queue-reservation.md`, `areas/batch-start-and-context-bootstrap.md` (the
`admitAgentExecution`-triggered bootstrap this UI's session creation leads to, and the
context-capacity preflight it surfaces), `areas/batch-finish-operation.md`,
`areas/batch-completion-orchestration.md` (per-task verdicts are only final once the barrier
releases), `areas/multi-task-review-skill.md` (the session this UI starts runs the skill).

## Out of scope

Final visual design. Any role other than reviewer getting a UI entry point (D13). A dedicated
`/nevo-ai:*` command wrapper.
