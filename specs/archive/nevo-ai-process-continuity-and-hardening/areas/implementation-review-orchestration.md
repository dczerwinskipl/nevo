# Area: Implementation review orchestration

> New area, added 2026-08-05 per owner decision D30 — a fifth refinement pass, made
> after every other task in this change (01-11) already reached `status: implemented`.
> This area does not reopen or weaken any of them; it adds one new owner-facing entry
> point that orchestrates the existing task-level `/nevo-ai:task-review` semantics across
> a selected range or list of already-implemented tasks, plus one new cross-task
> integration pass and one new bulk status-transition mechanism.

## Responsibility

Own `/nevo-ai:implementation-review <change-id> --all|--tasks <range-or-list>` — a
multi-task review orchestrator that runs the same review depth `/nevo-ai:task-review`
already performs, once per selected task, sequentially and with bounded per-task
context; then runs one cross-task integration pass over the selected scope; then
produces one aggregate review artifact; then, once, offers a single bulk status
confirmation for every task that passed. Distinct from all three existing review shapes:

| Shape | Scope | Re-checks a task's own acceptance criteria? | Gates? |
|---|---|---|---|
| `task-review` | One task's diff | Yes, in depth | Yes, that task's own status |
| `spec-audit` | One named cross-cutting lens across a change | No | No — advisory only |
| Gating batch review (`batch-execution-and-gating-review`) | One batch's whole diff since `startRevision` | No — trusts each task's own self-check/review | Yes, the batch's completion |
| **Implementation review orchestration (this area)** | An owner-selected range or list of already-implemented tasks | **Yes, in depth, per task — by literally running `task-review`'s own flow once per task** | Yes, but only the tasks that individually pass, and only after one explicit bulk confirmation |

## Current state

No command reviews more than one task per invocation today. `task-next` returns exactly
one task. `spec-audit` explicitly never re-evaluates a task's own acceptance criteria.
The gating batch review (task 08) does the same — it trusts each batched task's own
self-check/review and only adds a cross-task integration pass. Nothing in the current
process lets an owner ask "review tasks 1 through 3 (or 1, 3, and 7) against their own
acceptance criteria, one at a time, then tell me what's safe to mark verified" without
either invoking `task-review` N separate times (N separate conversational turns, N
separate status-decision prompts) or reaching for the deliberately non-gating
`spec-audit`, which cannot apply a status transition at all.

## Requirements

1. **Command surface.** `/nevo-ai:implementation-review <change-id> --all` or
   `/nevo-ai:implementation-review <change-id> --tasks <spec>`, where `<spec>` is either
   a dash-separated order range (`01-03`) or a comma-separated order list (`01,03,07`),
   using each task's own `order` field in `change.yaml` (the same numbering already
   visible in every `tasks/NN-*.md` filename in this change) — never a task id list, so
   the owner can select by the numbering they already see in the file tree. No default:
   the command requires exactly one of `--all`/`--tasks`, same "no implicit default"
   principle as batch selection (D20).
2. **Deterministic scope resolution, CLI-backed, not agent-parsed.** A new read-only
   `tools/specs.mjs` subcommand resolves `--all`/`--tasks` into an ordered, deduplicated
   list of task ids before any review work starts, and rejects the whole invocation
   (naming the specific problem) if: an order number in `--tasks` does not resolve to a
   real task in this change; a range's bounds are out of order or resolve to zero tasks;
   or any resolved task's own `status` is `draft`, `approved`, or `abandoned` (nothing to
   review yet, or explicitly dropped work) — `in-implementation`, `implemented`,
   `verified`, and `archived` are the four eligible statuses, since each has a real diff
   this command can evaluate.
3. **Task-level review reuses `task-review`'s own flow verbatim, not a rebuilt or
   weakened variant.** For each task in the resolved scope, in order: run exactly
   `/nevo-ai:task-review <change-id> <task-id>`'s steps 1-8 (context resolution, baseline
   read, diff inspection, `allowed_paths`/`forbidden_paths` check, acceptance-criteria/
   area/constraint/ADR/architecture-doc comparison, finding classification with lifecycle
   status against that task's own prior `reviews/<task-id>.md` baseline if one exists,
   the step 7a follow-up-recording offer, and writing `reviews/<task-id>.md`) — **skip
   only step 9 onward** (the per-task status-decision menu and the batch-continuation
   offer, requirement 4 below). This is reuse, not reimplementation: the orchestrator
   must not duplicate task-review's comparison logic in a second place that could drift
   from it.
4. **No per-task status decision.** The orchestrator never asks "mark this task
   implemented/verified/leave as-is" between tasks — that question is asked exactly once,
   at the end, over the whole passing subset (requirement 9).
5. **Bounded per-task context.** Full diffs, full file reads, and full acceptance-
   criteria comparisons for one task must not remain loaded while the next task's review
   runs — only that task's finished `reviews/<task-id>.md` and a compact summary
   (verdict, blocking-finding count, non-blocking-finding count, blocking finding IDs)
   carry forward into the aggregate step. In Claude Code, delegate each task's review
   (requirement 3) to a fresh subagent invocation so per-task context is bounded by
   construction, not by discipline; Cursor/Copilot/any terminal-driven use achieves the
   same bound by running `task-review`'s flow once per task in a fresh session/context
   before moving to the next.
6. **Same finding taxonomy and per-task verdict semantics as `task-review` — no new
   ones invented for the per-task pass.** `AUTO_FIX` / `OWNER_DECISION` /
   `NEEDS_CLARIFICATION` / `NON_BLOCKING` / `INFORMATIONAL` categories, `pass` /
   `changes-required` / `blocked` per-task verdict, exactly as
   `references/review-policy.md` § "Findings must be actor-classified" and
   `task-review.md` already define. This area does not redefine either.
7. **Cross-task integration pass, once, after every per-task review in scope is
   complete.** Reuses the same real mechanism the gating batch review (task 08) already
   built rather than inventing a second one: `git.getChangedFiles` for the actual diff
   across the resolved scope, `attributeTouchedPaths` to assign each changed file to
   every in-scope task whose `allowed_paths`/`consequential_paths` match it, and
   `detectBatchIntegrationFindings` to report a structured finding for every pair of
   in-scope tasks whose attributed touched paths actually overlap — classified per
   requirement 6's same taxonomy (an unexplained overlap is `AUTO_FIX`/`OWNER_DECISION`
   depending on severity, exactly as the gating batch review already classifies it, not
   a new category). Also checks open `blocking`-severity `follow-ups.yaml` entries whose
   `source_task` falls inside the resolved scope. **Never re-evaluates any individual
   task's own acceptance criteria** — that was already done in requirement 3, per task.
8. **One aggregate review artifact**, containing: the overall verdict (requirement 10);
   one section per selected task naming that task's own verdict and a link/reference to
   its `reviews/<task-id>.md`; each task's unresolved findings (by ID, category, and
   one-line summary — not the full per-task report re-embedded); the cross-task
   integration findings from requirement 7; the list of tasks eligible for verification
   (requirement 9); and the list of tasks that must remain unchanged and why (requirement
   9). Written to `specs/active/<change-id>/reviews/implementation-review-<scope>.md`,
   where `<scope>` is `all` for `--all` or the resolved, sorted, dash-joined order list
   for `--tasks` (e.g. `01-03-07`) — distinct from `reviews/<task-id>.md`,
   `reviews/audit-<slug>.md`, and `reviews/batch-<id>.md`, so the four review shapes
   never collide on a filename.
9. **A task is eligible for the bulk verification offer only when its own verdict is
   `pass` and it carries zero unresolved blocking findings (`AUTO_FIX`/`OWNER_DECISION`/
   `NEEDS_CLARIFICATION` at either the per-task or the cross-task-integration level).**
   Every other selected task — `blocked`, `changes-required`, or `pass` but implicated in
   an unresolved cross-task integration finding — is listed as "must remain unchanged":
   its status is never touched by this command, regardless of which bulk-confirmation
   option the owner picks. This is a hard rule, not a per-run judgment call.
10. **Overall verdict, computed from an explicit table, never composed as prose** (same
    principle as every other verdict in this workflow — see
    `references/review-policy.md` § "Multi-task implementation review" for the exact
    table this area's task implements): `blocked` \| `owner-decision-required` \|
    `changes-required` \| `pass`, in that priority order. `NON_BLOCKING`/`INFORMATIONAL`
    findings never move the verdict, exactly as in every other table in this workflow.
11. **One closed confirmation, asked once, only when at least one task is eligible
    (requirement 9) — never per task:**

    ```
    1. Mark every passing selected task as verified
    2. Mark every passing selected task as implemented/self-verified
    3. Leave all statuses unchanged
    ```

    If zero tasks are eligible, skip this prompt entirely (nothing to confirm) and say
    so in the chat summary. Options 1/2 apply only to the eligible subset — never to a
    task listed as "must remain unchanged" (requirement 9), even under the same
    invocation.
12. **The chosen transition is applied through one deterministic, atomic bulk CLI
    operation — never one `complete`/`verify` call per task.** A new
    `tools/specs.mjs` subcommand computes, for every eligible task, the correct
    per-task transition(s) given its *current* status and the chosen outcome (option 2,
    "implemented/self-verified": `in-implementation` → `implemented`; a task already
    `implemented`/`verified` is a no-op, never regressed. Option 1, "verified":
    `in-implementation` → `implemented` → `verified` in the same operation;
    `implemented` → `verified`; a task already `verified` is a no-op) — validates every
    computed transition (including the same hard-stop check `complete` already performs
    standalone) *before* writing anything, and performs exactly one read-modify-write of
    `change.yaml` covering every eligible task's transition together. If any computed
    transition is invalid, the whole operation is rejected — naming the offending task
    and why — and **no** task's status is written, not even the ones that would have
    succeeded (all-or-nothing, not best-effort).
13. **Re-review uses the previous aggregate report as its baseline (mirrors
    `task-review`/`spec-audit`'s own re-review rule, § "Re-review: current file contents
    are the source of truth").** Before writing a new
    `reviews/implementation-review-<scope>.md`, read its current content if it already
    exists at the same `<scope>` — that is the baseline for lifecycle classification
    (`resolved`/`still-present`/`changed`/`cannot-verify`) at the aggregate level (cross-
    task integration findings) exactly as it already works at the per-task level
    (requirement 3, inherited from `task-review`'s own baseline rule). If no such file
    exists yet, say so verbatim, same wording convention as every other review command.
    A different `<scope>` string has no baseline of its own — running `--all` after a
    prior `--tasks 01-03` run is a fresh audit at the `all` scope, not a diff against the
    narrower one.
14. **Never replaces or weakens `task-review` or `spec-audit`.** Both commands are
    unchanged by this area — this command is a third, additive entry point that
    orchestrates `task-review`'s own per-task depth across a range, it does not fold
    `task-review` into itself or duplicate `spec-audit`'s thematic, non-gating shape.

## Semantic integration and consolidated decisions (task 16, D34/D35, seventh refinement pass)

> Extends requirements 7-11 above rather than replacing them. Requirement 7's cross-task
> integration pass, as shipped by task 12, detects exactly one structural signal:
> literal overlap between two tasks' actually-changed files
> (`detectBatchIntegrationFindings`). Confirmed during discovery for this pass: no code
> anywhere checks dependency-contract compliance, semantic-reference consistency, public
> CLI/interface changes, shared schema/state-shape, lifecycle-transition correctness,
> producer/consumer relationships, error/recovery contracts, guard/side-effect ordering,
> or documentation contracts as part of the integration pass. Task 16 adds a bounded
> semantic pass over relevant task pairs/components without re-grading any individual
> task's own acceptance criteria (requirement 7's own boundary, unchanged).

15. **Path overlap is a review candidate, not a defect** — restates requirement 7's
    existing classification (an overlap is `AUTO_FIX`/`OWNER_DECISION` depending on
    severity, never an automatic blocking finding by itself) so task 16's expanded
    signal set is read against the same rule, not a stricter one.
16. **Bounded semantic integration pass, selected from named signal categories** — for
    task pairs or connected components with a real relationship (not every pair in the
    scope; selection follows requirement 7's existing overlap detection *plus* any pair
    sharing a `semantic_references.dependency_contracts`/`decisions` entry), check:
    dependency contracts (does the depended-on task's contract still hold as the
    dependent task assumed), semantic references (D18 — do both tasks' declared
    references remain mutually consistent), public CLI changes (a flag/subcommand one
    task added or changed that another task's own acceptance criteria assumed a
    different shape for), shared schemas/state (`change.yaml` field shapes, persisted
    block schemas two tasks both write), lifecycle transitions (two tasks' status/
    transition assumptions about each other), producer/consumer relationships (one
    task's output is another's declared input), error/recovery contracts (`REC-xx`
    scenarios or postcondition contracts two tasks both touch), guard/side-effect
    ordering (does one task's guard sequence still hold given another task's changes),
    documentation contracts (do both tasks' doc edits agree), consequential paths
    (generated-file regeneration two tasks both trigger), and shared files (requirement
    7's existing check, unchanged). This is a bounded, targeted inspection over
    identified pairs/components — not a full re-read of every task's own diff a second
    time.
17. **Never re-grades an individual task's own acceptance criteria** — restates
    requirement 7's existing boundary; task 16 only adds signal categories to what is
    inspected between tasks, not a second AC-grading pass within one task.
18. **Findings only for real semantic inconsistencies** — a signal in requirement 16's
    list that, on inspection, does not actually conflict (e.g. two tasks both add CLI
    flags to different subcommands with no interaction) produces no finding at all —
    never a synthetic `INFORMATIONAL` entry recording that the signal was checked and
    found clean (mirrors task 13/14's "no synthetic informational findings" rule,
    applied here to the integration pass specifically).
19. **Per-task reviewer structured return data, completed.** Each per-task
    `task-review` run (requirement 3, reused verbatim) already returns verdict, AC
    covered/total, and a blocking-finding count/list to the aggregate step
    (requirement 5/8). Task 16 completes the structured contract with the remaining
    fields the aggregate step must carry forward explicitly rather than re-deriving:
    task ID; verdict; AC covered/total; scope status; blocking findings (unchanged);
    **pending owner decisions** (unresolved `OWNER_DECISION` findings, as a distinct
    list, not folded into the blocking-finding count); **pending scope decisions**
    (unresolved scope-exception-eligible findings, task 13, as a distinct list);
    **clarification requests** (unresolved `NEEDS_CLARIFICATION` findings, as a
    distinct list — previously only counted toward the overall verdict table, never
    itself surfaced as reviewable data); **follow-up candidates** (any item the
    per-task step 7a offer recorded or declined, named so the aggregate step can show
    it without re-deriving it); the review artifact path (unchanged); and the
    **implementation fingerprint** (`computeImplementationFingerprint`, wired to real
    data by task 15 — previously absent from every per-task return and every report
    field entirely).
20. **Per-task reviewers never ask the owner anything** — restates requirement 4's
    existing rule (no per-task status prompt) and extends it explicitly to pending
    owner/scope decisions and clarification requests (requirement 19): every one of
    those is *collected*, not *asked about*, during the per-task pass; the owner sees
    them exactly once, at the consolidated stage (requirement 21). **This supersedes
    requirement 3's per-task reuse of `task-review`'s step 7a follow-up-recording offer,
    specifically within `implementation-review`'s own orchestration** — task 16 changes
    `implementation-review.md` so that, when it runs `task-review`'s steps 1-8 per task
    (requirement 3), it collects any step-7a-eligible follow-up candidate into that
    task's structured return (requirement 19's `followUpCandidates` field) instead of
    presenting the offer inline; the candidate is then offered once, for every task
    together, at the consolidated stage. `task-review` run standalone (not through
    `implementation-review`) is unaffected — its own step 7a offer is unchanged, still
    presented per task, exactly as task 12 originally shipped it. This is a narrow,
    named behavioral change to `implementation-review.md`'s own flow, not an edit to
    task 12's task file or to `task-review.md` itself.
21. **One consolidated stage after every task and the integration pass complete** —
    replaces requirement 11's "one closed confirmation ... only when at least one task
    is eligible" with a single stage carrying three parts in the same turn: (a) every
    required owner decision and scope decision collected across every reviewed task
    (requirement 19) and the integration pass (requirement 16), presented together,
    per `references/decision-policy.md`; (b) optional follow-up choices (accept/decline
    each collected follow-up candidate, requirement 19) offered together, not per task;
    (c) requirement 11's existing bulk status-transition menu, asked once, after (a) and
    (b) are resolved in the same turn. No per-task status prompt and no per-task
    follow-up prompt — restates and generalizes requirements 4/11 into one owner-facing
    interaction covering the whole run, not just the status transition.

## Constraints

- Never ask for a per-task status decision (requirement 4) — exactly one bulk
  confirmation, at the end, over the eligible subset only.
- Never let the cross-task integration pass re-evaluate an individual task's own
  acceptance criteria (requirement 7) — that boundary is as firm here as it already is
  for the gating batch review and for `spec-audit`.
- Never apply a status transition to a task carrying an unresolved blocking finding
  (requirement 9), regardless of which bulk-confirmation option is chosen.
- Never write more than one `change.yaml` update for the whole bulk transition
  (requirement 12) — no per-task write loop.
- Never invent a new finding category or per-task verdict value beyond what
  `references/review-policy.md` already defines (requirement 6).
- Never reopen, rewrite, or weaken tasks 01-11's own task files, area files, or their
  already-written `reviews/<task-id>.md` content as a side effect of this area's work —
  this area only adds new shared-doc sections and new CLI surface, on top of the
  already-implemented mechanisms it reuses.

## Interfaces and boundaries

Exposes: the `--all`/`--tasks` scope-resolution CLI helper (requirement 2), the
sequential bounded-context per-task review loop (requirements 3-6, reusing
`task-review`'s own flow), the cross-task integration pass (requirement 7, reusing
`attributeTouchedPaths`/`detectBatchIntegrationFindings` from
`areas/batch-execution-and-gating-review.md`), the aggregate verdict table and report
shape (requirements 8-10), the one bulk confirmation (requirement 11), and the atomic
bulk-transition CLI operation (requirement 12).

Consumes: `task-review.md`'s own flow (steps 1-8, requirement 3) without modifying it;
`batch-execution-and-gating-review`'s diff-attribution and integration-finding functions
(requirement 7); `scope-and-follow-up-mechanisms`' `follow-ups.yaml` (requirement 7's
blocking-follow-up check); `state-and-fingerprint-semantics`' task file schema and
`change.yaml` structural-update helpers (requirement 12's atomic write); the terminology,
ADR, and shared-doc baseline `workflow-docs-and-adr-migration` (task 11) already
established, since this area extends the same shared files task 11 last finalized.

## Area-specific acceptance criteria

- A test proves `--tasks 01-03` and `--tasks 01,03,07` both resolve to the correct,
  deduplicated task id list via each task's `order` field, and that an unresolvable
  order number is reported by name, never silently dropped or included.
- A test proves a selected task whose status is `draft`, `approved`, or `abandoned` is
  rejected by scope resolution, naming the task and its ineligible status.
- A test proves the per-task review step never re-derives comparison logic independently
  of `task-review`'s own criteria — same finding categories, same per-task verdict
  values, produced against the same acceptance-criteria/area/constraint/ADR inputs.
- A test proves the cross-task integration pass detects an overlap between two in-scope
  tasks' attributed touched paths and does not re-report either task's own acceptance
  criteria as an integration finding.
- A test proves the overall verdict table (requirement 10) matches its own truth table
  for every row, including that a single `blocked` per-task verdict forces the overall
  verdict to `blocked` regardless of every other task's outcome.
- A test proves a task with any unresolved blocking finding (per-task or cross-task) is
  never included in "tasks eligible for verification," and that the bulk-confirmation
  menu is skipped entirely when the eligible set is empty.
- A test proves the bulk-transition CLI operation performs exactly one `change.yaml`
  write covering every eligible task's transition, and that an invalid computed
  transition for any one task rejects the whole operation with no task's status changed.
- A test proves a mixed-status eligible set (some `in-implementation`, some
  `implemented`) all reach the correct target status under the "verified" outcome in one
  operation, without regressing an already-`verified` task.
- A test proves a re-review at the same `<scope>` reads the previous
  `reviews/implementation-review-<scope>.md` as its baseline and classifies each
  previously-reported finding's lifecycle correctly, while a run at a different `<scope>`
  reports no baseline available.
- A test proves the semantic integration pass (requirement 16) detects at least one
  real cross-task inconsistency for a fixture pair sharing a `semantic_references`
  entry (e.g. a dependency contract one task assumed that the other task's own change
  actually breaks), and produces zero findings for a fixture pair with no real
  relationship despite touching the same signal category.
- A test proves each per-task structured return (requirement 19) carries pending owner
  decisions, pending scope decisions, and clarification requests as distinct lists
  (never folded into the blocking-finding count) and a non-null implementation
  fingerprint once task 15's provenance data exists for that task.
- A test proves the consolidated stage (requirement 21) presents owner/scope decisions,
  follow-up choices, and the bulk-transition menu together in one turn, and that no
  per-task prompt of any kind occurs between individual task reviews.

## Dependencies

`state-and-fingerprint-semantics` (task 01) — `change.yaml` structural-update helpers and
task file schema the atomic bulk-transition operation (requirement 12) and scope
resolution (requirement 2) both read/write. `scope-and-follow-up-mechanisms` (task 06) —
`follow-ups.yaml`, read by the cross-task integration pass (requirement 7).
`batch-execution-and-gating-review` (task 08) — the diff-attribution and
integration-finding functions this area's cross-task pass reuses rather than
reimplementing (requirement 7). `workflow-docs-and-adr-migration` (task 11) — this area
extends `references/review-policy.md`, `docs/ai/specification-workflow.md`, and
`.claude/skills/nevo-ai-spec-workflow/SKILL.md` on top of the shared-doc/terminology/ADR
baseline task 11 already established; starting before task 11 would mean editing docs
task 11 was still going to rewrite. Task 16 (requirements 15-21) additionally depends on
`review-report-compaction-and-scope-exceptions` (task 13, for the scope-decision
collection it folds into the consolidated stage) and
`deterministic-implementation-provenance` (task 15, for the implementation fingerprint
requirement 19 now requires) — task 16 is a separate task, not folded into task 12,
because it was requested after task 12 reached `verified`, per the same "new task, not a
reopened one" convention D30/D31 already established.

## Out of scope

- Replacing or weakening `/nevo-ai:task-review` or `/nevo-ai:spec-audit` (requirement 14).
- Parallel or concurrent task review.
- A per-task status decision during the orchestrated run (requirement 4).
- Reviewing tasks outside the owner-selected scope (`--all` still means "every eligible
  task in this change," never a repository-wide scan across other active changes).
- Any second, duplicated progress-tracking file — this area has no persisted intent file
  of its own; the resolved scope, per-task verdicts, and aggregate verdict all live in
  the one aggregate report artifact (requirement 8), regenerated on every run.
- Inventing a new finding category or per-task verdict distinct from what
  `references/review-policy.md` already defines (requirement 6).
