---
review-of: task
change: nevo-ai-process-continuity-and-hardening
task: mechanical-task-type
generated: 2026-08-05
verdict: pass
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
---

# Review: nevo-ai-process-continuity-and-hardening/mechanical-task-type

## Verdict

`pass` — all six D14 conditions are implemented as a single conjunctive check shared by
both `validate` and `approve`, the review-exemption skips only the review/verdict/
fingerprint checks (all other approve guards unchanged), acceptance criteria 1-3 are met
with automated test coverage, the task's own "## Verification" commands all pass, and the
diff stays entirely within `allowed_paths` with no `forbidden_paths` touches.

No reliable previous-file baseline is available. Performing a fresh review of the current
task implementation.

## Findings

| ID | Category | Lifecycle | Predicate | Finding | Evidence | Location |
|---|---|---|---|---|---|---|
| F1 | NON_BLOCKING | first-review | The task file's "Implementation constraints" section lists `depsSatisfied` as one of `approve`'s "existing guards" that "still applies unchanged" | `depsSatisfied` is not, and per this branch's own design (D3, task 02), has never been part of `handleApprove`/`validateApproval` — it moved to `handleStart` in task 02's postcondition rewrite (main's old `handleApprove` did call it; that call was intentionally removed in commit `f194053`, task 02, before task 07 existed). The task-07 implementation is internally consistent with the codebase's actual guard placement; the task file's own prose is what's stale, not the code. | `tools/specs.mjs`'s `handleApprove` (lines ~210-259) never calls `depsSatisfied`; `tools/specs/lifecycle.mjs`'s `validateApproval` only calls `validateTransition` then the mechanical-exempt/review checks — no `depsSatisfied` call anywhere in the approve path. Compare `git show main:tools/specs.mjs` line 145, which did call it. | `specs/active/nevo-ai-process-continuity-and-hardening/tasks/07-mechanical-task-type.md` lines 58-60 |
| F2 | INFORMATIONAL | — | `node tools/specs.mjs validate` — clean | 6 changes validated, no errors | Command output, this run | — |
| F3 | INFORMATIONAL | — | `node tools/specs.mjs check` — non-gating repository index check | `check` reports `stale: specs/index.generated.json` (exit 1). This is not self-caused by task 07's diff — `07-mechanical-task-type`'s `allowed_paths` (`tools/specs/validation.mjs`, `tools/specs/lifecycle.mjs`, `tools/specs.mjs`, `tools/tests/mechanical-task.test.mjs`, `.claude/skills/.../templates/task.md`) contain no `specs/**` source file that feeds `specs/index.generated.json` (task/area/`change.yaml`/`overview.md` content), and `git status` shows no uncommitted change to either `change.yaml` or `index.generated.json`. Attributable to the broader in-flight change's other tasks, per review-policy's "Gating versus non-gating checks" — does not affect this task's verdict. | Command output, this run | `specs/index.generated.json` |
| F4 | INFORMATIONAL | — | `routingWarnings` in the task's own context packet | `node tools/specs.mjs context ... mechanical-task-type` reports `"no routing rule matched — verify context manually"` — an expected, documented warning (area `context-and-validation-hardening` requirement 6, task 05's own mechanism), not a defect in task 07. | Command output, this run | context packet |

F1 is a candidate for follow-up recording (not recorded — requires owner-facing confirmation, out of scope for this subagent run).

## Scope compliance

Confirmed within scope. Both commits implementing this task touch only files inside
`allowed_paths`:
- `db6fb14` ("type: mechanical review-exempt deterministic approval (task 07)"): `.claude/skills/nevo-ai-spec-workflow/templates/task.md`, `tools/specs.mjs`, `tools/specs/lifecycle.mjs`, `tools/specs/validation.mjs`, `tools/tests/mechanical-task.test.mjs` — an exact match to the five `allowed_paths` entries, nothing extra.
- `4ced3fd` ("mechanical-task eligibility uses an explicit allowed status set, requires derived_from in depends_on, fence-aware AC parser" — a PR-review-packet follow-up fix on the same task): `tools/specs/validation.mjs`, `tools/tests/mechanical-task.test.mjs` — both within `allowed_paths`.

No `forbidden_paths` entry (`src/**`, `tests/**`, `examples/**`, `docs/**`,
`.claude/commands/**`) is touched by either commit. `git status` shows no additional
uncommitted changes to this task's scope (only untracked sibling review files for other
tasks).

## Acceptance-criteria coverage

1. **Met.** A `type: mechanical` task meeting all six conditions receives the exemption,
   and `approve` still performs the explicit `draft`→`approved` transition rather than
   skipping it. `tools/specs/lifecycle.mjs`'s `validateApproval` checks
   `validateTransition('approve', taskStatus)` **before** the `mechanicalExempt`
   short-circuit (`if (mechanicalExempt) return { ok: true, idempotent: false };` only
   after the transition check), so the transition gate is never bypassed. Covered by
   `tools/tests/mechanical-task.test.mjs` ("a task meeting all six conditions is eligible,
   with no failed conditions"; "validateApproval grants the exemption and still performs
   the explicit draft->approved transition"). Automated command
   (`node --test tools/tests/mechanical-task.test.mjs`) run this session: **17/17 pass**.
2. **Met.** A task missing exactly one condition fails `validate` naming that specific
   condition, covered for far more than the required "at least two distinct
   missing-condition cases": missing/unresolvable `derived_from`, `derived_from` task
   still `draft`, `derived_from` task `abandoned`, `derived_from` not in the task's own
   `depends_on`, `deterministic` not `true`, `allowed_paths` outside the derived task's
   declared paths, a missing `automated:` tag, and a two-failures-at-once case (proving
   the check is conjunctive, not majority/scoring — `five-of-six` test also covers this
   explicitly). `computeMechanicalExemption`/`inspectMechanicalConditions` is the single
   function both `validateSpecs` (the hard `validate` error path, line ~492-497 of
   `tools/specs/validation.mjs`) and `handleApprove` call — no parallel
   re-implementation, so the unit tests against the pure function directly exercise what
   `validate` itself runs.
3. **Met.** An `owner-decision:`-tagged acceptance criterion is rejected
   (`carries an owner-decision: tag — not allowed for type: mechanical`), as is an
   `inspection:`-tagged one, both covered by dedicated tests. The acceptance-criteria
   parser is fence-aware (a numbered line inside a fenced code example is not mistaken
   for a criterion), verified by its own test.

## Architecture and documentation

`.claude/skills/nevo-ai-spec-workflow/templates/task.md` was updated in the same commit
(`db6fb14`) with a new "Mechanical tasks" section documenting `type: mechanical`, the
"review-exempt deterministic approval" terminology (verbatim, matching D14), and an
explicit numbered list of the six conjunctive conditions — matching this task's own
"Documentation impact" instruction ("document `type: mechanical`, its six conditions, and
the … terminology"). No `docs/development/` architecture document describes this
behavior yet (full consolidation is explicitly deferred to task 11 per this task's own
scope note), so there is no drift to detect here. No ADR conflict: D14 (mechanical-task
terminology/semantics), D18 (semantic-reference fingerprint scope, unrelated to this
task's own logic), and D26/D29 (semantic-reference completeness, spec-review-level, not
implementation-level) are all consistent with what's implemented — `approve` still writes
`status: approved` explicitly and is never a silent side effect, per D14's own wording,
confirmed by the code path (`clearTaskSuspension` → `setTaskStatus(..., 'approved')` →
explicit console message naming the exemption).

## Tests

Behavior-change coverage is complete for this task's own logic:
`tools/tests/mechanical-task.test.mjs` (17 tests, all passing this run) covers
`inspectMechanicalConditions`/`computeMechanicalExemption` (all six conditions, both
individually and pairwise-failing) and `validateApproval`'s `mechanicalExempt` bypass
(transition-check-still-applies, review-required-when-not-exempt, idempotent-approved
no-op untouched). `tools/tests/task-lifecycle.test.mjs` (106 tests across 15 suites, all
passing this run) exercises the surrounding lifecycle machinery this task builds on
without regressing it (`validateApproval`'s non-mechanical paths, `depsSatisfied`,
`deriveStage`, suspension/self-check-aware reporting, resume-and-continue controller) —
no test in this suite failed, so no evidence of a regression introduced by this task's
change to `validateApproval`'s signature (new optional 4th-argument destructured object,
defaulting to the pre-existing behavior when omitted).

### Verification commands run this session (task's own "## Verification" section, literally)

```
node --test tools/tests/mechanical-task.test.mjs   → 17/17 pass
node --test tools/tests/task-lifecycle.test.mjs    → 106/106 pass
node tools/specs.mjs validate                      → "Validated 6 changes — no errors."
```

All three commands are exact-file/exact-subcommand invocations (no bare
`tools/tests/` directory glob issue applies here — the task's own Verification section
already names the two test files explicitly).

Gating validation: passed (`node tools/specs.mjs validate` — clean, F2).
Non-gating repository check: failed — `specs/index.generated.json` stale, not
attributable to this task's own diff (F3); does not affect this task's verdict per
review-policy's gating/non-gating split.
