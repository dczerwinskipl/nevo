---
review-of: spec
change: event-sourcing-api-hardening
generated: 2026-08-13
scope: --tasks 13-14
verdict: changes-required
ready_for_approval: false
implementation_allowed: false
unresolved_required_fixes: 1
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
spec_fingerprint: 40e6c834e5ff007fbdceedcaaff6e5ff6b144791972924566076491cbbedb59c
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
  internal-event-sourcing-architecture-docs: 6bc9a3df71cec8663e3b3dac761f40dea5beb25373563ca635afec27a0af1a29
  aggregate-decision-method-parameter-injection: b855c8ac8eca5e8cef056071e6a98a57e6901c9a2ce23186d4398cf8f721140e
  current-user-capability-and-documents-integration: cb6cc68b652038db4a7ec3173c3d1ef04c3297ca54269adde933078439c030ae
  typed-authorization-failure-and-403-mapping: 8f2029e82e250fc0a496fefe7a21a58ba11a4540aec59165d4030e44dde75f46
  query-either-ergonomics-cleanup: 4a2fbe139e58a226699e9613ccb07006b88152a3d0ab715619ae00a06f26e5e1
---

# Review: event-sourcing-api-hardening (scoped: tasks 13-14)

Baseline: the previous `reviews/spec.md` (generated 2026-08-12, commit `8f60cfc`)
reported `ready-for-approval`. This run is a targeted correction pass, prompted by owner
review, on tasks 13/14's required-contextual-parameter invariant: `ICurrentUser<TId,
TUser>` could resolve successfully as a *type* (DI construction succeeds) and only fail
when its `User` getter was read — by which point `AggregateDeciderExtractor.Invoke` had
already entered the decision method's body (`methodInfo.Invoke`). That satisfies D42's
"resolution/activation failed for any reason" wording but not its intent ("the decision
method is not invoked at all").

## What changed this pass

- `owner-decisions.md`: appended **D44**, sharpening D42 — a required contextual
  capability must validate its own availability during resolution/activation (for a
  DI-backed capability, during construction), not from a value read after the decision
  method has started executing.
- `areas/decision-method-parameter-injection.md`: added the D44 invariant to
  Requirements/Constraints and area-acceptance-criterion 5.
- `areas/current-user-capability.md`: narrowed the "exact mechanism is an implementation
  choice" wording — the check must be construction-time, not from the `User` getter;
  updated area-acceptance-criterion 2 accordingly.
- `tasks/13-*.md`: added a "Corrected by D44" note (same placement pattern as the
  existing D38 note), tightened the "Fail clearly" constraint and acceptance criterion 5,
  added D44 to `semantic_references.decisions`.
- `tasks/14-*.md`: added a "Corrected by D44" note, tightened the construction-time-check
  requirement and acceptance criteria 1/2, added D44 to `semantic_references.decisions`.

Code/tests are not yet updated — that is this pass's next step (task-review will produce
current evidence once the implementation fix lands).

## Gating and non-gating checks

```
Gating validation: passed
  node tools/specs.mjs validate — 8 changes, no errors
Non-gating repository check:
  node tools/specs.mjs check — stale: specs/index.generated.json (expected, unrelated changes)
  node tools/docs.mjs check  — stale: docs/index.generated.md (expected, unrelated changes)
```

## Semantic-reference completeness (D26, D29)

Both in-scope tasks declare `D44` in `semantic_references.decisions` and D44 exists in
`owner-decisions.md` with matching content — no missing load-bearing reference for either
task.

## Findings

| ID | Category | Predicate | Finding | Resolution |
|---|---|---|---|---|
| F1 | AUTO_FIX | Tasks 13/14's implementation (`CurrentUser<TId,TUser>`, its tests, and `AggregateDeciderParameterInjectionTests`'s `ILazyThrowingDependency` fixture) matches the just-corrected D44 invariant | Not yet true — `CurrentUser<TId,TUser>.User` still throws lazily from the getter; `AggregateDeciderParameterInjectionTests.DecideAsync_DependencyValueThrowsWhenRead_FailsWithoutProducingAnEvent` still asserts the now-rejected behavior as correct | Implementation fix (this pass, next step): make `CurrentUser<TId,TUser>` validate during construction; remove the `ILazyThrowingDependency`-based test; add a regression test proving invocation count stays 0 |

No `OWNER_DECISION`/`NEEDS_CLARIFICATION` findings — the correction was fully specified
by the owner's own instructions for this pass, per D44's rationale.

## Scoped-run out-of-scope baseline check (step 7a)

`internal-event-sourcing-architecture-docs` (task 12, order 12, first task not
grandfathered by D32) has a fingerprint drift: prior `8c5701ddcc61...` → current
`6bc9a3df71ce...`. This is expected and traced directly: task 12 depends on tasks 13/14
as `dependency_contracts`, and `computeTaskFingerprint` folds `semantic_references`
recursively — editing `owner-decisions.md` (D44) and the two area files task 12 will
eventually need to document changes its fingerprint even though `tasks/12-*.md` itself
is untouched. Every other out-of-scope task from task 12 onward (`typed-authorization-
failure-and-403-mapping`, `query-either-ergonomics-cleanup`) has an unchanged
fingerprint, matching the prior baseline exactly.

Per the scoped-verdict guard, this means `scopedReviewBaselineValid` reports `valid:
false`, naming `internal-event-sourcing-architecture-docs` as potentially impacted, not
re-reviewed in this scope — rows 4/5 of the decision table are unavailable for a
whole-change verdict regardless of tasks 13/14's own outcome. This is not a blocker for
this pass: tasks 11/12 are explicitly out of scope here (owner instruction: "do not start
tasks 11 or 12 in this pass") and remain `status: draft`/unstarted; task 12 will pick up
the D44-corrected area text whenever it actually starts.

## Verdict

`changes-required` (F1: implementation not yet updated to match the corrected spec).
`ready_for_approval: false`, `implementation_allowed: false`. Tasks 13/14 are already
past the `draft`→`approved` CLI gate (`change.yaml` status: `implemented`) — `node
tools/specs.mjs approve` only transitions `draft`→`approved` and does not apply here;
"reapproval" for this pass takes the form of fresh `task-review` evidence once the
implementation fix lands (next step), not a CLI `approve` call.

## Architecture and documentation

No new architecture-doc/ADR conflict. `IAggregateMethodDecider`/`IDecider`, D43's
generic-user design, the parameter-injection architecture, tasks 15/16, and the Documents
authorization model are all unaffected by D44 — confirmed by inspection of every edited
file above; none of them touch those surfaces.
