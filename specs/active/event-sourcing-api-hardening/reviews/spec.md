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

Baseline: the previous `reviews/spec.md` (generated 2026-08-12, end of the task-13/15
correction pass, commit `8f60cfc`) reported `ready-for-approval` with zero findings and
claimed a completed "consistency sweep." **That claim was wrong** — the sweep checked
`overview.md` and the two corrected task files (`tasks/13-*.md`, `tasks/15-*.md`) but did
not check those tasks' own **area** files for the same defects, even though both area
files declare the same corrected content as their tasks and are read as required context
by them. This run is a second, narrower correction pass fixing exactly that gap. Every
file named below was re-read in full, fresh, including a direct `git show` comparison
against the pre-correction commit to distinguish "already fixed, reviewer looking at a
stale view" from "genuinely still broken."

## What was checked and what was found

Two claims were reported against the current specification:

1. **`areas/decision-method-parameter-injection.md` still describes the superseded
   design (pre-D38).** Checked directly: `git show 2a37154:...` (the commit *before* the
   task-13/15 correction) contains the exact quoted stale text
   ("not yet compatibility-sensitive" applied to `IDecider`/`IAggregateMethodDecider`;
   "the executor may still need to make whatever per-invocation context ... reachable to
   `AggregateDecider`"); the current file (post `8f60cfc`) contains neither string
   (`grep` returns zero matches) and instead has the corrected "Corrected by D38" passage,
   the executor-needs-no-new-dependency constraint, both static/instance acceptance
   criteria (criterion 3), and the supported-use-contract section with its own criterion
   (criterion 10). **This claim does not hold against the current commit — it was already
   fixed by the prior pass.** (Plausible explanation: a review generated against, or
   cached from, the commit before `8f60cfc`.)
2. **`areas/typed-authorization-failures.md` still has the pre-D40 acceptance criteria.**
   Checked directly: the file's "Area-specific acceptance criteria" section still tagged
   `ToHttpResult`'s 403/500/200 mapping `(test)` — the exact contradiction D40 fixed in
   `tasks/15-*.md` (a private method in a package with no test project cannot have an
   automated test). **This claim was correct.** The prior pass corrected the task file but
   never propagated the same fix to its own area file, despite the review report's
   "consistency sweep" section claiming the sweep was complete. Fixed in this pass (see
   below).

## Verdict

`ready-for-approval` — zero unresolved findings after the fix below. Tasks 11-16 remain
`status: draft`, so `implementation_allowed` is `false`.

## Fix applied this pass

`areas/typed-authorization-failures.md`'s "Area-specific acceptance criteria" rewritten
to match `tasks/15-*.md`'s own corrected criteria exactly: criterion 1 (typed-failure
behavior) stays `(test)`, scoped to `tests/NEvo.Messaging.Authorization.Tests` explicitly;
criteria 2-5 (200/401/403/500) are `(manual, Documents walkthrough)`; criterion 6
(no new `ProjectReference`) stays `(inspection)`; criterion 7 requires the walkthrough to
document all four HTTP cases, not only 403. A note was added stating why (no
`NEvo.Messaging.Web` test project exists, by this area's own decision).

Task fingerprints are unaffected by this fix: `computeTaskFingerprint` hashes a task's
own frontmatter `context` block (the declared list of required/optional paths) together
with `semantic_references`' resolved decision/constraint text, not the byte content of
files that list *reaches* — an area file is `context.required` input, not a
`semantic_references` entry, so editing its content does not change any task's
fingerprint (verified directly against `tools/specs/service.mjs`'s
`computeTaskFingerprint`, not assumed). Both `spec_fingerprint` and every
`task_fingerprints` entry are unchanged from the prior review and remain accurate.

## Gating and non-gating checks

```
Gating validation: passed
  node tools/specs.mjs validate — 8 changes, no errors
Non-gating repository check:
  node tools/specs.mjs check — stale: specs/index.generated.json (expected)
  node tools/docs.mjs check  — stale: docs/index.generated.md (expected)
```

## Findings

No findings remaining.

One finding was found and resolved in this pass:

| ID | Category | Predicate | Finding | Resolution |
|---|---|---|---|---|
| F1 | AUTO_FIX | `areas/typed-authorization-failures.md`'s acceptance criteria match `tasks/15-*.md`'s corrected (D40) criteria | Area file still tagged the 403/500/200 `ToHttpResult` mapping `(test)`, reproducing the exact contradiction D40 fixed at the task level — an automated test cannot exist for a private method in a package with no test project | Rewritten to match the task file exactly: typed-failure behavior `(test)`, HTTP behavior `(manual, Documents walkthrough)`, project references `(inspection)` |

## Corrected consistency sweep (this pass, done properly this time)

Every area file belonging to a task touched by the task-13/15 correction was checked
directly, not assumed from its task's own correctness:

- `areas/decision-method-parameter-injection.md` (task 13's area) — re-read in full;
  confirmed synchronized with the corrected task: `IAggregateMethodDecider`/`IDecider`
  contract preservation stated identically (D38), executor needs no new
  dependency/plumbing stated identically, both static-creation and instance-existing-
  state paths required as separate acceptance criteria, supported-use contract (D39)
  present with its own criterion. No remaining stale text (`grep` for
  "compatibility-sensitive"/"make whatever" returns nothing).
- `areas/typed-authorization-failures.md` (task 15's area) — the gap found and fixed
  above.
- `areas/current-user-capability.md` (task 14's area, task 14 itself untouched by the
  correction pass) — checked for any accidental staleness; none found (`grep` for
  `IAggregateMethodDecider`/`AggregateDecideDelegate`/"compatibility-sensitive" returns
  nothing — task 14 never referenced that machinery).
- `areas/query-either-ergonomics.md` (task 16's area, untouched) — checked; no relevant
  references, confirmed unaffected as expected.
- `overview.md` — re-checked for any remaining `(test)`-tagged `ToHttpResult` mention
  outside the already-corrected AC section; the three remaining mentions are narrative
  context (architecture description), not acceptance-criteria text, and do not
  contradict D40.
- `tasks/13-*.md`/`tasks/15-*.md` themselves — re-read in full; both remain internally
  consistent with their own area files after the fix above.

This is the sweep the previous review's "Consistency sweep" section claimed to have
already performed. It had not, in fact, checked area files at all — only `overview.md`
and the two task files. That omission is the root cause of this round.

## Architecture and documentation

No new architecture-doc/ADR conflict. No task's scope changed — this pass corrected one
area file's acceptance criteria to match its own task, nothing else.
