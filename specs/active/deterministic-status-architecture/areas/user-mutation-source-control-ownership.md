# Area: User-mutation source-control ownership

## Responsibility

Make `workflow task publish` (and Batch Publish) own their own Git mutation end to end
(D29), closing the gap the real dogfooding run exposed: a standalone user mutation
(`change.yaml`'s `status: approved`) left dirty in the worktree, silently absorbed into an
unrelated agent's later finalize commit. Document the general ownership taxonomy this
mistake reveals (D30) so future dashboard actions are classified correctly before they're
built, rather than after a similar incident.

## Current state (grounded, 2026-09-21)

`publishTask()` (`tools/specs/workflow/publish/operation.mjs`) validates, calls
`setTaskStatus(change, taskId, 'approved')`, and returns — no commit/push call anywhere in
this file or in `store.mjs`. The reusable `commit-and-push` action
(`defaultActionRegistry.require('commit-and-push')`) is already registered and already called
by `finish-operation.mjs`'s own finalize sequence, but is not invoked from the publish path.
`docs/development/agent-workflow-protocol.md`'s existing ownership-boundaries section (D3's
precedent for where this kind of doc lives) does not yet distinguish standalone user
mutations from technical activations from completed lifecycle mutations.

## Requirements

- **Publish owns its commit/push (D29).** `publishTask()`/Batch Publish become: validate →
  mutate (`setTaskStatus`, unchanged) → commit → push (only if the resolved
  `workflow.sourceControl` config enables it, per the existing per-definition
  `sourceControl: {enabled, push}` config, unchanged in meaning) → return success. Reuse the
  existing, already-registered `commit-and-push` action — no second Git implementation.
- **Deterministic commit message.** Auto-generate `chore(workflow): publish <task-id>` (or
  the equivalent Batch Publish wording for multiple tasks) — never prompt the user for a
  commit message on this routine lifecycle action.
- **Crash/resume semantics.** Follow the same pattern `commit-and-push` already provides for
  `finishStep`'s own multi-stage mutate-then-finalize sequence; do not invent a new
  crash-recovery mechanism specific to Publish.
- **Clean-worktree guarantee preserved.** If `commit-and-push` fails after the mutation, the
  worktree is left exactly as dirty as any other action's own failure mode leaves it today —
  never worse, never silently swallowed.
- **Ownership taxonomy documented (D30).** Extend `docs/development/agent-workflow-protocol.md`'s
  existing ownership-boundaries section (no new doc file, per D3's precedent) with three
  explicit categories: (1) standalone user-originated Git-tracked mutation (must finalize its
  own commit/push — e.g. Publish); (2) technical activation that is part of an execution
  attempt (may remain part of that attempt, finalized by its own
  `workflow step finish`/`submitHumanStepResult` — e.g. `workflow step start`, human-step
  auto-activation); (3) completed lifecycle mutation (already owns its own finalize,
  unchanged — e.g. `submitHumanStepResult`, `finishStep`).

## Constraints

- No duplicate Git implementation — reuse `commit-and-push` exactly as `finish-operation.mjs`
  already does.
- No new doc file for the taxonomy (D3's precedent: extend the existing section).
- Batch Publish's multi-task commit must not partially apply — either all named tasks'
  `change.yaml` mutations are committed together, or the failure is surfaced with the
  worktree state `commit-and-push`'s own failure mode already leaves (no new semantics
  invented for the batch case beyond what a single-task failure already produces).

## Interfaces and boundaries

Exposes: `publishTask()`'s corrected return contract (now implies a clean worktree on
success); the documented three-category taxonomy.

Consumed by: the dashboard's Publish/Batch Publish UI actions; future dashboard actions,
which must classify themselves against the taxonomy before being built.

## Area-specific acceptance criteria

- After a successful `workflow task publish`, `git status` shows no uncommitted change to
  `change.yaml` (when the resolved `sourceControl` config enables commit) — proven by an
  integration test that runs publish against a real worktree and inspects git state
  afterward, not by mocking the commit call.
- The generated commit message matches `chore(workflow): publish <task-id>` exactly, with no
  user-supplied message required or accepted for this action.
- A `commit-and-push` failure after the `setTaskStatus` mutation leaves the worktree in the
  same class of dirty state `finish-operation.mjs`'s own failure mode already produces —
  proven by forcing a failure (e.g. a push rejection) and inspecting the resulting state.
- `docs/development/agent-workflow-protocol.md` states the three-category taxonomy with the
  concrete examples above, extending the existing section (`git diff` shows no new top-level
  heading/file).

## Dependencies

None among this change's own prior tasks — reuses the existing `commit-and-push` action
directly.

## Out of scope

Redesigning `commit-and-push` itself. Any change to `finishStep`'s own finalize sequence.
Retroactively re-classifying every existing dashboard action against the new taxonomy (this
area documents the taxonomy and fixes the one action it names — Publish — not an audit of
every other action).
