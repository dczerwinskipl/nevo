# Area: Conversational continuity and approval ergonomics

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
   pre-selected). Selecting it: (a) runs `approve`, (b) re-checks `start`'s guards
   (working-tree-clean, transition validity, `depsSatisfied`) against current state — not
   the state at the time `approve` was chosen, (c) runs `start` only if those guards
   still pass, (d) on a `start` failure, reports it and stops — the task remains
   `approved`; `approve` is not rolled back and is not silently re-run.
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
