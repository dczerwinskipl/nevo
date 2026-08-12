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
spec_fingerprint: 07cce113c4a2481b5f8d280e75f9c3dbe99d4868889575af91c16ecae595c631
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
  user-facing-event-sourcing-guide: 992b95c99984abc8bd8ec82c0c09f0cc939ba88d0f6eb89b124b1d3955f5c8f2
  internal-event-sourcing-architecture-docs: 8c5701ddcc612618a12db523810bd159d2d23eb9fcd6b848d784800c9fb94042
  aggregate-decision-method-parameter-injection: 3ed02d1586b07566de970b4417fd90c25815093b1bf8c40163084c33efd483d9
  current-user-capability-and-documents-integration: ee331d1f084e4a9cee757eb065522c0dbb6a41ca90a5c3117263314004ab714c
  typed-authorization-failure-and-403-mapping: 8f2029e82e250fc0a496fefe7a21a58ba11a4540aec59165d4030e44dde75f46
  query-either-ergonomics-cleanup: 4a2fbe139e58a226699e9613ccb07006b88152a3d0ab715619ae00a06f26e5e1
---

# Review: event-sourcing-api-hardening

Baseline: the previous `reviews/spec.md` (generated 2026-08-12, end of the refinement
pass that added tasks 13-16) reported `ready-for-approval` with zero findings, after
fixing 5 `AUTO_FIX` semantic-reference gaps. This run reviews a **specification
correction pass** applied to that same refinement, before any implementation started —
owner review of tasks 13-16's own drafted content, not new functional scope. Every file
below was re-read in full, fresh, for this run.

## Verdict

`ready-for-approval` — zero unresolved findings of any kind. Tasks 11-16 remain
`status: draft`, so `implementation_allowed` is `false` (row 4, not row 5).

## Implementation readiness

- May implementation start now? No — `implementation_allowed: false`.
- Are the relevant tasks `approved` in `change.yaml`? No — tasks 11-16 are all `draft`.
- What has to happen first? Owner approval of the corrected tasks, via
  `/nevo-ai:spec-approve`, starting with task 13 (next in dependency order).

## Gating and non-gating checks

```
Gating validation: passed
  node tools/specs.mjs validate — 8 changes, no errors
  node tools/docs.mjs validate  — 61 documents, no errors
Non-gating repository check:
  node tools/specs.mjs check — stale: specs/index.generated.json (expected; this pass
    only edits specs/active/event-sourcing-api-hardening/**)
  node tools/docs.mjs check  — stale: docs/index.generated.md (same cause)
```

## Findings

No findings.

## What this correction pass changed (summary, not findings — each item below was a
real defect in the prior draft, corrected in this same pass)

**Task 13 — `IAggregateMethodDecider` public contract preserved (D38).** The prior draft
allowed `IDecider`/`IAggregateMethodDecider`/`AggregateDecideDelegate`'s shape to change,
reasoning from the package's `experimental` status. Re-reviewed against
`Deciding/IAggregateMethodDecider.cs` (current signature confirmed unchanged) and
`ServiceCollectionExtensions.cs` (confirmed `AggregateDecider`/`AggregateDeciderProvider`
are registered `Singleton`) — the correction requires the exact current signature to
stay unchanged, and specifies a concrete, validated internal mechanism
(`IMessageContextAccessor`/`IMessageContext.ServiceProvider`, both already `Singleton`-
safe by design) that avoids the root-provider/captive-dependency trap a naive singleton-
constructor-injected `IServiceProvider` would otherwise create — with an explicit "stop
and report as an owner decision" escape valve if no clean path is found. Verified: task
13's own text now states this precisely (`tasks/13-...md`, "Public contract — unchanged"
and "Internal mechanism" subsections), and acceptance criterion 1 makes the contract-
preservation requirement directly testable by inspection.

**Task 13 — supported-use contract added (D39).** The mechanism now carries an explicit,
documented (not mechanically enforced) boundary: contextual facts/pure policies are
supported; orchestration/I/O belongs to Level 2 (D1). Verified present in both the task
and its area file, with the good/bad examples from the correction request reproduced
verbatim, and acceptance criterion 11 requires the text to exist.

**Task 13 — both invocation paths covered.** Acceptance criteria 3-4 now require
separate, independent tests for a `static` creation method and an instance method on
existing state — re-verified against `AggregateDeciderExtractor.CreateDecide`'s actual
two branches (`methodInfo.IsStatic` true/false), confirming both are real, currently-
existing code paths this task's mechanism must cover identically, not a hypothetical
distinction.

**Task 15 — acceptance criteria/verification aligned with declared strategy (D40).** The
prior draft's criteria 2-4 were tagged `(test)` for `ToHttpResult`'s 403/500/200
mapping, while the task's own "Implementation constraints" already forbade a new
`NEvo.Messaging.Web` test project — re-confirmed by re-reading
`RoutesExtensions.ToHttpResult` (still `private`) and the task's own constraints
verbatim. All HTTP-transport criteria are now `(manual, Documents walkthrough)`,
explicitly covering all four cases (200/401/403/500), with the missing-document case
named as the acceptable 500 example (matches `DocumentNotFoundException`'s existing,
unchanged behavior). The one remaining `(test)` criterion (the typed-exception behavior
in `NEvo.Messaging.Authorization.Tests`) is achievable within that project, unlike the
criteria it replaces.

**Stale task-10-era narrative corrected (D41).** `overview.md` no longer states the
Documents example "wires Level 1 + Level 2 handling" (it wires Level 1 only; Level 2
remains fully supported and tested via task 04, unaffected). `areas/documents-example-
service.md`'s D33-narrowing bullet no longer overstates that no current-user/context
capability was ever reachable from an explicit handler — it now states the durable
distinction precisely (decision methods couldn't declare contextual dependencies;
explicit handlers could already reach lower-level context, but doing so solely for
identity was unnecessary orchestration once tasks 13-14 exist). Task 10's own file was
checked directly and already used the correct framing — no change needed there.

## Specification readiness criteria (per `references/review-policy.md`)

Addressing the five explicit re-review requirements from this pass's own instructions:

1. **New tasks do not unintentionally change an already-stabilized public contract from
   previously implemented tasks.** Confirmed — task 13 acceptance criterion 1 makes
   `IAggregateMethodDecider`/`IDecider` contract-preservation directly checkable; no
   other task in 13-16 touches any previously-implemented task's public surface (task 14
   adds a new type, task 15 adds a new type plus one new branch in an existing private
   method, task 16 replaces a same-package, single-call-site internal extension).
2. **Each AC has an achievable verification method within the task's declared
   paths/projects.** Confirmed for task 15 (the main defect this pass fixed — see above).
   Re-checked task 13's own 12 criteria against its `allowed_paths`
   (`src/NEvo.Ddd.EventSourcing/**`, `tests/NEvo.Ddd.EventSourcing.Tests/**`) — all
   `(test)`/`(inspection)` criteria target that project or direct file inspection, none
   claims coverage outside it. Task 14/16 unchanged by this pass, previously verified.
3. **All behaviorally distinct existing implementation paths affected by a new
   mechanism are covered.** Confirmed for task 13's static-creation/instance-existing-
   state split (acceptance criteria 3-4, each independently required). No other task in
   13-16 introduces a mechanism with multiple existing invocation paths.
4. **Newly added generic capabilities do not blur documented architecture boundaries.**
   Confirmed — task 13's supported-use contract (D39) explicitly reinforces the Level
   1/Level 2 boundary D1 already established, rather than letting parameter injection
   quietly become a second orchestration mechanism.
5. **Overview/areas/tasks no longer contradict the latest owner decisions.** Confirmed
   for the two locations named in this pass's own instructions (`overview.md`,
   `areas/documents-example-service.md`) — both corrected (D41) and re-read after
   editing to confirm the fix.

Additional checks re-run from the standard readiness criteria:
- **`depends_on` graph**: acyclic, resolves — `node tools/specs.mjs validate` (8
  changes, no errors); `node tools/specs.mjs context <change> <task>` succeeds for
  tasks 13 and 15.
- **Semantic-reference completeness**: re-swept for all of tasks 11-16 after this pass's
  edits — every decision number cited by name in each task's own prose is declared in
  that task's `semantic_references.decisions`, with the same two boundary-only
  exceptions already established as correctly undeclared in the prior review (task 13's
  "D2 unaffected," task 14's "D12 unaffected," both matching task 04's own precedent).
  Task 13 gained `D1`/`D24` (cited for why `IAggregateMethodDecider` is "intentionally
  stabilized" and Level 2's orchestration ownership) during this pass's own edits — found
  and fixed before this report was written, not left as a fresh `AUTO_FIX`.
- **Owner-approval gate**: D38 (`IAggregateMethodDecider` contract preservation), D39
  (supported-use contract), and D40 (test-strategy/AC alignment) are all public-API-shape
  or architecture-boundary decisions with recorded rationale and consequences in
  `owner-decisions.md`, resolved directly from this pass's own explicit, detailed
  instructions (matching the pattern already used for D18/D28/D29/D34-D37 in this same
  specification) — not left as open questions requiring a further round-trip. D41 is a
  narrative correction, not a new design choice.
- **No new task introduced**: confirmed — this pass fits entirely within tasks 13 and 15
  plus their area files and `overview.md`/`owner-decisions.md`; no seventh new task was
  needed.
- **Tasks 01-10, 14, 16 remain intact**: confirmed by `git status` — only
  `overview.md`, `owner-decisions.md`, `areas/decision-method-parameter-injection.md`,
  `areas/documents-example-service.md`, `tasks/11-*.md`, `tasks/12-*.md`,
  `tasks/13-*.md`, and `tasks/15-*.md` changed in this pass.

## Consistency sweep (this pass's own scope)

- `IAggregateMethodDecider`'s current signature was re-read directly
  (`Deciding/IAggregateMethodDecider.cs`) and matches exactly what task 13 now requires
  to remain unchanged.
- `AggregateDecider`/`AggregateDeciderProvider`'s `Singleton` registrations were
  re-confirmed directly in `ServiceCollectionExtensions.cs` — the captive-dependency risk
  task 13 now names is real, not a hypothetical concern.
- `IMessageContextAccessor`'s `Singleton`/`AsyncLocal`-backed registration was
  re-confirmed directly in `NEvo.Messaging/ServiceCollectionExtensions.cs` — the
  validated mechanism task 13 names is available today, not proposed speculatively.
- `RoutesExtensions.ToHttpResult` was re-confirmed `private`, and no
  `tests/NEvo.Messaging.Web.*` project exists — task 15's corrected criteria are
  achievable exactly as now worded.
- `overview.md`'s "Compatibility and migration" section previously listed
  `IDecider`/`IAggregateMethodDecider`/`AggregateDecideDelegate` among this package's
  expected breaking changes for task 13 — this stale entry (a direct consequence of the
  same defect D38 corrects) was found and removed in the same pass, not left
  contradicting the corrected task.

## Architecture and documentation

No new architecture-doc/ADR conflict introduced. Tasks 11-12 (still `draft`) were
updated in this pass to cite the corrected decisions (D38-D39) and carry the
supported-use contract into their own required-documentation sections, so no
future stale-doc risk is introduced by this correction.
