---
review-of: spec
change: event-sourcing-api-hardening
generated: 2026-08-13
scope: --all
verdict: ready-for-approval
ready_for_approval: true
implementation_allowed: false
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
spec_fingerprint: 40e6c834e5ff007fbdceedcaaff6e5ff6b144791972924566076491cbbedb59c
task_fingerprints:
  characterize-event-sourcing-baseline: cadd6a0f99d3ced7addcded3e1fc01a57a4d24615d0dd7ca3325eab63f3a4aaf
  harden-event-store-and-repository-contracts: e1f179b2b8ab34f4facce7f20c195baee38a1c0678bb17a8feafdc5e80dd0ef3
  es-command-executor-and-ambiguity-resolution: 917f3ec2cb1dfdc9dc54a24d4241588167984755d339c8271c97978671b99df0
  explicit-event-sourced-command-handler: 6cf9009d5f2f83487701288cae94950ba7b845c72948b310983e1254a3de9333
  primary-fallback-handler-roles: 76ca7f757b7ae3f1bee0fea4b6ada2d5c04c1440d0b409c20f7b7810f03a7ac4
  event-sourcing-registration-options: b854569e5578e8d0eee56eab927fd622d058eb4c6d9a658e189041dbddbe200e
  message-level-and-aggregate-authorization: 6818a7fec21ed571a53bb7a71755a0faa28e558ff31c90520a9d7059f8d75aec
  map-query-endpoint-and-get-binding: 3184bd3797466ab40b1f5e641881ed0830fd96d3501838b643ab60ce24e33c18
  create-documents-example-project: 47ace675846c2b8132bf60a37cd73a3a15e54bcb512ca7e0956949ab08ca2a8b
  documents-example-es-and-auth-demo: b529fa5444b8b45cfd7525d252d3657e77c90d8838f9bfbe0d9ad62fd7ac9d7b
  user-facing-event-sourcing-guide: 063b2f4509f09d8d60c530cd30352df29f969c86b8309c5fb55b41b5c18049b7
  internal-event-sourcing-architecture-docs: dd98ba3b7c3142cd6bca1fa0333f1a3074d054228bd3c791d7396b14ec7ebb6a
  aggregate-decision-method-parameter-injection: 48ae450c65db42e8a344a572292bcf4b19e1eca5d49613eeaebd3aa3e2fd5e58
  current-user-capability-and-documents-integration: 56f144802636fe48d40f78aaed5473b53a07d555384a2c07a2460445e3c4ef57
  typed-authorization-failure-and-403-mapping: 2556aa79368f11cbe0958b8f001588c7b5ce54d8b01f0202298712d0d21d5b4f
  query-either-ergonomics-cleanup: 27f119bbb211f38afc81c11d5b92aa56db0a5c0bb59e1cb74c92061f668e8ff5
---

# Review: event-sourcing-api-hardening

Baseline: the previous `reviews/spec.md` (generated 2026-08-13, scoped `--tasks 13-14`,
`changes-required`, resolved by that pass's implementation follow-up). This run is `--all`
per the owner's request to replace that stale review with one reflecting the current
state — narrow in content (only tasks 11/12 and their directly-related area text changed
since the last full review), full in scope so the scoped-verdict guard doesn't apply.

## Why every task's fingerprint changed even though only four files were edited

Every `task_fingerprints` entry differs from the last full baseline (2026-08-12), not
only tasks 11/12. Traced directly, not assumed: the prior correction pass's commit
(`7d62403`) normalized several spec files — including `owner-decisions.md` — from LF to
CRLF line endings (confirmed: `git show HEAD~2:.../owner-decisions.md` has no CRLF;
the current committed version does, per `file`'s own report). `computeTaskFingerprint`
hashes each cited decision's raw resolved text verbatim (`tools/specs/service.mjs:487-491`),
which is line-ending-sensitive — so every task citing any decision in that file gets a new
fingerprint from the byte-level normalization alone, with no semantic change. Confirmed
directly: `git diff --stat HEAD` against the working tree shows only the four files this
pass actually edited (`tasks/11-*.md`, `tasks/12-*.md`,
`areas/user-facing-documentation.md`, `areas/internal-documentation.md`) — tasks 01-10 and
13-16 have zero diff against their already-implemented, already-reviewed revision. This is
a pre-existing tooling fragility (fingerprint hashing not normalizing line endings), noted
here for the record — out of scope to fix in this narrow pass.

## What was checked and what was found

**Tests (item 1, prior conversation turn).** `tests/NEvo.Ddd.EventSourcing.Tests/Deciding/
AggregateDeciderParameterInjectionTests.cs`, `.../Fixtures/ParameterInjectingAggregate.cs`,
and `tests/NEvo.Messaging.Authorization.Tests/CurrentUserTests.cs` no longer reference
"task 13" or "D44" — `grep` for both patterns across `tests/` returns nothing. The removed
implementation-history comments were replaced with durable technical wording (what the
test proves and why) where a comment remained useful, or removed outright where the
comment's only content was the historical reference itself.

**Tasks 11/12 corrected (items 2-3).** Both task files, and their two directly-related
area files (`areas/user-facing-documentation.md`, `areas/internal-documentation.md`), no
longer describe `ICurrentUser<TId>`/`UserContext<TId>` (missing the `TUser` generic
parameter) or `User<TId> User` (the pre-D43/pre-D42 shape) — `grep` for both patterns
across all four files returns nothing. All four now state the actual current contract
(`ICurrentUser<TId, TUser> where TUser : User<TId>`, `TUser User { get; }`,
`UserContext<TId, TUser>`) and the D44 invariant: a required contextual decision-method
dependency must be successfully resolved *and validated* during DI resolution/activation,
before the aggregate decision method is invoked; for `ICurrentUser<TId, TUser>` this means
`CurrentUser<TId, TUser>` validates user availability during its own construction (not the
`User` getter), so a missing current user becomes a decision-method parameter-resolution
failure and the aggregate is never invoked. Both tasks preserve the existing contextual-
fact/pure-policy (Level 1) vs. orchestration/I-O (Level 2, explicit
`IEventSourcedCommandHandler`) distinction unchanged (D39) — neither task's edits touch
that boundary. `overview.md` was checked and already stated the correct generic shape and
non-optional semantics (`TUser User`, D42/D43) before this pass — no edit needed there.
Both tasks' `semantic_references.decisions` now include D44 (and task 12 additionally
D42/D43, which its body newly cites); `node tools/specs.mjs validate` confirms every
reference resolves (see Gating checks below).

**Tasks 13-16 architecture/implementation — untouched.** Confirmed by `git diff` (see
above): zero content difference against the already-`implemented`, already-reviewed
revision. This pass did not reopen `IAggregateMethodDecider`/`IDecider`, the parameter-
injection architecture, D43's generic-user design, or the Documents authorization model.

## Gating and non-gating checks

```
Gating validation: passed
  node tools/specs.mjs validate — 8 changes, no errors
Non-gating repository check:
  node tools/specs.mjs check — stale: specs/index.generated.json (expected, unrelated changes)
  node tools/docs.mjs check  — stale: docs/index.generated.md (expected, unrelated changes)
```

## Semantic-reference completeness (D26, D29)

Task 11 cites D13, D17, D18, D20-D25, D28, D29, D31, D33-D39, D42-D44 — all resolve in
`owner-decisions.md` (`validate` confirms integrity; each new D44 citation reviewed
directly above for content accuracy, not just presence). Task 12 cites D13, D17,
D20-D26, D29, D30, D34-D39, D42-D44 — same. No missing load-bearing reference found for
either task.

## Findings

No findings remaining — none raised this run.

## Specification readiness (tasks 11/12, the only non-`implemented` tasks)

- `depends_on` for both resolve and are non-cyclic (tasks 02-10, 13-16, all
  `implemented`) — `validate` confirms.
- `allowed_paths`/`forbidden_paths` present and unambiguous for both (docs-only paths,
  disjoint from `src/**`/`examples/**`).
- Acceptance criteria are testable: task 11's are `node tools/docs.mjs validate`/`check`
  plus inspection against the explicit "required reader questions" list; task 12's are
  `node tools/docs.mjs validate` plus inspection against the current final code shape —
  neither is aspirational language.
- No owner decision needed for either task is open.
- Documentation impact is the tasks' entire scope, already identified.
- Neither task touches an owner-approval-gated architectural decision requiring a fresh
  option analysis — both are corrections to already-decided (D42-D44) contract wording.

## Verdict

`ready-for-approval`. `ready_for_approval: true`, `implementation_allowed: false` (tasks
11/12 are still `draft` in `change.yaml`, checked directly, not assumed — approval is a
separate, explicit step).

## Architecture and documentation

No new architecture-doc/ADR conflict. This pass corrected wording only — no task's scope,
acceptance criteria count (beyond the one added AC12.11 documenting the D44 invariant
plainly), or dependency graph changed.
