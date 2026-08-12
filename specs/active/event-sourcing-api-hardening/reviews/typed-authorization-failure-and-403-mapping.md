---
review-of: task
change: event-sourcing-api-hardening
task: typed-authorization-failure-and-403-mapping
generated: 2026-08-12
verdict: pass
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
---

# Review: event-sourcing-api-hardening/typed-authorization-failure-and-403-mapping

- [x] Acceptance criteria: 8/8
- [x] Scope: compliant
- [x] Findings: none unresolved

---

Re-review (2026-08-12, targeted post-review correction pass — comment/documentation
cleanup only, no design change). Baseline: this file's prior content (`pass`, no
findings). Owner requested removal of implementation-history commentary from this
task's own files:

- `ValidatePermissionMiddlewareTests.cs`: a test comment ("Regression-proof for task 15:
  fails against pre-task code...") was reworded to describe why the assertion exists
  (permission denial uses a typed failure so transports can distinguish it from ordinary
  application errors without inspecting exception messages) rather than referencing the
  task/timeline that introduced it.
- `WALKTHROUGH.md`: a step heading ("ordinary failure, unaffected by task 15") was
  reworded to "ordinary application failure" — the walkthrough must stay understandable
  without access to task files.

No production behavior, HTTP mapping, or test assertion changed. `dotnet build` and
`dotnet test tests/NEvo.Messaging.Authorization.Tests` re-run clean (13/13). The
Documents example was re-run live: unauthenticated → 401, authenticated without
permission → 403 (`PermissionDeniedException`), authenticated with permission → 200,
querying a non-existent document → 500 — all four cases unchanged. Self-check re-run
and passed. Acceptance-criteria coverage and scope compliance unchanged from the
original review.
