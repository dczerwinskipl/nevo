---
review-of: task
change: nevo-documentation-architecture
task: known-issues-consolidation
generated: 2026-08-03
verdict: pass
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
---

# Review: nevo-documentation-architecture/known-issues-consolidation

No reliable previous-file baseline is available. Performing a fresh review of the
current task implementation.

## Verdict

`pass` — commit `a055e2e` stays within `allowed_paths`; `docs/project/known-issues.md`
contains all 6 named defects plus the example-app gap and the intentional-simplification
exclusion, each with the required fields.

## Findings

| ID | Category | Lifecycle | Predicate | Finding | Evidence | Location |
|---|---|---|---|---|---|---|
| F1 | INFORMATIONAL | — | — | Every entry's "Related spec/task" field uses the generic phrase "First documented by the archived `nevo-documentation-foundation` change" rather than a more specific task id | Acceptable — task file says "where known" and instructs citing by package/fact rather than soon-to-move paths | Read `docs/project/known-issues.md` entries | `docs/project/known-issues.md` |
| F2 | INFORMATIONAL | — | — | `node tools/docs.mjs validate` — clean (59 documents, no errors); no process-narration phrasing found | Command output + grep, this run | — |

## Scope compliance

Confirmed. Commit touches exactly `docs/project/known-issues.md` and `change.yaml`. None
of `docs/packages/**`, `docs/guides/**`, `docs/architecture/**`, `docs/development/**`,
`docs/adr/**`, `docs/ai/**` touched.

## Acceptance-criteria coverage

- `docs/project/known-issues.md` exists, `type: project`, passes validate — **met**.
- All 12 items (11 defects + 1 example-app gap) present, each with Affected feature /
  Current behavior / Practical consequence / Intended behavior / Severity-usage
  recommendation / Source / Related spec-task — **met**. All 6 named items from the
  discovery audit confirmed present verbatim (auth→500, permission names ignored, fake
  event store, missing orchestration persistence, incomplete outbox, GET/POST
  inconsistency).
- Intentional-simplification case (hardcoded example-app roles) present and explicitly
  marked not a defect — **met**.

## Architecture and documentation

No architecture/ADR conflict. This document is itself the new authoritative source for
known issues; package docs point to it (verified by task 8's own migration).

## Tests

No behavior change; N/A.
