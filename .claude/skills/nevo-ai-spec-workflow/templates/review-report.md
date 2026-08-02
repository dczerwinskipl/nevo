# Review report template

This is the file written to disk — `specs/active/<change>/reviews/spec.md` (spec
review) or `specs/active/<change>/reviews/<task-id>.md` (task review). It's the full
report; the conversation only gets the short closing summary from `SKILL.md` § "Ending
every command's response" plus a pointer to this file. A guide, not mandatory
boilerplate — omit any section with nothing to say, but never omit "Findings" or
"Verdict".

```markdown
---
review-of: spec | task
change: <change-id>
task: <task-id>              # task review only
generated: <ISO date>
verdict: blocked | owner-decision-required | changes-required | ready-for-approval | approved-for-implementation
         # task review: blocked | changes-required | pass
ready_for_approval: true | false        # spec review only
implementation_allowed: true | false
unresolved_required_fixes: <count>       # unresolved AUTO_FIX findings
unresolved_owner_decisions: <count>      # unresolved OWNER_DECISION + NEEDS_CLARIFICATION findings
---

# Review: <change-id>[/<task-id>]

## Verdict

<one line — the value above, plus a one-sentence reason. Never a looser phrase like
"ready for implementation" — see references/review-policy.md § "Forbidden phrasing".>

## Implementation readiness *(spec review only)*

- May implementation start now? <yes | no — literally `implementation_allowed` above>
- Are the relevant tasks `approved` in `change.yaml`? <yes | no, currently `<status>`>
- What has to happen first? <list by finding ID, or "nothing — ready">

These fields, and the verdict itself, are the output of the decision table in
`references/review-policy.md` § "The decision table" — never composed independently of
the findings below. If `unresolved_owner_decisions > 0`, `ready_for_approval` must be
`false`; if any task isn't `approved`, `implementation_allowed` must be `false` — the
report's own consistency-validation step (same reference) catches a mismatch before
this file is written.

## Findings

One row per finding, grouped or sorted by category — never mixed into prose. Empty is a
valid, good outcome: say "No findings" explicitly rather than omitting the section.
`Lifecycle`/`Predicate`/`Evidence` are populated whenever a baseline exists (see
`references/review-policy.md` § "Re-review: current file contents are the source of
truth") — write `first-review` in `Lifecycle` when there is no baseline, never leave it
blank (a blank cell reads as "forgot to check," not "not applicable").

| ID | Category | Lifecycle | Predicate | Finding | Evidence | Location |
|---|---|---|---|---|---|---|
| F1 | AUTO_FIX | still-present | `forbidden_paths` in `tasks/13-....md` includes `docs/architecture/overview.md` | Add it — currently missing | Read `tasks/13-....md` just now; `forbidden_paths` list does not contain it | `tasks/13-....md` |
| F2 | OWNER_DECISION | resolved | An ADR decision for this concern is recorded in `owner-decisions.md` | *(resolved — not an active finding)* | `owner-decisions.md` D2 records the decision, dated today | `owner-decisions.md` |
| F3 | NEEDS_CLARIFICATION | first-review | The exact target file for this task is named | Which file is the actual target? | No baseline; task file doesn't name a target file | `tasks/12-....md` |
| F4 | NON_BLOCKING | first-review | — | Add a "Dependencies" section | — | `tasks/03-....md` |
| F5 | INFORMATIONAL | — | — | `node tools/specs.mjs validate` — clean | Command output, this run | — |

A finding marked `resolved` is not repeated as an active blocker — it appears here as a
record that it was checked and cleared, and it must not feed the verdict decision table
as unresolved. See `references/review-policy.md` § "Findings must be actor-classified"
for the category column and § "Findings have a lifecycle, on top of their actor
category" for the lifecycle column.

## Scope compliance *(task review only)*

Whether the diff stayed within `allowed_paths` and away from `forbidden_paths` —
confirm explicitly, don't just imply it from the absence of a finding.

## Acceptance-criteria coverage

Which acceptance criteria are met, not met, or untestable as written.

## Architecture and documentation

Consistency with `docs/architecture/`, applicable ADRs, and (task review) whether
required documentation updates actually landed in the diff.

## Tests *(task review)*

Whether behavior changes have corresponding test coverage.
```

`review-of`, `change`, `verdict` are required frontmatter. `task` is required only for a
task review. This isn't validated by `tools/docs.mjs` (which only scans `docs/`) or
`tools/specs.mjs` (which doesn't read `reviews/`) — it's a convention for humans and for
`/nevo-ai:spec-refine --from-review` to parse, not a schema either tool enforces.
