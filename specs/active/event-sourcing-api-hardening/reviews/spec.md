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
spec_fingerprint: eabd92dd62d09b079d310bc6973ba59a4bad1a81618d81f3b362bc2b2e40dc5e
task_fingerprints:
  characterize-event-sourcing-baseline: cadd6a0f99d3ced7addcded3e1fc01a57a4d24615d0dd7ca3325eab63f3a4aaf
  harden-event-store-and-repository-contracts: f374779210d55a6d864f9c09423faa85ecb46535e4400c7bde5e54c37cae8b7b
  es-command-executor-and-ambiguity-resolution: d954fe7b2fc230a6c80e80ef03af1653f16e19c238053f6bfa2d22df1bfbefd3
  explicit-event-sourced-command-handler: a9a6c512c21e06de515801e69315462082057f7ce188a0fa4be73964a1c4c3f1
  primary-fallback-handler-roles: 978adff57fa22852716e883510fdfc534c64a47619fd5c861fbff40eaa0ec0dc
  event-sourcing-registration-options: 257ab48f85d931540770bcaa2eb2735469e46c53e50cc7e3291218812f078f04
  message-level-and-aggregate-authorization: 93c9a5f7378024ebcd669144df0fd2eaac714c65828e37d3a16f090683750b44
  map-query-endpoint-and-get-binding: 28a2251fcefffd0b769b6c0eef17a30b68852a4629cfa2f378a8781ab29999ed
  create-documents-example-project: 772f66cd20eadc0a82c0dc3cbaa9ba07e05f4ab961930d8a58050e17adcc683f
  documents-example-es-and-auth-demo: ee84dfa7effa298d31c06274f812f6389cf68a0c9ecc39bea2f70777b0ec0b12
  user-facing-event-sourcing-guide: d1ba03687266f934b735918aadf929fe53c31f0a9f409d4eed60ffa084c9ea30
  internal-event-sourcing-architecture-docs: 336c0d9585296218c9fabbbdcf10f893d34bac92fb5c48eefbe00c7fcbc95542
---

# Review: event-sourcing-api-hardening

Baseline: the previous `reviews/spec.md` (generated 2026-08-11, end of the prior
"final narrow refinement" pass) reported `ready-for-approval` with zero findings. That
file is the baseline for this re-review — not git status or conversation memory. Every
file below was re-read fresh, in full, for this run; nothing is carried forward from
the baseline without a direct current-content check.

## Verdict

`ready-for-approval` — no unresolved `AUTO_FIX`/`OWNER_DECISION`/`NEEDS_CLARIFICATION`
findings remain, but no task in `change.yaml` carries `status: approved` (all 12 are
still `draft`), so row 4 of the decision table applies, not row 5.

## Implementation readiness

- May implementation start now? No — `implementation_allowed: false`.
- Are the relevant tasks `approved` in `change.yaml`? No — all 12 tasks are `draft`
  (confirmed by direct read of `change.yaml`, not assumed from the prior review).
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
    (git status shows zero docs/** changes anywhere in this change's diff — this
    pass touched only specs/active/event-sourcing-api-hardening/**. The staleness
    predates this refinement and belongs to whichever other change/commit last
    touched docs/ without regenerating. Does not affect this review's verdict —
    same conclusion the prior review reached, re-verified against current git
    status rather than assumed.)
```

## Findings

No findings.

Two baseline-adjacent items were caught and corrected as part of finishing this
refinement pass (before this review began, not during it — review stays read-only):
`overview.md`'s "Refined twice"/"two refinement passes"/"two spec-refine... passes"
wording was stale once a third refinement pass (the reference-pattern comparison that
introduced D29-D31) landed. Corrected to "Refined three times"/"three refinement
passes" in three locations before fingerprints were computed for this review, so the
fingerprints above already reflect the corrected text — not reported as an `AUTO_FIX`
finding here because it was fixed before, not during, this review's evaluation.

## Specification readiness criteria (per `references/review-policy.md`)

- **Owner-approval gates**: every gated decision this specification makes (D1-D31) is
  backed by a recorded option analysis in `owner-decisions.md` — question, options
  considered, decision, rationale, consequences. Two entries (D10, D11) remain marked
  `Superseded`, kept verbatim for audit trail. The three new entries from this pass
  (D29, D30, D31) each carry a full option analysis with at least two genuine
  alternatives (D29: leave as-is / explicit two-case state / go further and add `Any`;
  D30: leave ambiguous / state explicit separation / build a full strategy hierarchy;
  D31: leave unstated / state a single-write-target boundary / design multi-aggregate
  writes now) and a recorded owner rationale, not a single proposed approach.
- **`depends_on` graph**: acyclic, every reference resolves — confirmed by
  `node tools/specs.mjs validate`. No task was renamed or restructured in this pass.
- **`allowed_paths`/`forbidden_paths`**: unchanged by this pass — spot-checked that
  tasks 02, 03, 04, 11, 12 (the tasks this pass edited) still declare exactly the same
  path scopes as before; none needed to change, since D29-D31 are contract/behavior
  guardrails within each task's existing scope, not new files or directories.
- **Acceptance criteria testability**: every new acceptance criterion added this pass
  carries an `automated`/`inspection` qualifier (task 02's new criteria 7-12; task 03's
  new criteria 9-10; task 04's new criteria 7-8; the area files' new criteria); none are
  aspirational prose without a check.
- **No open owner decision blocks the next task**: none found. D29, D30, D31 are all
  closed, recorded decisions — not left open for a future task to resolve.
- **Documentation impact**: task 11 (user-facing) and task 12 (internal) were both
  updated this pass with concrete new required content (the create-vs-update
  stream-state mental model and explicit Level 1/2/3 "when to use each" guidance in
  task 11; the `NoStream`/`Exact(version)` semantics and the executor/convention
  separation, framed as a compatibility property rather than an announced feature, in
  task 12) and corresponding new acceptance criteria — not left implicit.
- **Option analysis for gated decisions**: present for D29, D30, and D31 — confirmed by
  direct inspection of `owner-decisions.md`, not assumed from a heading's presence.
- **Semantic-reference completeness**: read every task's goal, constraints, acceptance
  criteria, and context rules against its declared `semantic_references.decisions`,
  focused on the five tasks this pass touched (02, 03, 04, 11, 12) plus a full-spec
  `grep` for stray `D29`/`D30`/`D31` mentions outside those five plus `overview.md` and
  the two directly affected area files. Result: every file that mentions D29/D30/D31 is
  a file this pass intentionally edited and whose `semantic_references.decisions` was
  updated to include the relevant decision(s) — no missing, stale, or unnecessary
  reference found. Tasks 05-10 do not reference D29-D31 in their own prose and
  correctly do not declare them — their task-level fingerprints still shifted (expected:
  `computeTaskFingerprint` recursively includes each `dependency_contracts` entry's own
  fingerprint, and tasks 05-10 depend on 02/03/04, which changed).

## Consistency sweep (this pass's own scope, per its request)

Verified, by direct repo-wide search after every edit:

- No new envelope, correlation/causation, or storage-metadata type was introduced while
  adding the `NoStream`/`Exact(version)` expected-stream-state concept — D29 explicitly
  keeps stream version out-of-band, as an enum-like value type, not a new persisted
  field, and D20-D22's three-layer distinction from the prior pass is undisturbed
  (re-checked: still exactly three concerns named, still no `EventEnvelope<T>`
  anywhere in the diff).
- No `Any`/`IgnoreVersion`/unconditional-append mode and no automatic retry/rebase
  logic exists anywhere in the current diff — checked `areas/persistence-boundary.md`,
  `areas/shared-es-execution-and-explicit-handler.md`, and tasks 02-04's Implementation
  constraints/Out of scope sections directly; each explicitly names and rejects both.
- No `IDecisionStrategy`/`IMutableAggregateStrategy`/`IFunctionalDeciderStrategy`-style
  plugin hierarchy was introduced while separating the executor's lifecycle
  responsibility from the convention's reflection responsibility (D30) — checked that
  every place the separation is described also states this rejection explicitly, not
  merely by omission.
- No multi-aggregate/multi-stream atomic-write capability or saga/process-manager
  design was introduced while stating Level 2's single-write-target boundary (D31) —
  Level 3 and "a future dedicated saga/process-manager/workflow capability" are named as
  where that belongs, never designed here.
- D19-D28 were not reopened: every decision text from D19 through D28 in
  `owner-decisions.md` is byte-for-byte the same as before this pass (only new content
  was appended as D29-D31; no existing entry was edited).
- No dependency on, or integration with, Eventuous/Marten/Wolverine/Equinox was
  introduced — every mention of those frameworks across the spec is explicitly framed
  as "inspiration only, not adopted," and `overview.md`'s Out of scope section names
  this explicitly.
- The prior pass's consistency guarantees (no stale "branch does not build" claims, no
  "thrown" `AggregateConcurrencyException` outside audit-trail quotes, no persisted
  Event Envelope proposal, no stale task-01 filename references, no
  `WebApplicationFactory` requirement, no message-level-permissions-in-executor claim,
  no ambiguous Level 2/aggregate-aware current-state parameter) all still hold —
  re-verified by the same repo-wide search pattern this pass, not assumed unchanged
  from the prior review.

## Architecture and documentation

No new architecture-doc/ADR conflict introduced. This pass's guardrails are framed
consistently everywhere as hardening existing contracts/boundaries (task 02's
`IEventStreamStore`, task 03's shared executor, task 04's Level 2 handler) rather than
new abstractions — matching D17's existing "documented compatibility constraint, not a
new abstraction" precedent from the prior pass. `docs/development/package-boundaries.md`
and `docs/development/event-sourcing.md` remain correctly identified as task 12's own
update targets; neither was touched directly by this pass (correctly deferred to task
12's implementation).

## Reference-pattern framing check (specific to this pass's own request)

Verified that every mention of Eventuous, Marten, Wolverine, or Equinox across the
active specification (`overview.md`, `owner-decisions.md` D29-D31, the two area files,
tasks 02-04/11/12) is explicitly framed as architectural inspiration or a comparison
point — never as a dependency, integration target, or design this specification adopts
wholesale. `overview.md`'s Out of scope section and D29/D30/D31's own rationale text
each state this framing directly, so the distinction is not left to inference from
tone.
