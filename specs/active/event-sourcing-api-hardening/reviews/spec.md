---
review-of: spec
change: event-sourcing-api-hardening
generated: 2026-08-11
verdict: ready-for-approval
ready_for_approval: true
implementation_allowed: false
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
spec_fingerprint: 492bcd9e433b617f5de6070c0004ce020f922c8955712412cbf09b5d3551d746
task_fingerprints:
  characterize-event-sourcing-baseline: cadd6a0f99d3ced7addcded3e1fc01a57a4d24615d0dd7ca3325eab63f3a4aaf
  harden-event-store-and-repository-contracts: 6779698847cb764b7372e5b571d99397b1322841520bdde8455cb4a41f6a85b4
  es-command-executor-and-ambiguity-resolution: ad6c90d136e060e40217549420f53d86f0c862d1b9aebd768be590f81293aed3
  explicit-event-sourced-command-handler: e14a25250d27e16f7beaddf764cf6b92120a156fe9f8e29345a7e5b74a0aea2a
  primary-fallback-handler-roles: d401cf8c6f5fc24270ba36a6ca051f69224929b6e4cb07e11a00b2cbb6a39ae4
  event-sourcing-registration-options: d12e3c6fe7a2a79791f242a3fb1f678e9a25ff57722b365d721c5ffa0265889c
  message-level-and-aggregate-authorization: 0e543bbad0912bc23529098ee0e3c430b5772cd315c3648fcdc69eefdcdbda68
  map-query-endpoint-and-get-binding: 28a2251fcefffd0b769b6c0eef17a30b68852a4629cfa2f378a8781ab29999ed
  create-documents-example-project: c45b10572b06c85b3b8429aa0dfa2c9527b70541534b944aab06e2b36563ffb8
  documents-example-es-and-auth-demo: 6651b2800fbbb5e3307795918e436ebc542b53a1ba4de29d1b67b4c9ac447387
  user-facing-event-sourcing-guide: d5d5ffb1a3534e0c0185c34f0715fe66777277c732399d2eb41e5d15c6709084
  internal-event-sourcing-architecture-docs: 8c8b7908d6c393d24e67b617e2a691c3e8252ddddecbc60d30d23ce7faee8e43
---

# Review: event-sourcing-api-hardening

No reliable previous-file baseline is available. Performing a fresh review of the
current specification (`--all` scope, all 12 tasks).

## Verdict

`ready-for-approval` — no unresolved `AUTO_FIX`/`OWNER_DECISION`/`NEEDS_CLARIFICATION`
findings remain, but no task in `change.yaml` carries `status: approved` yet (all 12 are
`draft`), so row 4 of the decision table applies, not row 5.

## Implementation readiness

- May implementation start now? No — `implementation_allowed: false`.
- Are the relevant tasks `approved` in `change.yaml`? No — all 12 tasks are `draft`.
- What has to happen first? Nothing content-wise; the change is ready for the owner to
  run `/nevo-ai:spec-approve` per task.

## Gating and non-gating checks

```
Gating validation: passed
  node tools/specs.mjs validate — 8 changes, no errors
  node tools/docs.mjs validate  — 61 documents, no errors
Non-gating repository check: failed — unrelated to this change
  node tools/specs.mjs check — passed (indexes current)
  node tools/docs.mjs check  — failed: docs/index.generated.md stale
    (git status shows zero docs/** changes anywhere in this change's diff; the
    staleness predates this spec-refine pass and belongs to whichever other
    change/commit last touched docs/ without regenerating. Does not affect this
    review's verdict.)
```

## Findings

No findings.

## Specification readiness criteria (per `references/review-policy.md`)

- **Owner-approval gates**: every gated decision this specification makes (D1-D28) is
  backed by a recorded option analysis in `owner-decisions.md` — question, options
  considered, decision, rationale, consequences. Two entries (D10, D11) are marked
  `Superseded` and kept verbatim for audit trail, never presented as active. Nine of the
  final-pass decisions (D19-D28, minus D19 which is a chronology note) directly answer
  the ten review points raised in `nevo-event-sourcing-final-spec-refinement.md`,
  correctly attributed and cross-referenced from `overview.md`, the affected `areas/`
  files, and the affected `tasks/` files.
- **`depends_on` graph**: acyclic, every reference resolves — confirmed by
  `node tools/specs.mjs validate`. Task 01 was renamed
  (`fix-build-and-characterize-baseline` → `characterize-event-sourcing-baseline`, id +
  filename + every dependent's `depends_on`/`dependency_contracts`) consistently across
  all 21 files that referenced it; a repo-wide grep after the rename found zero stale
  references to the old id.
- **`allowed_paths`/`forbidden_paths`**: present on every task; spot-checked for
  plausibility against each task's actual scope (e.g. task 07's `forbidden_paths` now
  excludes `tests/NEvo.Web.Authorization.Tests/**` — the test-target correction this
  refinement made — and its `allowed_paths` adds the new
  `tests/NEvo.Messaging.Authorization.Tests/**`).
- **Acceptance criteria testability**: every criterion across all 12 tasks carries an
  `automated`/`inspection`/`manual` (D12-authorized) qualifier; none are aspirational
  prose without a check. The two testing-strategy corrections this refinement made
  (task 08 dropping the `WebApplicationFactory` requirement per D27, task 10 dropping
  the concurrent-write race per D28) replaced previously *untestable-as-specified*
  criteria (they required infrastructure/timing this repo doesn't have) with criteria
  that are actually checkable today.
- **No open owner decision blocks the next task**: none found. Every open question this
  refinement pass raised was closed by a recorded decision (D19-D28) rather than left
  open.
- **Documentation impact**: identified and owned by dedicated tasks 11 (user-facing)
  and 12 (internal), both listing concrete required sections/topics and explicit
  acceptance criteria (including "does not document an unimplemented capability as
  available," directly enforcing D20-D22/D16's scope limits).
- **Option analysis for gated decisions**: present for every D-number — confirmed by
  direct inspection of `owner-decisions.md`, not assumed from a heading's presence.
- **Semantic-reference completeness**: read every task's goal, constraints, acceptance
  criteria, and context rules against its declared `semantic_references.decisions`.
  Two gaps found during this review were fixed inline before this report was written
  (not left as `AUTO_FIX` findings, since fixing a spec's own cross-reference gap is
  exactly the kind of mechanical correction this review is positioned to make without a
  separate round-trip): task 10 (`documents-example-es-and-auth-demo`) demonstrates a
  Level 2 handler but didn't cite D24 (the `Option<TAggregate>` contract it inherits
  from task 04) — added. No other missing or stale reference found; several tasks
  correctly rely on a dependency task's decisions via `dependency_contracts`'s
  recursive fingerprint inclusion rather than duplicating the citation (e.g. task 03
  doesn't re-cite D6, since it consumes D6 through its `harden-event-store-and-
  repository-contracts` dependency contract).

## Consistency sweep (this refinement's own scope, per its request)

Verified, by direct repo-wide search after every edit, that no active artifact:

- claims the branch does not build (all such text removed from `overview.md`/`Problem`/
  `Proposed architecture`/task 01; the historical fact lives only in `owner-decisions.md`
  D19 and D9's dated evidence, both correctly framed as history, not current state),
- describes `AggregateConcurrencyException` as thrown (every remaining "throw"/"throws"
  occurrence is inside a struck-through, explicitly-audit-trail quote in
  `owner-decisions.md` D7/D13's own correction entries),
- proposes a persisted Event Envelope, minimal or otherwise, or leaves correlation/
  causation-in-the-envelope as an open implementation choice (D20-D22 close it; the only
  remaining "envelope" mentions are the corrected areas'/tasks' explicit "no envelope"
  statements and D6/D20's own audit-trail quotes of the removed clause),
- still references the deleted `separate-core-and-integration-folders` task or the
  renamed `characterization-and-reorganization` area filename outside `owner-decisions.md`'s own D10/D11/D15/D16 historical entries,
- requires new `WebApplicationFactory`-based or other ASP.NET integration-test
  infrastructure (D27) outside explicit "do not do this" instructions,
- says the ES executor invokes normal message-level/handler-level permission checks
  (every remaining mention is corrected to describe the executor invoking only the one
  aggregate-aware hook, per D25),
- leaves the Level 2 handler's or the aggregate-aware hook's current-state parameter
  ambiguous between "always present," `null`, and `Option<TAggregate>` (D24 is applied
  consistently in tasks 03, 04, 07, and both documentation tasks).

## Architecture and documentation

`docs/development/package-boundaries.md` is now declared context for task 07
specifically because this refinement's D26 makes a package-boundary claim
(`NEvo.Ddd.EventSourcing` gains no dependency on `NEvo.Messaging.Authorization`) that a
future implementer/reviewer should be able to verify against that document directly.
`docs/development/event-sourcing.md` and `docs/development/messaging-pipeline.md` are
correctly identified as needing updates (task 12) rather than left implicitly stale.
No architecture-doc/ADR conflict found that this specification doesn't already name and
resolve (D26 explicitly cross-references `package-boundaries.md`'s own "not on each
other" rule rather than contradicting it).
