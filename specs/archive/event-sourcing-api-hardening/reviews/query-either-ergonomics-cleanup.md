---
review-of: task
change: event-sourcing-api-hardening
task: query-either-ergonomics-cleanup
generated: 2026-08-12
verdict: pass
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
---

# Review: event-sourcing-api-hardening/query-either-ergonomics-cleanup

- [x] Acceptance criteria: 7/7
- [x] Scope: compliant
- [x] Findings: none unresolved

---

Re-review (2026-08-12, targeted post-review correction pass — public API polish only, no
semantic change). Baseline: this file's prior content (`pass`, no findings). Owner
requested renaming `RequireSome`'s callback parameter from `None` to `onNone` (normal
camelCase callback naming, consistent with the rest of the repository) and the source
parameter from `self` to `source`. Both the extension method's XML documentation
(`<paramref name="onNone"/>`) and its body were updated together; no call site uses a
named argument, so no call site needed a change.

Semantics unchanged: `Left` passes through without evaluating `onNone`; `Right(Some(v))`
becomes `Right(v)`; `Right(None)` becomes `Left(onNone())`. `dotnet build` and
`dotnet test tests/NEvo.Core.Tests` re-run clean (19/19), including the three
`RequireSome` tests proving each case unchanged. Self-check re-run and passed.
Acceptance-criteria coverage and scope compliance unchanged from the original review.
