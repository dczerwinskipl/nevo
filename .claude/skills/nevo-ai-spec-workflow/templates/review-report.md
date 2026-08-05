# Review report template

This is the file written to disk — `specs/active/<change>/reviews/spec.md` (spec
review), `specs/active/<change>/reviews/<task-id>.md` (task review),
`specs/active/<change>/reviews/audit-<slug>.md` (spec-audit — see
`references/review-policy.md` § "Change-wide audits"),
`specs/active/<change>/reviews/batch-<id>.md` (the gating batch review, area
batch-execution-and-gating-review — `<id>` is the batch's `startRevision`, short form), or
`specs/active/<change>/reviews/implementation-review-<scope>.md` (the multi-task
implementation review orchestrator, area implementation-review-orchestration — see
`references/review-policy.md` § "Multi-task implementation review"; `<scope>` is `all`
or the resolved, sorted, dash-joined order list, e.g. `01-03-07`). It's the full
report; the conversation only gets the short structured summary from
`references/review-policy.md` § "Chat output shape" plus a pointer to this file. A
guide, not mandatory boilerplate — omit any section with nothing to say, but never omit
"Findings" or "Verdict".

```markdown
---
review-of: spec | task | spec-audit | batch | implementation-review
change: <change-id>
task: <task-id>              # task review only
audit-focus: <owner's focus, verbatim, short>   # spec-audit only — never invent a task field instead
batch: <startRevision, short form>              # batch review only — matches the filename's <id>
batched-tasks: [<task-id>, ...]                 # batch review only — the batch's orderedTasks, verbatim
scope: all | <sorted-dash-joined-orders>        # implementation-review only — matches the filename's <scope>, e.g. 01-03-07
reviewed-tasks: [<task-id>, ...]                # implementation-review only — the resolved scope, in order
eligible-for-verification: [<task-id>, ...]     # implementation-review only — selectEligibleForVerification's output
must-remain-unchanged: [<task-id>, ...]         # implementation-review only — every other reviewed task
generated: <ISO date>
verdict: blocked | owner-decision-required | changes-required | ready-for-approval | approved-for-implementation
         # task review: blocked | changes-required | pass
         # spec-audit: owner-decision-required | changes-recommended | no-findings
         # batch review: owner-decision-required | changes-recommended | no-findings (same three-value table as spec-audit — see computeBatchReviewVerdict)
         # implementation-review: pass | changes-required | owner-decision-required | blocked (see computeMultiTaskReviewVerdict)
audit_status: open | actioned | dismissed   # spec-audit only — see references/review-policy.md § "audit_status"; starts `open`, never anything else on first write
ready_for_approval: true | false        # spec review only
implementation_allowed: true | false
unresolved_required_fixes: <count>          # unresolved AUTO_FIX findings
unresolved_owner_decisions: <count>         # unresolved OWNER_DECISION findings only
unresolved_needs_clarification: <count>     # unresolved NEEDS_CLARIFICATION findings only — counted separately, not merged with owner decisions
spec_fingerprint: <hex string>          # spec review only — verbatim output of `node tools/specs.mjs fingerprint <change>`, never estimated
task_fingerprints:                      # spec review only — one entry per task actually evaluated in step 5a
  <task-id>: <hex string>                #   (semantic-reference completeness), verbatim output of
  <task-id>: <hex string>                #   `node tools/specs.mjs fingerprint <change> --task <task-id>`, never estimated —
                                          #   see references/review-policy.md § "Deterministic review freshness"
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
the findings below. If `unresolved_owner_decisions > 0` or
`unresolved_needs_clarification > 0`, `ready_for_approval` must be `false`; if any task
isn't `approved`, `implementation_allowed` must be `false` — the report's own
consistency-validation step (same reference) catches a mismatch before this file is
written. `spec_fingerprint` is what `node tools/specs.mjs approve` checks for staleness
before allowing an approval — never hand-write or guess this value.

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

## Batch integration *(batch review only)*

The whole-batch diff since `startRevision`, cross-task integration, and open
`blocking`-severity `follow-ups.yaml` entries only — **never** a re-evaluation of any
individual batched task's own acceptance criteria (those were already gated by that
task's own self-check, and — for a task meeting a risk signal — its own `task-review`;
see area `batch-execution-and-gating-review`'s "Responsibility split" table). State which
batched tasks required their own full `task-review` and why (the risk signal(s) that
triggered it), and which completed via self-check plus this review alone.

## Task sections *(implementation-review only)*

One subsection per reviewed task, each naming: that task's own verdict
(`pass`/`changes-required`/`blocked`), a link/reference to its own
`reviews/<task-id>.md`, and its unresolved findings (ID, category, one-line summary —
never the full per-task report re-embedded here). Never re-evaluates any individual
task's own acceptance criteria — that already happened in that task's own
`task-review`-equivalent pass.

## Cross-task integration *(implementation-review only)*

The real diff across the resolved scope, cross-task path overlap (per
`attributeTouchedPaths`/`detectBatchIntegrationFindings`, reused from area
batch-execution-and-gating-review), and open `blocking`-severity `follow-ups.yaml`
entries whose `source_task` falls inside the resolved scope — same shape as "Batch
integration" above, scoped to this run's selected tasks instead of a batch's
`orderedTasks`.

## Eligibility *(implementation-review only)*

The eligible-for-verification list and the must-remain-unchanged list (with, for each
must-remain-unchanged task, the specific reason: its own verdict, or an unresolved
cross-task finding) — restates the frontmatter's `eligible-for-verification`/
`must-remain-unchanged` fields in prose, so the reader doesn't have to parse YAML to see
who's not moving and why.
```

`review-of`, `change`, `verdict` are required frontmatter. `task` is required only for a
task review. This isn't validated by `tools/docs.mjs` (which only scans `docs/`) or
`tools/specs.mjs` (which doesn't read `reviews/`) — it's a convention for humans and for
`/nevo-ai:spec-refine --from-review` to parse, not a schema either tool enforces.
