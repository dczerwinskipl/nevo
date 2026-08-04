# Area: Finalization and migration

## Responsibility

Own post-merge verification for `spec-finalize`, the migration path from the old
whole-file fingerprint scheme to the new field-excluding one, the classification-rule
doc-contradiction fix, and rolling every other area's changes into the docs/commands that
describe the workflow — the wrap-up area every other area's tasks feed into.

## Current state

`validateFinalize`'s gate (`lifecycle.mjs:131-191`) is entirely pre-merge; nothing
re-checks `main`'s state after the squash-merge. `docs/ai/specification-workflow.md:61`
("prefer the smaller class when uncertain") contradicts the signal-based classification
table beneath it, which routes genuine ambiguity to **E** (discovery first). The in-flight
`nevo-documentation-architecture` change's `reviews/spec.md` carries a `spec_fingerprint`
computed under the current whole-file scheme.

## Requirements

### Post-merge check (task 09)

1. After `finalize` (no `--check`) completes a real merge, run one cheap post-merge
   verification against the resulting `main` state: `node tools/specs.mjs check` and
   `node tools/docs.mjs check` on the post-merge tree (confirms the archive commit itself
   didn't leave a stale generated index). Do not add a duplicate `dotnet build`/`dotnet
   test` run here — `validateFinalize` already ran verification pre-merge, and a
   squash-merge of an already-green branch has no plausible mechanism to change build/test
   outcomes; re-running them would cost time without catching a distinct failure mode.
2. Report the post-merge check's result as part of `finalize`'s existing output, using the
   same "gating vs. non-gating" labeling convention `review-policy.md` already defines —
   a post-merge check failure is reported clearly but does not un-merge anything (the
   merge already happened); it becomes a follow-up entry (area
   `context-and-validation-hardening`) if it fails.

### Migration (task 09)

3. No `change.yaml` structural migration is required for D1 (fingerprint scope is a
   computation change, not a schema change).
4. Every existing `reviews/*.md` with a `spec_fingerprint` — concretely, the
   `nevo-documentation-architecture` change's `reviews/spec.md` — becomes stale under the
   new scheme the first time this change ships. Confirm `validateApproval`'s existing
   "stale fingerprint, re-run the review" error message (`lifecycle.mjs:100-106`) already
   surfaces this correctly with no code change, and document it as a one-time,
   expected re-review requirement in this change's own migration notes — not a defect to
   route around.
5. State explicit rollout order: land `state-and-fingerprint-semantics` (task 01) and its
   tests first — everything else depends on its corrected semantics — then
   `recovery-and-resume`/`conversational-continuity` (tasks 02-04), then
   `context-and-validation-hardening` (tasks 05-07), then
   `batch-execution-and-gating-review` (task 08), then this area's own remaining work.
6. Fallback behavior: if a later task in this change is abandoned mid-rollout, every
   earlier-landed task must leave the workflow in a fully working state on its own (no
   task depends on a *later* task's code to avoid breaking the workflow) — verified by
   each task's own acceptance criteria and verification commands passing independently.

### Documentation and doc-contradiction fix (task 10)

7. Fix `docs/ai/specification-workflow.md:61` so it no longer contradicts the signal
   table: state that ambiguity is resolved by the signal table's own **E** (discovery
   first) rule, not by a blanket "prefer the smaller class."
8. Update `docs/ai/specification-workflow.md`, `AGENTS.md`, `CLAUDE.md` (pointer only),
   `.claude/commands/nevo-ai/*.md`, and `.claude/skills/nevo-ai-spec-workflow/**` to
   describe every mechanism this change adds — inline approval offers, the combined
   approve+start outcome, batch execution, the mechanical task type, context completeness
   checking, `consequential_paths`, the follow-up ledger, and the recovery/resume model —
   so the shared vendor-neutral doc and the Claude-specific commands stay consistent with
   each other, per the existing "thin adapter" convention.
9. Write the recommended ADR (`overview.md` § "ADR impact") capturing the durable
   decisions from D1-D4.

## Constraints

- The post-merge check must stay cheap — no duplicate `dotnet build`/`dotnet test`,
  matching the explicit token-efficiency constraint in `overview.md`.
- Documentation updates in this area must not describe a mechanism that isn't actually
  implemented by an earlier task in this same change — this area is the last one
  implemented specifically so its docs describe real, tested behavior.

## Interfaces and boundaries

Exposes: the post-merge check, the migration notes, the corrected classification-rule
text, the updated docs/commands/skill files, the new ADR.

Consumes: the finished behavior of every other area (this area only documents and
verifies, it does not introduce new runtime mechanisms of its own beyond the post-merge
check).

## Area-specific acceptance criteria

- A test/manual trace proves `finalize`'s post-merge check runs `specs.mjs check`/
  `docs.mjs check` against the post-merge tree and reports (not blocks on) a failure.
- `docs/ai/specification-workflow.md` no longer contains the line-61/signal-table
  contradiction — verified by re-reading both passages together.
- Every `.claude/commands/nevo-ai/*.md` file touched by an earlier task in this change
  has its "Ending" section updated to match the actual new behavior (inline offers,
  batch mode where applicable).

## Dependencies

`batch-execution-and-gating-review` (task 08) and `mechanical-task-type` (task 07) — this
area documents and finalizes behavior that must already exist.

## Out of scope

- Writing the ADR's exact number (assigned at write time, next available after ADR-0005).
- Any new runtime mechanism beyond the post-merge check — this area is otherwise
  documentation, migration notes, and tests.
