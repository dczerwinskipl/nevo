---
review-of: spec
change: event-sourcing-api-hardening
generated: 2026-08-12
verdict: ready-for-approval
ready_for_approval: true
implementation_allowed: false
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
spec_fingerprint: 79de427cfe73afdb5502d07c8296615e9fd77180be711bc1d69bd6b8ca437119
task_fingerprints:
  characterize-event-sourcing-baseline: cadd6a0f99d3ced7addcded3e1fc01a57a4d24615d0dd7ca3325eab63f3a4aaf
  harden-event-store-and-repository-contracts: f374779210d55a6d864f9c09423faa85ecb46535e4400c7bde5e54c37cae8b7b
  es-command-executor-and-ambiguity-resolution: d954fe7b2fc230a6c80e80ef03af1653f16e19c238053f6bfa2d22df1bfbefd3
  explicit-event-sourced-command-handler: c2bb7a58f177719c16e0ed18d11421defd394cb802f68c45ac4e3bd18ae95e66
  primary-fallback-handler-roles: 25382f55f820946ea8536ec08827d30c574f7a00155c1d6f9a34b9b2668736fa
  event-sourcing-registration-options: 55c44e2782640371bd65a3a2781ecf496354b3efde1fd5adbeeaeaea2a4322c7
  message-level-and-aggregate-authorization: 646b681ffc449299ad3f7170d17c7a9da5e822b7879f19860d6fcaebaa8001b3
  map-query-endpoint-and-get-binding: 28a2251fcefffd0b769b6c0eef17a30b68852a4629cfa2f378a8781ab29999ed
  create-documents-example-project: 772f66cd20eadc0a82c0dc3cbaa9ba07e05f4ab961930d8a58050e17adcc683f
  documents-example-es-and-auth-demo: 624e670433a358089442679c1c36bb541ec21d3c2f864442e3e8f073104b91d0
  user-facing-event-sourcing-guide: 5a6b2afb9b0e9e7ddb0f301dbf533acc64d9960ec58015dc80d24e068db018ec
  internal-event-sourcing-architecture-docs: 8f7894544f9014be2c1a54d2ce7e3ba1cac044b89b0256ab925b98c25c211322
  aggregate-decision-method-parameter-injection: 499791595a4d4dcb3ff0c58c33baf83ba45067f22caf1579892ff22ba8e03559
  current-user-capability-and-documents-integration: ee753bc9cfd77d563a93b3886d22a91c64c61c12ee241f9d3033c61fef003175
  typed-authorization-failure-and-403-mapping: d3232b16ac1c6f36ddd2e8c067ca2cd67d5dc342a8ca408bc1ccd8b25b4b0deb
  query-either-ergonomics-cleanup: edf3de1d5396766df8a13e4a3515195a4c85614485245d2b895a1ba586487f79
---

# Review: event-sourcing-api-hardening

Baseline: the previous `reviews/spec.md` (generated 2026-08-11, end of the D32
post-implementation-correction pass) reported `approved-for-implementation` with zero
findings. Since then: tasks 06-10 were implemented (including task 10's own D33
post-implementation correction), and this refinement pass added four new tasks —
`aggregate-decision-method-parameter-injection` (13),
`current-user-capability-and-documents-integration` (14),
`typed-authorization-failure-and-403-mapping` (15), `query-either-ergonomics-cleanup`
(16) — recording D34-D37, and re-pointed tasks 11-12's `depends_on` at all four,
reverting their status from `approved` back to `draft`. This report reflects a first
review pass of this refinement (5 `AUTO_FIX` findings, `changes-required`) and the
corrections applied immediately after, in the same pass, per those findings' own
mechanical/unambiguous nature — every file below was re-read in full, fresh, after the
corrections, for the verdict this report actually carries.

## Verdict

`ready-for-approval` — zero unresolved findings of any kind. No `OWNER_DECISION`/
`NEEDS_CLARIFICATION`. Tasks 11-16 are `status: draft` in `change.yaml`, so
`implementation_allowed` is `false` per row 4 of the decision table, not row 5.

## Implementation readiness

- May implementation start now? No — `implementation_allowed: false`.
- Are the relevant tasks `approved` in `change.yaml`? No — tasks 11-16 are all
  `status: draft`.
- What has to happen first? Owner approval of the refined tasks (starting with task 13,
  the next in dependency order), via `/nevo-ai:spec-approve`.

## Gating and non-gating checks

```
Gating validation: passed
  node tools/specs.mjs validate — 8 changes, no errors
Non-gating repository check:
  node tools/specs.mjs check — stale: specs/index.generated.json
    (expected — this pass only edits specs/active/event-sourcing-api-hardening/**;
    generation is not part of spec-refine/spec-review's own scope.)
  node tools/docs.mjs check  — stale: docs/index.generated.md
    (same cause; no docs/** content changed by this pass.)
```

`node tools/docs.mjs validate` was not re-run in this exact pass (no `docs/**` file was
touched by either the refinement or the fixes below) — it passed (61 documents, no
errors) earlier in this same session, against the same unchanged `docs/**` tree.

## Findings

No findings.

Five `AUTO_FIX` findings from this review's first pass were resolved before this report
was finalized (mechanical, unambiguous — added missing decision numbers, already cited
by number in each task's own prose, to that task's `semantic_references.decisions`):

- Task 13 was missing `D4`, `D6`, `D13`, `D21`, `D23`, `D24`, `D29`, `D32` (the
  "not-yet-compatibility-sensitive" precedent list, and the `IMessageContext.
  ServiceProvider` access precedent) — now declared alongside `D26`/`D30`/`D34`.
- Task 14 was missing `D4`, `D32` (the DI-registration/`TryAdd*` convention) — now
  declared alongside `D33`/`D34`/`D35`.
- Task 15 was missing `D12`, `D27` (the "no new test project" precedent) — now declared
  alongside `D36`.
- Tasks 11 and 12 were each missing `D13` (`AggregateConcurrencyException` returned via
  `Either`, never thrown) — a pre-existing gap, not introduced by this refinement,
  surfaced by this review's full re-read and fixed in the same pass.

Confirmed, by direct re-check, that no other decision number appears in any of tasks
11-16's own prose without a matching `semantic_references.decisions` entry. Two
citations were checked and correctly left undeclared, matching this change's own
existing precedent (task 04's `D16 unaffected by this task`, never declared): task 13's
"Any change to most-specific-wins state-method resolution (D2)" and task 14's "A
dedicated test project for the Documents example (D12, unaffected by this task)" are
boundary-only ("this decision doesn't apply here") statements, not load-bearing content
the task's own design relies on.

## Specification readiness criteria (per `references/review-policy.md`)

- **Owner-approval gate**: D34 (parameter-injection mechanism/public-API-shape
  precedent), D35 (`ICurrentUser<TId>` package/exposure boundary), D36 (permission-denied
  type/HTTP-mapping — resolved specifically by adding zero new package dependencies), and
  D37 (query-ergonomics helper naming/placement) each carry a real option analysis in
  `owner-decisions.md` — question, ≥2 genuinely different options, a recorded decision
  reflecting the owner's own refinement instructions plus empirical evidence gathered
  during this pass (a repository-wide search confirming `UnauthorizedAccessException` is
  unused elsewhere, and the installed LanguageExt 4.4.8 package's own member surface),
  rationale, and consequences naming every affected artifact.
- **`depends_on` graph**: acyclic, every reference resolves — `node tools/specs.mjs
  validate` (8 changes, no errors) and `node tools/specs.mjs context <change> <task>`
  succeed for all four new tasks.
- **`allowed_paths`/`forbidden_paths`**: present and unambiguous for tasks 13-16;
  overlap between task 14 and task 15 (`src/NEvo.Messaging.Authorization/**`, its tests,
  the Documents example) is real but non-conflicting — disjoint concerns inside a shared
  package, consistent with the larger overlap already accepted across tasks 02-05.
- **Acceptance-criteria testability**: every criterion in tasks 13-16 is tagged
  `(test)`, `(inspection)`, or `(manual)`; none is aspirational.
- **No open owner decision blocks the next step**: none — D34-D37 are closed, recorded.
- **Documentation impact**: tasks 11-12 (still `draft`) now depend on 13-16, and their
  own required-sections/implementation-constraints text was updated in this pass to
  describe parameter injection, `ICurrentUser<TId>`, 401/403/500 semantics, and
  `RequireSome`.
- **No task requires package splitting**: confirmed — tasks 13-16 add types to existing
  packages only; D36 specifically resolves its question by adding zero new
  `ProjectReference` entries in either direction.
- **`IAggregateEvent<TAggregate,TId>` independence from Messaging `Event`**: unaffected
  by tasks 13-16.
- **Explicit Event Sourced handlers remain supported**: unaffected — task 04's area,
  task, and tests are untouched by this pass.
- **Documents no longer needs an artificial explicit approval handler after task 14**:
  confirmed — task 14 forbids reintroducing `ApproveDocumentHandler`/
  `ApproveDocumentDecision`.
- **403 handling is transport mapping of a typed semantic failure, not HTTP logic
  inside Authorization**: confirmed — `PermissionDeniedException` carries no HTTP
  awareness; the mapping decision lives entirely in `NEvo.Messaging.Web`.
- **Roles/permissions not exposed through `ICurrentUser`**: confirmed by task 14's own
  constraints and acceptance criteria.
- **Parameter injection does not expose `IServiceProvider` to aggregate methods**:
  confirmed by task 13's own constraints and acceptance criterion 7.
- **LanguageExt v5 migration out of scope**: confirmed, explicit in task 16 and D37.
- **Tasks 01-10 remain historically intact**: confirmed — no `tasks/01-*.md` through
  `tasks/10-*.md` file was modified by this pass.
- **Semantic-reference completeness**: clean after the fixes above — re-verified by a
  fresh, direct scan of every decision number cited in tasks 11-16's own prose against
  their declared `semantic_references.decisions`, immediately before this report was
  written.

## Consistency sweep (this pass's own scope)

- No task in 13-16 declares an `IServiceProvider` parameter on any aggregate decision
  method, exposes roles/permissions through `ICurrentUser<TId>`, or introduces a new
  `.csproj`/`ProjectReference`.
- `owner-decisions.md` D34-D37 are additive appends after D33 — D1-D33's own text is
  unchanged.
- `overview.md`'s "Proposed architecture," "Areas," "Change-wide acceptance criteria"
  (items 26-30), "Compatibility and migration," and "Affected modules" sections were all
  updated consistently to reference tasks 13-16 and D34-D37.
- Mechanical fingerprint drift: every task's `--task` fingerprint (including tasks
  01-10, already `implemented`) differs from the prior review's recorded value because
  `owner-decisions.md` is in `context.required` for nearly every task and this pass
  appended ~400 lines to it (D34-D37) — the same phenomenon the prior review already
  documented for D32's append. Not a content change to tasks 01-10 themselves.

## Architecture and documentation

No new architecture-doc/ADR conflict introduced. Tasks 11-12 (both `draft`) are the
only architecture-documentation deliverables in this change; their own text already
reflects tasks 13-16.
