---
review-of: task
change: event-sourcing-api-hardening
task: documents-example-es-and-auth-demo
generated: 2026-08-12
verdict: pass
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
task_fingerprint: d72cdcd8508165cd149e22537bffcda976e284e60b7c1865a3707f09d7cb4c06
---

# Review: event-sourcing-api-hardening/documents-example-es-and-auth-demo

Third review (2026-08-12). Baseline: this file's prior content (`pass`, 7/7 AC,
`task_fingerprint: dfda1eece1d...`). Task fingerprint changed because task 10's own
prose was corrected (wording only, no scope/decision change — D33 itself was already
accurate and untouched):

- The false claim that "the framework has no current-user/context capability a decision
  method **or an explicit handler** could use" is corrected in `WALKTHROUGH.md` and task
  10's own Goal section — an explicit handler *could* reach caller identity via
  lower-level messaging context (the prior, now-removed `ApproveDocumentHandler` did
  exactly that via `IMessageContextAccessor`); the accurate constraint is that *aggregate
  decision methods* lack this capability, and an explicit handler used solely to work
  around that would add orchestration indirection this example doesn't need.
- `WALKTHROUGH.md` reworded to read as canonical example documentation rather than a
  review artifact: the opening no longer frames itself as a "verification record," and
  the optimistic-concurrency section states the current behavior instead of justifying
  why a race scenario was excluded. The `ServiceA.Api`/`SayHelloCommand` comparison is
  dropped from the demo-auth section (not load-bearing for understanding this example).
- `Document.cs` XML docs on `Create`/`Change`/`Approve` now describe what a decision
  method actually does (decides, emits an event) rather than describing the state
  transition that only `Apply` performs — `Apply(DocumentApproved)`'s wording was already
  correct and is unchanged.
- `DocumentCommands.cs`'s `ApproveDocument` summary drops the redundant "the attribute
  below is the source of truth" code-layout narration.

No behavior changed (doc comments and Markdown only) — re-verified by `dotnet build`
only, no new manual walkthrough run needed on top of the prior pass's already-verified
behavior for this exact code path.

- [x] Acceptance criteria: 7/7
- [x] Scope: compliant
- [x] Findings: none unresolved

## Verification

- `dotnet build` (whole solution) — passed
- `node tools/specs.mjs validate` — passed
- `node tools/docs.mjs validate` — passed
