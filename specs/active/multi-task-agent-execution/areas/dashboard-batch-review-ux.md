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
  - **Review together** — reserves the compatible set (`batch-queue-reservation`) and starts one
    `task-batch`-scoped session.
- Starting a batch session uses the normal, explicit provider/model/mode picker exactly as a
  single-task session would (D12) — no special-cased selection UI for a batch.
- The owner can freely choose to review one task individually even when a compatible batch is
  available — batch review is always optional, never forced.
- No hard batch-size limit is enforced by the UI (D6); the UI may recommend a small practical
  scope (e.g. visually deprioritizing a very large selection) without refusing it.
- Once a batch session completes, the UI shows each member task's own verdict/feedback
  individually (never one aggregate status standing in for the group) and a link to the one
  shared batch report (`review-batch-<id>.md`).

## Constraints

- Reuses the existing checkbox-picker component and its eligibility/warning display — this area
  adds the "review together" affordance and the batch-scoped session creation call, it does not
  redesign task selection from scratch.
- No UI path exists yet for any role other than reviewer to start a batch execution (D13) — this
  is a v1 scope boundary, not an oversight.

## Interfaces and boundaries

Exposes: the "review individually"/"review together" choice and the post-batch per-task verdict
display. Consumes: `batch-queue-reservation`'s compatibility check and reservation call,
`execution-scope-model`'s scope (to create the batch session), `batch-context-and-report`'s report
link and per-task references, the existing role-based execution-policy provider/model/mode
picker.

## Area-specific acceptance criteria

- Given three compatible review-eligible tasks, the UI offers both "review individually" and
  "review together"; choosing the latter reserves exactly those three and starts one session.
- After a batch completes, each of the three tasks shows its own verdict/feedback independently,
  plus one shared report link common to all three.
- Choosing to review one of the three individually while the others remain unselected still works
  exactly as it does today.

## Dependencies

`areas/batch-queue-reservation.md`, `areas/batch-finish-operation.md`,
`areas/multi-task-review-skill.md` (the session this UI starts runs the skill).

## Out of scope

Final visual design. Any role other than reviewer getting a UI entry point (D13). A dedicated
`/nevo-ai:*` command wrapper.
