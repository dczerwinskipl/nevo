# Area: Conversational continuity and approval ergonomics

> Refined 2026-08-04 — terminology only (see `owner-decisions.md` D8): the guard re-check
> in requirement 2 now uses the postcondition/retry-safety vocabulary from area
> `recovery-and-resume` instead of a bare boolean guard check, and a `partially_completed`
> `start` failure now records an `execution.suspension` rather than only "reporting" the
> failure with nothing persisted.
>
> Refined again 2026-08-04 (second pass) — see D17. Requirement 2's `start` failure
> handling gains a fourth branch: a `confirm-required` result no longer just gets
> "reported and stopped" — it resumes the combined `approve`→`start` flow in place after
> one owner confirmation, using area `recovery-and-resume`'s resumable recovery handle.
> The flow's stop conditions are now anchored to the five-value postcondition-result
> vocabulary (adds `unsafe_manual`), not prose.

## Responsibility

Own how `/nevo-ai:*` commands offer their own next transition inline, and the
approve+start combined-confirmation exception (D3), without weakening any existing
approval gate.

## Current state

`spec-review.md` prints a `Next command` block only. `spec-approve.md` offers exactly
three outcomes and explicitly forbids combining approval with start. `task-review.md`
computes but doesn't act on its own next-step recommendation. See `overview.md` §
"Conversational shape" for citations.

## Requirements

1. `spec-review` reaching `ready-for-approval` (per the existing verdict table in
   `docs/ai/specification-workflow.md`) offers, in the same turn, a closed-choice menu
   that includes "approve now" — selecting it hands off to the same interactive
   confirmation `spec-approve` already performs (review exists, verdict ready, nothing
   unresolved, fingerprint current — enforced by the CLI, unchanged). This is an
   additional entry point into the existing gate, not a bypass of it.
2. `spec-approve` gains a fourth outcome, "approve and start" (D3), presented as its own
   explicit menu item alongside the existing three (never the default, never
   pre-selected). Selecting it: (a) runs `approve`, (b) re-checks `start`'s postconditions
   (area `recovery-and-resume`'s `start-task` contract: working-tree-clean, transition
   validity, `depsSatisfied`) against current state — not the state at the time `approve`
   was chosen, (c) runs `start` only if those preconditions still hold, (d) on a `start`
   failure, classifies it per the five-value result vocabulary (D17) and branches:
   - **`partially_completed`** — records an `execution.suspension`
     (`previous_action: start`), reports it, and stops; the task remains `approved`.
   - **`confirm-required` (D17, second refinement pass)** — presents the recovery action
     for confirmation *in the same turn*; on confirmation, applies the repair via the
     resumable recovery handle (area `recovery-and-resume` requirement 4a), re-inspects
     `start`'s postconditions, executes only what's still missing, and completes the
     combined flow — the owner is never asked to separately re-invoke
     `/nevo-ai:task-start`.
   - **`not_retryable`/`unsafe_manual`** — reports it and stops; the task remains
     `approved`; a fresh, separately-presented suspension is recorded if applicable.

   In every branch, `approve` is never rolled back and never silently re-run.
3. `task-review` reaching a fully-terminal change keeps its existing archive-offer
   behavior (`artifact-policy.md`, already designed); under an active batch (area
   `batch-execution-and-gating-review`), it additionally offers "continue to next batch
   task" inline instead of only printing text — this is the one place this area's
   behavior composes with batch execution, and it must not fire outside an active batch.
4. Every inline offer in this area is still a real, interactive confirmation — "offering
   inline" means removing a redundant command-invocation round-trip, not removing the
   owner's decision point. Silence is still not agreement (`decision-policy.md`).
5. Manual, single-outcome invocation of `spec-approve` (approve-only / keep-as-draft /
   show-report) remains available and behaves exactly as it does today.

## Constraints

- Does not change `tools/specs.mjs approve`'s or `start`'s own gate logic — this area is
  entirely about the conversational layer choosing to call them in sequence with a
  confirmation and a guard re-check in between.
- Does not add a "approve and start" option to any command other than `spec-approve` —
  `task-start` remains its own explicit, single-purpose command.
- The re-guard-check in requirement 2(b) must use the same guard functions `handleStart`
  already runs standalone — no parallel guard implementation.
- The `confirm-required` resume branch (requirement 2) confirms **once** per repair — it
  must not loop indefinitely presenting the same confirmation; if the re-inspected
  postconditions still don't hold after one confirmed repair, that is a `not_retryable`
  or `unsafe_manual` result on the next inspection, not a repeated confirmation prompt.

## Interfaces and boundaries

Exposes: the extended `spec-approve` menu; `spec-review`'s inline approval offer;
`task-review`'s batch-aware continuation offer.

Consumes: `deriveStage`/the recovery controller (area `recovery-and-resume`) for
computing what to offer; `state-and-fingerprint-semantics` for correct dependency/status
reads.

## Area-specific acceptance criteria

- A test/manual trace proves `spec-approve`'s "approve and start" path performs two
  distinct CLI calls (`approve` then `start`), not one combined operation.
- A test proves a `start` failure after a successful `approve` leaves the task's status
  at `approved`, not `in-implementation` and not reverted to `draft`.
- A test proves the batch-aware continuation offer in `task-review` never appears outside
  an active batch.
- A test proves a `confirm-required` `start` failure inside the combined flow, once
  confirmed, resumes and completes `start` without a second `/nevo-ai:task-start`
  invocation, and that `approve` is called exactly once (D17).
- A test proves an `unsafe_manual` `start` failure inside the combined flow stops and
  reports, and never presents a confirmation prompt for it (D17).

## Dependencies

`recovery-and-resume` (tasks 02, 03) — needs the classified-error/retry model and the
`deriveStage`-based controller before this area can offer transitions inline
responsibly (e.g. not offering "start" inline when a recoverable error would immediately
block it).

## Out of scope

- Auto-approving anything — every offer in this area still requires an explicit owner
  answer.
- Combining `spec-review` and `spec-approve` into one command file — they remain separate
  commands; only the conversational hand-off between them changes.
