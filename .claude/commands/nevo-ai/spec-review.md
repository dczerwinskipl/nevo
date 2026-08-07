---
description: Read-only implementation-readiness review of a NEvo specification.
argument-hint: <change-id> [--all|--changed|--tasks <range-or-list>]
disable-model-invocation: true
---

Read the shared skill `nevo-ai-spec-workflow` (`.claude/skills/nevo-ai-spec-workflow/SKILL.md`)
if not already in context, plus `references/review-policy.md`.

Arguments (`$ARGUMENTS`): `<change-id> [--all|--changed|--tasks <range-or-list>]`.
`--all` (also the default when no flag is given — full compatibility with every
existing invocation and doc reference to `/nevo-ai:spec-review <change-id>`) reviews
every task. `--changed` (D34/D35, task 17) reviews only new or semantically changed
tasks — those whose current `computeTaskFingerprint` doesn't match the fingerprint the
prior review recorded for them. `--tasks <spec>` reviews an explicit order range
(`14-17`) or order list (`14,16,18`), same grammar `/nevo-ai:implementation-review`
already uses. At most one of `--changed`/`--tasks` may be given; giving both is an
error, not a silent pick of one.

## Scope resolution (D34/D35, task 17)

0. Resolve the scope **before** step 1 touches anything. Run
   `node tools/specs.mjs fingerprint <change-id> --task <task-id>` for every task from
   task 12 onward (D32 grandfathers tasks 01-11 out of this entirely, same exemption
   step 5a already uses) to get `currentTaskFingerprints`, and read the prior
   `reviews/spec.md`'s `task_fingerprints` map (if any) as `priorTaskFingerprints`. Call
   `resolveSpecReviewScope(change, { all, tasks, changed, changedTaskIds })`
   (`tools/specs/lifecycle.mjs`) — for `--changed`, `changedTaskIds` comes from
   `selectChangedTaskIds(evaluableTaskIds, priorTaskFingerprints,
   currentTaskFingerprints)` first. If resolution fails (zero or more than one mode
   given, an unresolvable `--tasks` order number), relay the exact reason and stop.
   **Review scope is separate from context scope** — reading an already-reviewed task's
   file for background (e.g. to understand a new task's dependency) never re-grades that
   task, never regenerates its verdict, never replaces its `task_fingerprints` entry,
   and never changes its `status` or adds it to this run's selected scope; only the
   deterministic write in step 9 ever persists those fields, and only for tasks in the
   resolved scope.

## Flow

1. Resolve `<change-id>` under `specs/active/`.
2. Check whether `specs/active/<change-id>/reviews/spec.md` already exists. If it does,
   **read its full current content now, before anything else touches it** — this is the
   baseline for this run, per `references/review-policy.md` § "Re-review: current file
   contents are the source of truth, not git status or memory." If it doesn't exist,
   there is no baseline; the final response must include, verbatim, "No reliable
   previous-file baseline is available. Performing a fresh review of the current
   specification." **Do not consult `git status` or `git diff` to decide whether
   anything changed — that signal is not part of this mechanism, ever** (an untracked
   directory carries zero file-level diff information, which is exactly how a past
   re-review went stale).
3. Read `change.yaml`, `overview.md`, and every `areas/` file in full, fresh — regardless
   of what step 2 found, regardless of git status, regardless of scope; these establish
   context and cross-task dependency correctness even for a scoped run. For `tasks/`:
   read every task in the resolved scope (step 0) in full, fresh — the same "no
   shortcut" rule as always. A task **outside** the resolved scope is read only as much
   as genuinely needed for context (e.g. understanding a dependency an in-scope task
   relies on) — reading it never re-grades it, per step 0's context-vs-review-scope
   boundary.
4. Run `node tools/specs.mjs validate` (and `node tools/docs.mjs validate` if the change
   touches docs) — these are the **gating** checks; do not re-derive them by hand. If
   either fails, the verdict is `blocked` — stop there, don't continue evaluating
   readiness on top of a structurally broken spec. Also run `node tools/specs.mjs check` and `node tools/docs.mjs check` — these are **non-gating**: they check
   whether *repository-wide* generated indexes are current, which can fail because of
   an unrelated active change, not this one. Record the result as an `INFORMATIONAL`
   finding either way, explicitly labeled "Gating validation: passed/failed" vs.
   "Non-gating repository check: passed/failed" with a reason if failed — never let a
   `check` failure change the verdict, and never present the two together in a way
   that leaves the reader guessing which one mattered (see `references/review-policy.md`
   § "Gating versus non-gating checks").
5. Evaluate readiness per `references/review-policy.md` — "Specification readiness
   criteria" — covering blocking issues, owner decisions still required, ambiguity/
   assumption risks, architecture conflicts, acceptance-criteria quality, task
   decomposition quality, task dependency correctness, context-packet quality,
   allowed/forbidden-path quality, and documentation/ADR impact. For any gated decision
   in the spec (per `AGENTS.md` owner-approval list), check specifically that a real
   option analysis exists — `references/solution-option-analysis.md` — not just a
   single proposed approach; record its absence as an `OWNER_DECISION` or
   `NEEDS_CLARIFICATION` finding (whichever fits — see below).
5a. **Semantic-reference completeness (D26, D29).** For every task **in the resolved
   scope** (step 0) — never an out-of-scope task, per the context-vs-review-scope
   boundary — run the model-review check in `references/review-policy.md` §
   "Semantic-reference completeness (model review)" — this is separate from, and in
   addition to, `node tools/specs.mjs validate`'s own deterministic reference-*integrity*
   checks (step 4); neither
   substitutes for the other. Categorize a missing, load-bearing reference as `AUTO_FIX`
   (unambiguous which one) or `OWNER_DECISION` (ambiguous) — never `NON_BLOCKING`; an
   unnecessary (declared but not load-bearing) reference may stay `NON_BLOCKING`. An
   unresolved missing-reference finding blocks `ready-for-approval` exactly like any
   other unresolved `AUTO_FIX`/`OWNER_DECISION` finding in the decision table below —
   no separate mechanism, just this categorization feeding the existing one.
6. Classify every current finding per `references/review-policy.md` § "Findings must be
   actor-classified" (`AUTO_FIX` / `OWNER_DECISION` / `NEEDS_CLARIFICATION` /
   `NON_BLOCKING` / `INFORMATIONAL`). If step 2 found a baseline, additionally verify
   the **exact literal predicate** of every baseline finding against the content just
   re-read in step 3 (not against memory of what the predicate probably still says),
   and assign a lifecycle status (`resolved` / `still-present` / `changed` /
   `cannot-verify`) per `references/review-policy.md` § "Findings have a lifecycle, on
   top of their actor category." A finding recorded in `owner-decisions.md` as answered
   is `resolved`, not repeated as an unanswered `OWNER_DECISION`. If any
   `OWNER_DECISION`/`NEEDS_CLARIFICATION` finding could be presented as deferrable, name
   its structural consequence per § "Deferring an owner decision has a structural
   consequence, name it" — never "resolve it, or defer it" as if deferring alone clears
   it.
7. Compute the verdict and the `ready_for_approval`/`implementation_allowed` booleans
   **by running the decision table** in `references/review-policy.md` § "The decision
   table," using only this run's unresolved findings (never a carried-forward previous
   verdict) — do not compose the verdict as a sentence. Row 2 of that table covers both
   `OWNER_DECISION` and `NEEDS_CLARIFICATION` findings together, but count them
   **separately** for the report (three distinct counts: required fixes, owner
   decisions, needs-clarification — never merged into one number). Run the consistency
   validation in that same section, including the re-review checks, before continuing;
   if it fails, a classification or a file read upstream is wrong — fix it and
   recompute, don't emit a report that fails its own check. Answer the three
   implementation-readiness questions from § "Implementation readiness declaration."
7a. **Scoped-verdict guard (D34/D35, task 17) — only for a run that is not `--all`.**
    Before the verdict can read `ready-for-approval`/`approved-for-implementation`, run
    `scopedReviewBaselineValid(checkableOutOfScopeTaskIds, priorTaskFingerprints,
    currentTaskFingerprints)` (`tools/specs/lifecycle.mjs`) over every out-of-scope task
    from task 12 onward (same D32 exemption as step 5a). If `valid` is `false`, the
    verdict cannot claim whole-change readiness — report the named `invalidTaskIds` and
    recommend scope expansion (a wider `--tasks`/`--all` re-run) as the next command,
    even though the *selected* scope's own findings might otherwise be clean. Also run
    `findPotentiallyImpactedOutOfScopeTasks(selectedTaskIds, taskDependencyContracts)` —
    name any result explicitly in the report as "potentially impacted, not re-reviewed in
    this scope," and offer scope expansion; never silently include or silently ignore it.
8. Run `node tools/specs.mjs fingerprint <change-id>` and use its exact printed output
   as the `spec_fingerprint` value in the report's frontmatter — never estimate or
   recompute this by reasoning (see `references/review-policy.md` § "Deterministic
   review freshness"). Then, for every task evaluated in step 5a, run
   `node tools/specs.mjs fingerprint <change-id> --task <task-id>` and record its exact
   printed output under `task_fingerprints.<task-id>` — same rule, never estimated (see
   that section's "Task-level freshness" subsection for why this is separate from
   `spec_fingerprint`). Run both *after* step 3's re-read, immediately before writing
   the report, so they reflect exactly what was reviewed.
9. Write the full report to `specs/active/<change-id>/reviews/spec.md` using
   `templates/review-report.md`'s shape (create the `reviews/` directory if needed),
   including the frontmatter `verdict`, `ready_for_approval`, `implementation_allowed`,
   `spec_fingerprint`, `task_fingerprints`, and the three separate unresolved counts, and
   — per finding — its predicate, lifecycle, and evidence. Name any
   `findPotentiallyImpactedOutOfScopeTasks` result (step 7a) explicitly, and, for a
   scoped run whose result is fully passing, render the body with
   `renderScopedSpecReviewBody` (task 14/17's compact shape, task 14, D34/D35) instead of
   composing it as prose — `--all`'s own report shape is unchanged. This overwrites the
   file read in step 2; that's expected, it's the one file this command writes —
   everything else about the change stays untouched.
10. End the response using `references/review-policy.md` § "Chat output shape" →
    `/nevo-ai:spec-review`'s exact required shape. `Next command` is:
    - `blocked` → the specific manual fix needed before any command can proceed,
    - `owner-decision-required` → the exact decision(s) needed, one per finding ID, not
      `/nevo-ai:spec-refine --from-review` (that command stops at these findings too —
      don't send the owner in a circle),
    - `changes-required` → `/nevo-ai:spec-refine <change-id> --from-review`,
    - step 7a found an invalid out-of-scope baseline → the exact scope-expansion command
      (a wider `--tasks` or `--all` re-run) naming the invalidated task(s), even if this
      run's own selected-scope findings are otherwise clean,
    - `ready-for-approval` → see step 10a below — do not just print
      `/nevo-ai:spec-approve <change-id> <task-id>` and stop; offer it inline, in the
      same turn,
    - `approved-for-implementation` → `/nevo-ai:task-next`.
10a. **Inline approval offer at `ready-for-approval` (D3, requirement 1).** This is an
    *additional* entry point into `/nevo-ai:spec-approve`'s own unchanged gate, not a
    bypass of it — reuse that command's own confirmation and CLI call rather than
    re-implementing an approval prompt here. Concretely: present exactly
    `/nevo-ai:spec-approve <change-id> <task-id>`'s own Flow step 3 menu (all four
    options — approve / approve and start / keep as draft / show report) in this same
    turn, and on an answer, follow that command's Flow step 4 (and, for option 2, its
    "Approve and start" section) exactly — including `node tools/specs.mjs approve`'s own
    fresh fingerprint/verdict re-check, which still runs and is still what actually
    enforces the gate (AC3 — this command's own judgment never substitutes for it, even
    though the verdict was just computed in step 7). One decision point total: this menu
    *is* the approval confirmation, not a wrapper prompting whether to see another one.

## Rules

- This command is **read-only with respect to the change being reviewed** — it never
  edits `change.yaml`, `overview.md`, `areas/`, or `tasks/`. Writing its own
  `reviews/spec.md` (step 8) is the one exception, not a loophole to edit anything else.
- Do not approve the change on the owner's behalf, and do not change any task status —
  `approved-for-implementation` reports that status, it never sets it.
- If the owner explicitly asks this invocation to also apply fixes, stop — redirect to
  `/nevo-ai:spec-refine <change-id> --from-review` instead of expanding scope here.
