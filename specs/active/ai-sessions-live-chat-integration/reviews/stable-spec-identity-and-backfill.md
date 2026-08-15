---
review-of: task
change: ai-sessions-live-chat-integration
task: stable-spec-identity-and-backfill
generated: 2026-08-15
verdict: pass
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
scope_exceptions:
  - finding: F1
    path: docs/index.generated.json
    reason: >-
      Not in this task's allowed_paths. node --test tools/tests/*.test.mjs (this task's
      own AC6 verification command) failed on a pre-existing, unrelated docs-index
      staleness (docs/index.generated.md/.json/routing.generated.json hadn't been
      regenerated since commit ae07371, predating this task's own diff — nothing in
      docs/ sources changed here). Ran node tools/docs.mjs generate (the canonical,
      deterministic generator — no hand edits) to unblock the required verification
      command.
    decision: accepted
    confirmed_by: owner
    confirmed_at: 2026-08-15
    task_fingerprint: "4a03fba5b98bdd4f40148c18e5bffc8073883967e33a893c8a88422b68390da3"
  - finding: F1
    path: docs/index.generated.md
    reason: Same as docs/index.generated.json above — one mechanical `tools/docs.mjs generate` run.
    decision: accepted
    confirmed_by: owner
    confirmed_at: 2026-08-15
    task_fingerprint: "4a03fba5b98bdd4f40148c18e5bffc8073883967e33a893c8a88422b68390da3"
  - finding: F1
    path: docs/routing.generated.json
    reason: Same as docs/index.generated.json above — one mechanical `tools/docs.mjs generate` run.
    decision: accepted
    confirmed_by: owner
    confirmed_at: 2026-08-15
    task_fingerprint: "4a03fba5b98bdd4f40148c18e5bffc8073883967e33a893c8a88422b68390da3"
---

Re-review (2026-08-15, same day, owner PR review of the spec itself — PR #25/commit
e6496d5). Baseline: this file's prior content (`pass`, task_fingerprint
`fc50f575d3...`). The owner's spec review (point 4) flagged that the validator's
"legacy missing spec_id is always tolerated" behavior gives CI no way to ever close the
migration window — a hand-authored manifest that skips spec-create's guidance would pass
`validate` forever, indistinguishable from a pre-migration manifest. Applied: `overview.md`
(C2, Compatibility and migration), `areas/stable-spec-identity.md`, and this task's own
AC1/implementation-constraints were reworded to require `spec_id` in `validate`/`check`
once backfill has run (reader-side tolerance in `loadChange`/`buildContextPacket` is
unaffected and stays permanent). `tools/specs/validation.mjs`'s `validateSpecId` was
updated to match: a missing `spec_id` is now a validation error naming the manifest's
path and the fix, not silently accepted. `tools/tests/spec-identity.test.mjs` was updated
to assert the new behavior. Self-check re-run and passed; task fingerprint changed to
`4a03fba5...` (task file text changed) — scope-exception entries above updated to match.

# Review: ai-sessions-live-chat-integration/stable-spec-identity-and-backfill

- [x] Acceptance criteria: 6/6
- [x] Scope: resolved
  - 3 owner-approved exceptions recorded (F1 — `docs/index.generated.json`,
    `docs/index.generated.md`, `docs/routing.generated.json`; outside this task's
    `allowed_paths`, mechanical `tools/docs.mjs generate` output only)
- [x] Findings: none unresolved

## Verification

- `node --test tools/tests/spec-identity.test.mjs` — passed (13/13)
- `node --test tools/tests/*.test.mjs` — passed (872/872)
- `node tools/specs.mjs check` — passed
- `node tools/docs.mjs check` — passed
- `node tools/specs.mjs self-check ai-sessions-live-chat-integration stable-spec-identity-and-backfill` — passed
