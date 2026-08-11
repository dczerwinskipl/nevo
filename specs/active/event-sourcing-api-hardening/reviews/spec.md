---
review-of: spec
change: event-sourcing-api-hardening
generated: 2026-08-11
verdict: approved-for-implementation
ready_for_approval: true
implementation_allowed: true
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
spec_fingerprint: fedc4da031f7f9a40b421fdfd022de9730da3cbeab97f2477a9dd388956bff48
task_fingerprints:
  characterize-event-sourcing-baseline: cadd6a0f99d3ced7addcded3e1fc01a57a4d24615d0dd7ca3325eab63f3a4aaf
  harden-event-store-and-repository-contracts: f374779210d55a6d864f9c09423faa85ecb46535e4400c7bde5e54c37cae8b7b
  es-command-executor-and-ambiguity-resolution: d954fe7b2fc230a6c80e80ef03af1653f16e19c238053f6bfa2d22df1bfbefd3
  explicit-event-sourced-command-handler: c2bb7a58f177719c16e0ed18d11421defd394cb802f68c45ac4e3bd18ae95e66
  primary-fallback-handler-roles: 18941bf853c5d0b3c73a96ad68c61bfce41f9c80d93ed07ca0c22dad98d39633
  event-sourcing-registration-options: 5b307997529d40ebb7235355ba06a371e3a7947cc45bdd9d60d4ac908f58aa61
  message-level-and-aggregate-authorization: b3d4d3aad82df3ca637a79eba7283033e4cc6cb652e3f63c25dd11c08259146c
  map-query-endpoint-and-get-binding: 28a2251fcefffd0b769b6c0eef17a30b68852a4629cfa2f378a8781ab29999ed
  create-documents-example-project: 772f66cd20eadc0a82c0dc3cbaa9ba07e05f4ab961930d8a58050e17adcc683f
  documents-example-es-and-auth-demo: 97dc8a72af5d3b8f47be2761bfeac40a49009380b584e40c9e7275b15d0c5f61
  user-facing-event-sourcing-guide: add23b940cd3c5e089c9e3428b9b98d8d0f4d3dde683f01ec3345401c3aad7a6
  internal-event-sourcing-architecture-docs: 98b4e65524129218737784c67178441169e4e1c8935f1927e9aa2e8d5a0548e7
---

# Review: event-sourcing-api-hardening

Baseline: the previous `reviews/spec.md` (generated 2026-08-11, end of the "final
narrow refinement" pass, D29-D31) reported `ready-for-approval` with zero findings, at
a time when all 12 tasks were still `draft`. Since then, tasks 01-05 were implemented
and tasks 06-12 were approved (confirmed by direct read of `change.yaml`, not assumed
from that file). This run is a fresh review following a narrow, owner-directed
post-implementation correction (D32): task 05's landed `HandlerRole?` nullable/opt-in
compatibility shape is replaced with a non-nullable `HandlerRole` defaulting to
`Primary`, and D4's accepted-breaking-change framing for `AddEventSourcing`'s signature
is narrowed so the existing `params Type[]` overload stays compatible. Every file below
was re-read fresh, in full, for this run.

## Verdict

`approved-for-implementation` — no unresolved `AUTO_FIX`/`OWNER_DECISION`/
`NEEDS_CLARIFICATION` findings remain, and this pass's one not-yet-implemented relevant
task (`event-sourcing-registration-options`, task 06) already carries `status: approved`
in `change.yaml` (row 5 of the decision table). `primary-fallback-handler-roles` (task
05) is already `status: implemented` — its D32 correction is a task-level code/test
correction against the now-refined spec, handled by the normal
task-review/apply-review flow, not by this spec-level approval gate.

## Implementation readiness

- May implementation start now? Yes — `implementation_allowed: true` for task 06 (still
  unimplemented, already approved, spec now refined and consistent). The owner has
  directed that task 06 not actually be implemented in this pass — it stays at
  `approved`, ready for its normal implementation step later.
- Are the relevant tasks `approved` in `change.yaml`? Task 06: yes (`approved`,
  unchanged by this review). Task 05: already past this gate (`implemented`).
- What has to happen first? Nothing content-wise for task 06. For task 05, the
  already-landed code/tests are corrected to match the refined spec (separate,
  task-level step — not this command's scope).

## Gating and non-gating checks

```
Gating validation: passed
  node tools/specs.mjs validate — 8 changes, no errors
  node tools/docs.mjs validate  — 61 documents, no errors
Non-gating repository check:
  node tools/specs.mjs check — passed (indexes regenerated as part of this pass)
  node tools/docs.mjs check  — failed: docs/index.generated.md stale
    (git status shows zero docs/** changes in this pass's diff — this pass touched
    only specs/active/event-sourcing-api-hardening/**. The staleness predates this
    pass and belongs to whichever other change/commit last touched docs/ without
    regenerating. Does not affect this review's verdict.)
```

## Findings

No findings.

## Specification readiness criteria (per `references/review-policy.md`)

- **Owner-approval gate (D32)**: backed by a full option analysis in
  `owner-decisions.md` — question, two genuine options considered for `HandlerRole`
  (keep the landed nullable/opt-in shape vs. non-nullable `Primary`-default) and two for
  `AddEventSourcing` (accept the breaking signature per D4 vs. a compatible additive
  overload), a recorded owner decision and rationale (quoting the owner's own stated
  principle: "backward compatibility through defaults, not compatibility states"), and
  consequences naming every affected artifact. Not a single proposed approach.
- **`depends_on` graph**: acyclic, every reference resolves — confirmed by
  `node tools/specs.mjs validate`. No task was renamed, added, or restructured; task
  05/06's `depends_on` edges are unchanged.
- **`allowed_paths`/`forbidden_paths`**: unchanged by this pass for tasks 05/06 —
  spot-checked directly; D32 changes implementation shape/constraints within each task's
  existing scope, not new files or directories. `src/NEvo.Messaging/Handling/**` (task
  05) and `src/NEvo.Ddd.EventSourcing/**` (tasks 05/06) already cover every file this
  correction touches.
- **Acceptance criteria testability**: task 05 gained two new criteria (7-8, both
  `automated`) proving the preserved positional constructor and the removed
  redundant-`Primary` assignments; task 06's five acceptance criteria were rewritten
  in place, each still `automated`, to assert the compatible-overload shape instead of
  a breaking-change assertion.
- **No open owner decision blocks the next step**: none found. D32 is a closed, recorded
  decision, not left open for implementation to resolve.
- **Documentation impact**: tasks 11/12 were checked directly (`grep` for
  `CommandHandling`/`Primary`/`Fallback`/`HandlerRole`/nested-options wording) — neither
  currently describes tagged/untagged `HandlerRole` behavior or a nested options
  hierarchy, so per the owner's own instruction ("only if their documentation
  requirements currently describe tagged/untagged behavior or a nested options
  hierarchy") neither needed a change in this pass.
- **Option analysis for the gated decision**: present for D32 — confirmed by direct
  inspection of `owner-decisions.md`, not assumed from a heading's presence.
- **Semantic-reference completeness**: task 05 and task 06 both declare `D32` in
  `semantic_references.decisions` (alongside their pre-existing `D3`/`D4`) — checked
  directly against each task file's frontmatter. A repo-wide search for `D32` outside
  `owner-decisions.md`, `overview.md`, `areas/handler-registration-and-options.md`, and
  tasks 05/06 found no other mention — no missing, stale, or unnecessary reference.
  Tasks 07/10/11/12's task-level fingerprints shifted even though none mentions D32 in
  its own prose — expected: `computeTaskFingerprint` recursively includes each
  `dependency_contracts` entry's own fingerprint, and these tasks depend (directly or
  transitively) on 05/06, which changed. `explicit-event-sourced-command-handler`
  (task 04)'s fingerprint also shifted despite referencing neither D3/D4/D32 nor
  05/06 as a `dependency_contracts` entry — traced to D31's resolved-decision-text
  section boundary moving from end-of-file to the new `## D32` heading inserted
  immediately after it; D31's own text between those boundaries is byte-identical, so
  this is a mechanical artifact of appending D32, not a content change task 04 needs to
  react to.

## Consistency sweep (this pass's own scope)

Verified, by direct repo-wide search after every edit:

- No `HandlerRole?`, `Role: null`, `Unspecified`, or `Legacy` role state survives
  anywhere in `specs/active/event-sourcing-api-hardening/**` outside D32's own text
  describing what was removed (and one verbatim, struck-through-equivalent quote of
  D4's original illustrative option name, kept for audit trail per this document's own
  append-only convention).
- No nested `options.CommandHandling.UseAggregateMethodsAsFallback()`-style hierarchy
  is required by any current (non-historical) spec text — task 06 and the area file now
  both specify a flat `EventSourcingOptions` with one toggle.
- `AddEventSourcing(params Type[])`'s preservation is stated consistently across
  `owner-decisions.md` (D32), `overview.md` ("Compatibility and migration," item 4 of
  "Proposed architecture," the D29-D31/D32 scope-reductions sentence), the area file,
  and task 06 — no remaining text asserts or requires a breaking signature change.
- `MessageHandlerDescription`'s positional-constructor preservation is stated
  consistently across the same set of files, plus task 05.
- D1-D31 were not reopened: every decision text from D1 through D31 in
  `owner-decisions.md` is unchanged from before this pass (only D32 was appended); D4's
  own text is explicitly narrowed by a forward pointer to D32, not edited in place —
  matching this document's own established amendment convention (see D6, D10, D11).
- The prior pass's own consistency guarantees (D19-D31's content, the reference-pattern
  framing, D17/D20-D22/D29-D31's guardrails) were spot-checked and remain intact — this
  pass's edits are additive/narrowing, confined to D3/D4's implementation shape and the
  five files D32 names as affected artifacts.

## Architecture and documentation

No new architecture-doc/ADR conflict introduced. D32 is framed consistently everywhere
as a narrowing of D3's/D4's *implementation shape*, not a reversal of D3's Primary/
Fallback semantics or D4's enabled-by-default toggle behavior — both of which are
explicitly preserved. `docs/development/package-boundaries.md` and
`docs/development/event-sourcing.md` remain task 12's own update targets, untouched by
this pass (task 12's spec text did not need changing, per the scope check above).
