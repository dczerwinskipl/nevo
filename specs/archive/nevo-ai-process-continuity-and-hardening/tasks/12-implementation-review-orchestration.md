---
id: nevo-ai-process-continuity-and-hardening.implementation-review-orchestration
status: draft
change: nevo-ai-process-continuity-and-hardening
depends_on:
  - state-and-fingerprint-semantics
  - scope-and-follow-up-mechanisms
  - batch-execution-and-gating-review
  - workflow-docs-and-adr-migration
semantic_references:
  decisions: [D30, D22]
  constraints: [C1, C2, C5, C7, C9]
  dependency_contracts:
    - state-and-fingerprint-semantics
    - scope-and-follow-up-mechanisms
    - batch-execution-and-gating-review
    - workflow-docs-and-adr-migration
context:
  required:
    - specs/active/nevo-ai-process-continuity-and-hardening/areas/implementation-review-orchestration.md
    - specs/active/nevo-ai-process-continuity-and-hardening/owner-decisions.md
    - .claude/skills/nevo-ai-spec-workflow/references/review-policy.md
    - .claude/commands/nevo-ai/task-review.md
    - .claude/commands/nevo-ai/spec-audit.md
    - tools/specs.mjs
    - tools/specs/service.mjs
    - tools/specs/lifecycle.mjs
    - docs/decisions/ADR-0006-process-continuity-and-hardening.md
  optional:
    - .claude/skills/nevo-ai-spec-workflow/SKILL.md
    - .claude/skills/nevo-ai-spec-workflow/templates/review-report.md
    - docs/ai/specification-workflow.md
    - specs/active/nevo-ai-process-continuity-and-hardening/areas/batch-execution-and-gating-review.md
    - specs/active/nevo-ai-process-continuity-and-hardening/areas/context-and-validation-hardening.md
allowed_paths:
  - tools/specs.mjs
  - tools/specs/service.mjs
  - tools/specs/lifecycle.mjs
  - tools/tests/implementation-review.test.mjs
  - .claude/commands/nevo-ai/implementation-review.md
  - .claude/skills/nevo-ai-spec-workflow/SKILL.md
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

# Task: Implementation review orchestration

> New task, added 2026-08-05 (fifth refinement pass) — see `owner-decisions.md` D30.
> Added only after every other task in this change (01-11) reached `status: implemented`;
> this task does not reopen or rewrite any of them. It adds one new owner-facing entry
> point, `/nevo-ai:implementation-review`, orchestrating the existing
> `/nevo-ai:task-review` semantics across an owner-selected range or list of tasks, plus
> one new cross-task integration pass (reusing `batch-execution-and-gating-review`'s own
> diff-attribution/integration-finding functions) and one new atomic bulk status
> transition. `/nevo-ai:task-review` and `/nevo-ai:spec-audit` are unchanged.

## Goal

Implement `/nevo-ai:implementation-review <change-id> --all|--tasks <range-or-list>` —
exactly as specified in `areas/implementation-review-orchestration.md` — plus the
supporting `tools/specs.mjs` CLI surface (deterministic scope resolution, atomic bulk
status transition) it depends on, and update the shared review policy, skill, and
workflow documentation to describe this fourth review shape alongside the three that
already exist (`task-review`, `spec-audit`, the gating batch review).

## Dependencies

`state-and-fingerprint-semantics` — `change.yaml` structural-update helpers
(`setTaskStatus`-style single-write pattern) and the task file schema the atomic
bulk-transition operation and scope resolution both need. `scope-and-follow-up-mechanisms`
— `follow-ups.yaml`, read by the cross-task integration pass for open blocking entries
whose `source_task` falls inside the selected scope. `batch-execution-and-gating-review`
— this task's cross-task integration pass reuses `attributeTouchedPaths` and
`detectBatchIntegrationFindings` rather than reimplementing them; it must not run before
they exist. `workflow-docs-and-adr-migration` — this task extends
`references/review-policy.md`, `docs/ai/specification-workflow.md`, and `SKILL.md` on
top of the shared-doc/terminology/ADR baseline that task already finalized; running
before it would mean editing docs that task was still going to rewrite underneath it.

## Implementation constraints

- **Scope resolution is a new, read-only `tools/specs.mjs` subcommand** (e.g.
  `review-scope <change-id> --all` / `--tasks <spec>`), never parsed ad hoc by the
  command's own conversational flow. `<spec>` is a dash-separated order range (`01-03`)
  or a comma-separated order list (`01,03,07`), resolved against each task's own `order`
  field in `change.yaml`. Rejects, naming the specific problem: an order number that
  doesn't resolve to a real task; an inverted or empty range; or any resolved task whose
  `status` is `draft`, `approved`, or `abandoned` (not yet implemented, or dropped).
  `in-implementation`, `implemented`, `verified`, and `archived` are the eligible
  statuses. Prints the ordered, deduplicated task id list as JSON.
- **Per-task review is literal reuse of `task-review.md`'s own flow (steps 1-8), never a
  second implementation of the same comparison logic.** For each task in the resolved
  scope, in order: resolve context, read the existing `reviews/<task-id>.md` baseline (if
  any) before it's overwritten, inspect the diff, check `allowed_paths`/`forbidden_paths`,
  compare against acceptance criteria/area requirements/change-wide constraints/ADRs/
  architecture docs, classify every finding (same categories: `AUTO_FIX`/
  `OWNER_DECISION`/`NEEDS_CLARIFICATION`/`NON_BLOCKING`/`INFORMATIONAL`; same lifecycle
  axis against the baseline: `resolved`/`still-present`/`changed`/`cannot-verify`), offer
  the step 7a follow-up-recording choice, and write `reviews/<task-id>.md`. Stop after
  that write — do **not** run `task-review.md`'s step 9 (status-decision menu) or step
  9a0 (batch-continuation offer) per task; this orchestrator asks its own single bulk
  question at the very end instead (see below).
- **Bounded per-task context.** Delegate each task's review (previous bullet) to a fresh
  subagent invocation in Claude Code, so a completed task's full diff/file reads do not
  remain in the orchestrating context while the next task's review runs — only that
  task's finished `reviews/<task-id>.md` path plus a compact summary (verdict, blocking-
  finding count, non-blocking-finding count, blocking finding IDs) carries forward.
  Cursor/Copilot/any terminal-driven use achieves the same bound by running
  `task-review`'s flow once per task in a fresh session before moving to the next; state
  this explicitly in the command file so the constraint is checkable, not just implied.
- **Cross-task integration pass, once, after every per-task review in scope completes.**
  Compute the real diff across the resolved scope (`git.getChangedFiles`), attribute
  every changed file to every in-scope task whose `allowed_paths`/`consequential_paths`
  match it (`attributeTouchedPaths`), and detect a structured finding for every pair of
  in-scope tasks whose attributed touched paths overlap (`detectBatchIntegrationFindings`)
  — reused verbatim from `batch-execution-and-gating-review`, not reimplemented. Also
  check `follow-ups.yaml` for any open, `blocking`-severity entry whose `source_task`
  falls inside the resolved scope. Never re-evaluates any individual task's own
  acceptance criteria.
- **Overall verdict, computed from an explicit table** (add to
  `references/review-policy.md` § "Multi-task implementation review", new section,
  alongside the existing "Change-wide audits"/"Batch review" sections — same pattern,
  evaluated top to bottom, first match wins):

  | # | Condition | Verdict |
  |---|---|---|
  | 1 | `node tools/specs.mjs validate` (or `docs.mjs validate`, if any in-scope task's diff touches `docs/**`) fails | `blocked` |
  | 2 | Any selected task's own per-task verdict is `blocked` | `blocked` |
  | 3 | Any unresolved `OWNER_DECISION`/`NEEDS_CLARIFICATION` finding exists — per-task or cross-task integration (rows 1-2 don't apply) | `owner-decision-required` |
  | 4 | Any selected task's own verdict is `changes-required`, or an unresolved `AUTO_FIX` cross-task integration finding exists (rows 1-3 don't apply) | `changes-required` |
  | 5 | No unresolved blocking findings remain, at either level | `pass` |

  `NON_BLOCKING`/`INFORMATIONAL` findings never appear in this table, same rule as every
  other verdict table in this workflow.
- **Aggregate artifact**, written to
  `specs/active/<change-id>/reviews/implementation-review-<scope>.md` (`<scope>` = `all`
  for `--all`, or the resolved sorted dash-joined order list for `--tasks`, e.g.
  `01-03-07`) — distinct from `reviews/<task-id>.md`, `reviews/audit-<slug>.md`, and
  `reviews/batch-<id>.md`. Contains: the overall verdict; one section per selected task
  (its own verdict plus a reference to its `reviews/<task-id>.md`); each task's
  unresolved findings (ID, category, one-line summary — not the full per-task report
  re-embedded); the cross-task integration findings; the list of tasks eligible for
  verification; the list of tasks that must remain unchanged and why.
- **Eligibility for the bulk-verification offer**: a task's own verdict is `pass` **and**
  it carries zero unresolved blocking findings at either the per-task or the cross-task
  level. Every other selected task is "must remain unchanged" — its status is never
  touched, regardless of which bulk-confirmation option is chosen.
- **One closed confirmation, asked once, only when at least one task is eligible —
  never per task:**

  ```
  1. Mark every passing selected task as verified
  2. Mark every passing selected task as implemented/self-verified
  3. Leave all statuses unchanged
  ```

  If zero tasks are eligible, skip this prompt and say so in the chat summary.
- **Atomic bulk-transition CLI operation** (e.g.
  `bulk-transition <change-id> --tasks <id,id,...> --outcome self-verified|verified`),
  the single write path for this command. For each eligible task, computes the correct
  transition(s) from its *current* status to the chosen outcome: `self-verified` →
  `in-implementation` becomes `implemented`; already `implemented`/`verified` is a no-op
  (never regressed). `verified` → `in-implementation` becomes `implemented` then
  `verified` in the same operation; `implemented` becomes `verified`; already `verified`
  is a no-op. Runs the same hard-stop check `complete` already performs standalone for
  every task passing through the `implemented` transition. Validates every computed
  transition for every eligible task *before* writing anything; performs exactly one
  read-modify-write of `change.yaml` covering all of them together. If any computed
  transition is invalid, the whole operation is rejected — naming the offending task and
  why — with no task's status changed (all-or-nothing).
- **Re-review baseline.** Before writing a new
  `reviews/implementation-review-<scope>.md`, read its current content if a file at that
  exact `<scope>` already exists — that is the baseline for lifecycle classification of
  the cross-task integration findings, same rule `task-review`/`spec-audit` already
  follow. If none exists, say so verbatim, same wording convention as the other review
  commands. A run at a different `<scope>` string has no baseline of its own.
- Add the new `.claude/commands/nevo-ai/implementation-review.md` command file following
  `task-review.md`'s/`spec-audit.md`'s existing structure (frontmatter, `## Flow`,
  `## Rules`), referencing `references/review-policy.md` § "Multi-task implementation
  review" rather than restating the verdict table or chat-output shape inline.
- Update `.claude/skills/nevo-ai-spec-workflow/SKILL.md`: add
  `/nevo-ai:implementation-review` to the command table at the top of the file; add a row
  to "Status vocabulary per command" (`pass \| changes-required \|
  owner-decision-required \| blocked`); note in "Preventing premature implementation"
  that, like `task-review`/`spec-audit`, this command's own `reviews/implementation-
  review-<scope>.md` write is its one exception to read-only, and that it never applies
  a status transition without the one bulk confirmation.
- Update `docs/ai/specification-workflow.md` § "Review artifacts and handoff" with a new
  subsection (after "Batch review", before "Finalizing") describing this fourth review
  shape at the vendor-neutral level — file naming, verdict table, that it reuses
  `task-review`'s own per-task depth rather than redefining it, and the one bulk
  confirmation — mirroring how "Change-wide audits" and "Batch review" are already
  documented there. Add `/nevo-ai:implementation-review` to the Claude Code adapter list
  in § "Tool adapters".
- Add a "Multi-task implementation review" section to
  `references/review-policy.md` (after "Batch review") with the exact verdict table
  above and the chat output shape below; `templates/review-report.md` gains the
  aggregate-report shape if it diverges from the existing per-task/audit/batch shapes
  enough to need one.
- **Extend ADR-0006, don't write a new one.** Every durable decision this change has
  made (D3, D7-D29) is folded into `docs/decisions/ADR-0006-process-continuity-and-hardening.md` per task 11's own requirement; D30 is a new, durable decision (a new
  review shape and CLI surface, not a consistency correction) and belongs in the same
  ADR, since it is still the same change, not a new one. Add a "Multi-task implementation
  review orchestration (D30)" subsection to ADR-0006's "Decision" section covering: the
  new `/nevo-ai:implementation-review` command and its `--all`/`--tasks` scope; that it
  reuses `task-review`'s own per-task depth rather than redefining it; the cross-task
  integration pass reusing `batch-execution-and-gating-review`'s functions; the one
  atomic bulk-transition operation; and that `task-review`/`spec-audit` are unchanged.
  Update the ADR's "Context" paragraph, which currently describes this change as "eleven
  ordered tasks (01-11)," to also name task 12.
- **Chat output shape** (add to `references/review-policy.md`, same formatting rules as
  every other review command in that section):

  ```markdown
  ## Implementation review result

  **Verdict:** `<pass|changes-required|owner-decision-required|blocked>`

  - Tasks reviewed: **<comma-separated task ids>**
  - Eligible for verification: **<comma-separated task ids, or "none">**
  - Must remain unchanged: **<comma-separated task ids, or "none">**
  - Cross-task integration findings: **<count>**

  ### Required action

  <omit if none>

  **Report:** `<artifact path>`

  **Next command:**

  ​```text
  <exact command, or "No further action required.">
  ​```
  ```

## Acceptance criteria

1. `--tasks 01-03` and `--tasks 01,03,07` both resolve to the correct, deduplicated task
   id list via each task's `order` field; an unresolvable order number is reported by
   name, never silently dropped or included (automated).
2. A selected task whose status is `draft`, `approved`, or `abandoned` is rejected by
   scope resolution, naming the task and its ineligible status (automated).
3. The per-task review step produces the same finding categories and per-task verdict
   values `task-review` itself would produce for the same task/diff, and does not skip
   the baseline-lifecycle comparison when a prior `reviews/<task-id>.md` exists
   (automated + inspection).
4. No per-task status-decision prompt occurs during the orchestrated run — the only
   status-related prompt is the single end-of-run bulk confirmation (inspection of the
   command flow).
5. The cross-task integration pass detects an overlap between two in-scope tasks'
   attributed touched paths and does not report either task's own acceptance criteria as
   an integration finding (automated).
6. The overall verdict table matches its own truth table for every row, including that a
   single `blocked` per-task verdict forces the overall verdict to `blocked` regardless
   of every other task's outcome (automated).
7. A task with any unresolved blocking finding (per-task or cross-task) never appears in
   "tasks eligible for verification," and the bulk-confirmation menu is skipped entirely
   when the eligible set is empty (automated).
8. The bulk-transition CLI operation performs exactly one `change.yaml` write covering
   every eligible task's transition; an invalid computed transition for any one task
   rejects the whole operation with no task's status changed (automated).
9. A mixed-status eligible set (some `in-implementation`, some `implemented`) all reach
   the correct target status under the "verified" outcome in one operation, without
   regressing an already-`verified` task (automated).
10. A re-review at the same `<scope>` reads the previous
    `reviews/implementation-review-<scope>.md` as its baseline and classifies each
    previously-reported finding's lifecycle correctly; a run at a different `<scope>`
    reports no baseline available (automated).
11. `reviews/implementation-review-<scope>.md` is never written to a path colliding with
    `reviews/<task-id>.md`, `reviews/audit-<slug>.md`, or `reviews/batch-<id>.md`
    (inspection).
12. `references/review-policy.md`, `SKILL.md`, and `docs/ai/specification-workflow.md`
    all describe this fourth review shape, its verdict table, and that it does not
    replace `task-review` or `spec-audit` (inspection).
13. `node tools/specs.mjs check` and `node tools/docs.mjs check` report generated indexes
    as current after this task's doc edits (automated).
14. `node --test tools/tests/*.test.mjs` (the full suite, including this task's new
    `implementation-review.test.mjs`) passes (automated).
15. `docs/decisions/ADR-0006-process-continuity-and-hardening.md` covers D30 (a new
    subsection, not a new ADR) and its "Context" paragraph names task 12 alongside tasks
    01-11 (inspection).

## Verification

```
node --test tools/tests/implementation-review.test.mjs
node --test tools/tests/*.test.mjs
node tools/specs.mjs validate
node tools/specs.mjs check
node tools/docs.mjs validate
node tools/docs.mjs check
```

## Documentation impact

`docs/ai/specification-workflow.md`, `.claude/skills/nevo-ai-spec-workflow/SKILL.md`,
`.claude/skills/nevo-ai-spec-workflow/references/review-policy.md`,
`.claude/skills/nevo-ai-spec-workflow/templates/review-report.md` (if the aggregate shape
needs one), new `.claude/commands/nevo-ai/implementation-review.md`,
`docs/decisions/ADR-0006-process-continuity-and-hardening.md` (new D30 subsection,
context paragraph updated to name task 12).

## Out of scope

- Replacing or weakening `/nevo-ai:task-review` or `/nevo-ai:spec-audit` — both are
  unchanged by this task.
- Reopening, rewriting, or re-scoping tasks 01-11's own task/area files.
- Parallel or concurrent task review.
- A per-task status decision during the orchestrated run.
- Reviewing tasks outside the owner-selected scope, or across other active changes.
- A second, duplicated progress-tracking file — the resolved scope and every verdict
  live in the one regenerated aggregate report.
- A new finding category or per-task verdict value beyond what
  `references/review-policy.md` already defines.
