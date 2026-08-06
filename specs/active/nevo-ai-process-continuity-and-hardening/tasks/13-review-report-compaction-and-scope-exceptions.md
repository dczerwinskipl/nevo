---
id: nevo-ai-process-continuity-and-hardening.review-report-compaction-and-scope-exceptions
status: draft
change: nevo-ai-process-continuity-and-hardening
depends_on:
  - implementation-review-orchestration
semantic_references:
  decisions: [D30, D31]
  constraints: [C1, C2, C4]
  dependency_contracts:
    - implementation-review-orchestration
context:
  required:
    - specs/active/nevo-ai-process-continuity-and-hardening/areas/review-report-compaction-and-scope-exceptions.md
    - specs/active/nevo-ai-process-continuity-and-hardening/owner-decisions.md
    - .claude/skills/nevo-ai-spec-workflow/references/review-policy.md
    - .claude/skills/nevo-ai-spec-workflow/templates/review-report.md
    - .claude/commands/nevo-ai/task-review.md
    - .claude/commands/nevo-ai/implementation-review.md
    - tools/specs/lifecycle.mjs
    - docs/decisions/ADR-0006-process-continuity-and-hardening.md
  optional:
    - .claude/skills/nevo-ai-spec-workflow/SKILL.md
    - docs/ai/specification-workflow.md
    - specs/active/nevo-ai-process-continuity-and-hardening/areas/implementation-review-orchestration.md
    - specs/active/nevo-ai-process-continuity-and-hardening/tasks/12-implementation-review-orchestration.md
    - tools/specs/service.mjs
allowed_paths:
  - tools/specs/lifecycle.mjs
  - tools/tests/review-compaction.test.mjs
  - .claude/commands/nevo-ai/task-review.md
  - .claude/commands/nevo-ai/implementation-review.md
  - .claude/skills/nevo-ai-spec-workflow/references/review-policy.md
  - .claude/skills/nevo-ai-spec-workflow/templates/review-report.md
  - docs/ai/specification-workflow.md
  - docs/decisions/ADR-0006-process-continuity-and-hardening.md
consequential_paths:
  - docs/index.generated.md
  - docs/index.generated.json
  - specs/active.generated.md
  - specs/index.generated.json
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
  - docs/development/**
  - docs/usage/**
  - docs/reference/**
  - specs/archive/**
  - AGENTS.md
  - CLAUDE.md
---

# Task: Review report compaction and owner-approved scope exceptions

> New task, added 2026-08-06 (sixth refinement pass) — see `owner-decisions.md` D31.
> Requested after task 12 (`implementation-review-orchestration`) reached
> `status: in-implementation`. This task does not reopen or rewrite task 12 or any of
> tasks 01-11; it changes how `/nevo-ai:task-review` and `/nevo-ai:implementation-review`
> write their reports and how a scope violation may be resolved, reusing task 12's own
> report/decision model — the reason this task depends on task 12 rather than standing
> alone.

## Goal

Make `/nevo-ai:task-review` and `/nevo-ai:implementation-review` reports concise and
exception-oriented by default — exactly as specified in
`areas/review-report-compaction-and-scope-exceptions.md` — and replace the current
unconditional "a scope violation is always blocking, no exceptions" rule with a policy
that never silently waives a scope violation but lets the owner explicitly accept a
narrow, non-`forbidden_paths` exception, recorded as structured, machine-readable data in
the review artifact. `/nevo-ai:spec-review`, `/nevo-ai:spec-audit`, and the gating batch
review are unchanged.

## Dependencies

`implementation-review-orchestration` (task 12) — this task extends the same report shape
and decision model `/nevo-ai:implementation-review` already established (its verdict
table, its per-task reuse of `task-review`'s own flow, its `bulk-transition` write path),
rather than building a parallel one; starting before task 12 exists would mean editing an
aggregate report shape that didn't exist yet.

## Implementation constraints

### Report compaction (`references/review-policy.md`, `templates/review-report.md`)

- Add the seven-item compact checklist (area requirement 1, exact text there) to
  `templates/review-report.md`'s task-review/implementation-review shapes. A checked item
  (`[x]`) carries no further prose; a failed item (`[ ]`) names the specific acceptance
  criterion, finding, or scope issue directly beneath it.
- Restrict `Findings` to actionable/exception content only (area requirement 2) — never a
  synthetic `INFORMATIONAL` finding for a passing test, a successful validation command,
  compliant `allowed_paths`, an absent forbidden path, expected implementation structure,
  or documentation consistency; those facts are already represented by a checked
  checklist item. Render `No findings.` verbatim when nothing actionable remains.
- Add the compact `## Verification` shape (area requirement 3) — one line per command
  plus pass/fail, full output only on failure or when the output is itself required
  evidence.
- Add the compact AC-coverage shape (area requirement 4) — one line
  (`[x] All N acceptance criteria covered`) for a fully passing report; expand only
  criteria that are not met, partially met, untested, or questionable, optionally as an
  `AC | Result | Evidence` table.
- Add a new `computeTaskReviewChecklist` function to `tools/specs/lifecycle.mjs`
  implementing the deterministic verdict-consistency guards (area requirement 5):
  inputs are the seven checklist booleans/states (AC coverage complete, verification
  passed, scope status, forbidden-path-clean, docs-consistent, unresolved-blocking-count,
  unresolved-owner-decision-count); output is `{ verdict: 'pass' | 'changes-required' |
  'blocked', unresolvedItems: [...] }` — `pass` only when every item resolves clean, same
  three-value set `task-review` already uses (never a fourth value — see "Options and
  trade-offs" below). A missing explicitly required automated test is modeled as an
  `AUTO_FIX`-classified unresolved item, never folded into a soft/non-blocking count.
  `task-review.md` step 7 and `implementation-review.md` step 3's per-task pass both call
  this function instead of composing the verdict as prose.

### Scope-violation policy (`task-review.md`, `references/review-policy.md`)

- Replace `task-review.md` step 4's "a violation here is always a blocking finding, no
  exceptions" with the area requirement 8 wording, and add the classification/resolution
  steps from area requirements 9-11 (distinguish outside-`allowed_paths` /
  `forbidden_paths` / other-task-attributable / unnecessary; name the smallest valid
  resolution; the three-option owner menu, with option 1 available only for an
  outside-`allowed_paths` finding).
- Add `classifyScopeFinding(path, { allowedPaths, forbiddenPaths })` to
  `tools/specs/lifecycle.mjs`, returning `'compliant' | 'outside-allowed' | 'forbidden'`
  — reuses the existing `pathMatchesAllowedPattern` helper rather than a new glob
  matcher. `task-review.md`'s scope-check step (the former step 4) calls this once per
  changed file instead of a bare allowed/forbidden prose check.
- Add the `scope_exceptions` frontmatter block (area requirement 12's exact schema) to
  `templates/review-report.md`, and document, in `references/review-policy.md`, that an
  entry naming a path classified `forbidden` by `classifyScopeFinding` is invalid and must
  never be written (area requirement 10's hard exclusion).
- Add `accepted` to the finding-lifecycle vocabulary in `references/review-policy.md` §
  "Findings have a lifecycle" (area requirement 13), alongside the existing
  `resolved`/`still-present`/`changed`/`cannot-verify` — an `accepted` finding is excluded
  from the unresolved-blocking count feeding `computeTaskReviewChecklist`, but its row and
  the checklist's "Scope check resolved" note (area requirement 14) still state that the
  implementation exceeded the declared scope.
- Add `isScopeExceptionValid(exception, { path, taskFingerprint })` to
  `tools/specs/lifecycle.mjs` (area requirement 15) — deterministically checks the
  recorded path and task fingerprint against the current values; a mismatch invalidates
  the exception. `task-review.md`'s re-review step calls this for every existing
  `scope_exceptions` entry before treating it as still `accepted`, and additionally
  performs the model-inspection check for material expansion the deterministic function
  cannot decide (area requirement 15's own split).
- Document the specification-scope-amendment escalation path (area requirement 16) in
  `references/review-policy.md` — no new code, since `/nevo-ai:spec-refine`/
  `/nevo-ai:spec-review` and D18's existing fingerprint-invalidation mechanism already
  cover it.

### Aggregate report (`implementation-review.md`)

- Replace `implementation-review.md` step 7's per-task section shape with the compact
  `Task | Verdict | AC | Tests | Scope | Findings` table (area requirement 17); expand
  detail only for failing tasks, unresolved/accepted scope exceptions, cross-task
  findings, and owner decisions.
- Extend `implementation-review.md` step 8's confirmation to collect every selected
  task's pending scope-exception decision into the same turn (area requirement 18) —
  grouped by resolution path (`outside-allowed`, eligible for the requirement 11 menu, vs.
  `forbidden`, not eligible) rather than one accept-all answer across both. Apply
  collected decisions atomically per area requirement 19: update finding lifecycle once
  per resolved finding, update the aggregate and per-task review artifacts together, and
  apply eligible status transitions through the existing `bulk-transition` operation
  (task 12) only — never a second write path, and never touching a task with any
  still-unresolved finding.

### `--verbose` (optional, area requirement 20)

- Add `--verbose` to `task-review.md`'s argument parsing only if it does not complicate
  the default (compact) flow above — restoring full AC-by-AC prose and fuller finding
  narration when passed. Shipping without it is an acceptable outcome of this task.

## Acceptance criteria

1. A passing `task-review`/`implementation-review` report renders the seven-item compact
   checklist from `templates/review-report.md`, with no additional prose under a checked
   item (automated: `tools/tests/review-compaction.test.mjs` snapshot of a synthetic
   passing report + inspection of the template).
2. `Findings` never contains a synthetic `INFORMATIONAL` entry for a passing test, a
   successful validation command, compliant `allowed_paths`, an absent forbidden path,
   expected implementation structure, or documentation consistency (automated).
3. `computeTaskReviewChecklist` returns `pass` only when every one of the seven checklist
   inputs resolves clean, and returns something other than `pass` when exactly one input
   is false, tested for each of the seven independently (automated).
4. A missing explicitly required automated test is classified as an `AUTO_FIX`-blocking
   unresolved item by `computeTaskReviewChecklist`, never merely non-blocking (automated).
5. A passing verification command alone never satisfies AC coverage for a required
   scenario absent from the actual tests — a fixture with a passing command but a
   still-missing scenario yields a non-`pass` checklist result (automated).
6. Only failed, partial, untested, or questionable acceptance criteria are expanded in
   the report body; a fully satisfied AC set renders as one compact line (inspection +
   automated where the fixture is deterministic).
7. `classifyScopeFinding` returns `compliant` / `outside-allowed` / `forbidden` correctly
   for a representative set of paths against a task's `allowed_paths`/`forbidden_paths`
   (automated).
8. An `outside-allowed` finding with no recorded `scope_exceptions` entry keeps `pass`
   unreachable; the same finding with a valid, matching entry no longer counts as
   unresolved (automated).
9. A `forbidden` finding is never resolvable through a `scope_exceptions` entry — the
   checklist/verdict computation treats it as unresolved regardless of any recorded
   exception naming that path (automated).
10. `isScopeExceptionValid` returns valid for a matching path/task-fingerprint pair,
    invalid when the task fingerprint has changed since acceptance, and invalid for a
    different path than the one recorded (automated).
11. The checklist's "Scope check resolved" item, when an exception is active, renders the
    owner-approved-exception-count note and never the false-compliance wording
    ("stays within `allowed_paths`") (inspection + automated where the fixture is
    deterministic).
12. A re-review preserves a finding's `accepted` lifecycle without repeating it as an
    active blocker, while its predicate/evidence remain visible in the report (automated
    + inspection, mirrors the existing `resolved` lifecycle test pattern).
13. The aggregate `implementation-review` report renders one compact row per selected
    task (`Task | Verdict | AC | Tests | Scope | Findings`) and does not concatenate full
    per-task reports; only failing/exception/cross-task/owner-decision tasks are expanded
    (inspection).
14. Several selected tasks with `outside-allowed` scope violations are collected into one
    owner-facing confirmation in the same turn; a task with a `forbidden_paths` violation
    in the same run is presented separately, not folded into the same accept-all answer
    (inspection of the command flow).
15. Collected scope decisions are applied atomically: finding lifecycle updates once per
    resolved finding, the aggregate and per-task artifacts update together, and a task
    with any still-unresolved finding is never included in the bulk status transition
    (automated, reusing task 12's existing `bulk-transition` all-or-nothing guarantee).
16. `task-review.md` and `implementation-review.md` per-task verdicts remain exactly
    `pass` / `changes-required` / `blocked` — no fourth per-task verdict value is
    introduced (inspection).
17. `references/review-policy.md`, `templates/review-report.md`, `task-review.md`, and
    `implementation-review.md` all describe the compact shape and the scope-exception
    model consistently; `/nevo-ai:spec-review`, `/nevo-ai:spec-audit`, and the gating
    batch review's own report shapes are unchanged (inspection).
18. `node tools/specs.mjs check` and `node tools/docs.mjs check` report generated indexes
    as current after this task's doc edits (automated).
19. `node --test tools/tests/*.test.mjs` (the full suite, including this task's new
    `review-compaction.test.mjs`) passes (automated).
20. `docs/decisions/ADR-0006-process-continuity-and-hardening.md` covers D31 (a new
    subsection after "Multi-task implementation review orchestration (D30)", not a new
    ADR) and its "Context" paragraph names task 13 alongside tasks 01-12 (inspection).

## Verification

```
node --test tools/tests/review-compaction.test.mjs
node --test tools/tests/*.test.mjs
node tools/specs.mjs validate
node tools/specs.mjs check
node tools/docs.mjs validate
node tools/docs.mjs check
```

## Documentation impact

`docs/ai/specification-workflow.md` (compact report shape and scope-exception policy,
alongside the existing "Review artifacts and handoff" section),
`.claude/skills/nevo-ai-spec-workflow/references/review-policy.md`,
`.claude/skills/nevo-ai-spec-workflow/templates/review-report.md`,
`.claude/commands/nevo-ai/task-review.md`, `.claude/commands/nevo-ai/implementation-review.md`,
`docs/decisions/ADR-0006-process-continuity-and-hardening.md` (new D31 subsection, context
paragraph updated to name task 13).

## Out of scope

- Changing `/nevo-ai:spec-review`, `/nevo-ai:spec-audit`, or the gating batch review's own
  report shape or verdict vocabulary.
- A fourth per-task verdict value for `task-review`/`implementation-review` — an
  unresolved scope-exception decision stays an unresolved `OWNER_DECISION` finding under
  the existing three-value verdict set.
- Resolving a `forbidden_paths` violation through any review-level mechanism — only a
  specification scope amendment or reverting the change.
- Shipping a fully-implemented `--verbose` mode — the interface may be added, but only if
  it does not complicate the default compact flow; the default shape is this task's real
  requirement.
- Retroactively rewriting any already-written `reviews/*.md` file from tasks 01-12 — the
  new shape applies going forward.
- Reopening, rewriting, or re-scoping tasks 01-12's own task/area files.
