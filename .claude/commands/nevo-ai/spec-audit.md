---
description: Read-only, cross-task thematic audit of an already-implemented NEvo change — a named lens across all its tasks, not a re-grade of any task's acceptance criteria.
argument-hint: <change-id> <focus>
disable-model-invocation: true
---

Read `references/review-policy.md` § "Change-wide audits" from the shared skill if not
already in context.

Arguments (`$ARGUMENTS`): `<change-id> <focus>` — `<focus>` is the owner's own question
in their own words (e.g. "are the examples genuinely useful and wired end-to-end, or
copy-pasted fragments?"). Do not narrow or reinterpret it before recording it verbatim
in the report's "Scope note".

Use this command, instead of `/nevo-ai:task-review`, whenever the owner's request spans
more than one task in an already-`implemented`/`verified` change and is not "does this
diff meet its task's acceptance criteria" (that's `/nevo-ai:task-review`) and not "is
this spec ready for approval" (that's `/nevo-ai:spec-review`). If no such request has
been made, do not invoke this proactively.

## Flow

1. Run `node tools/specs.mjs list` and confirm `<change-id>` exists and has at least one
   task. This audit does not require every task to be terminal, but note in the report
   which tasks are and aren't, so the reader knows how much of the change the audit
   actually covers.
2. Derive `<slug>` from `<focus>` (short, kebab-case, e.g. `examples-and-wireup`). Check
   whether `specs/active/<change-id>/reviews/audit-<slug>.md` already exists. If it does,
   **read its full current content now, before anything else touches it** — same rule as
   `/nevo-ai:task-review` step 2: this file, not git status or memory, is the baseline
   for a re-audit. If it doesn't exist, there is no baseline; the final response must
   include, verbatim, "No reliable previous-file baseline is available. Performing a
   fresh audit of the current implementation."
3. Read only what `<focus>` requires — guides, package docs, source files it names or
   implies. Do not re-read every file in the change if the focus only implicates some of
   them.
4. This audit never re-evaluates any task's own acceptance criteria — those were already
   gated by that task's own `/nevo-ai:task-review`. State this explicitly in the report's
   "Scope note" so it's never mistaken for a re-grade. If `<focus>`'s inspection touches a
   path with a matching `kind: maintenance-correction` entry in `follow-ups.yaml` (D34/D35,
   area unowned-drift-correction), name it explicitly ("handled via unowned-drift
   correction, see `<follow-up id>`") — never report it as an unexplained anomaly, and
   never silently omit it either.
5. Classify every finding per `references/review-policy.md` § "Findings must be
   actor-classified". If a baseline existed (step 2), assign each of its findings a
   lifecycle (`resolved`/`still-present`/`changed`/`cannot-verify`) per § "Findings have
   a lifecycle" — verify each one's exact predicate against current content, never from
   memory.
6. Compute `Verdict` from `references/review-policy.md` § "Change-wide audits" →
   "Verdict decision table" — `no-findings` / `changes-recommended` /
   `owner-decision-required`. Never compose it as prose.
6a. **Record as follow-up (D15/D22, area context-and-validation-hardening, task 06).**
    For each `NON_BLOCKING` finding from step 5, ask (closed choice, one per finding or
    batched if several) whether to record it in `specs/active/<change-id>/follow-ups.yaml`
    instead of letting it live only in this run's report — same mechanism and menu shape
    as `/nevo-ai:task-review` step 7a: `1. Record as a follow-up (severity: ...)` / `2. Leave it in the report only`. On 1 → `node tools/specs.mjs follow-up-add <change-id> <id> --source-task <the task the finding traces to> --kind <short-kind> --severity <blocking|non-blocking> --reason <finding summary>`. This never fires without this
    explicit answer, and never changes how `AUTO_FIX`/`OWNER_DECISION`/
    `NEEDS_CLARIFICATION` findings are categorized or handled.
7. Write the full report to `specs/active/<change-id>/reviews/audit-<slug>.md` using
   `templates/review-report.md`'s `review-of: spec-audit` shape (create `reviews/` if
   needed) — overwriting the file read in step 2, which is expected.
8. If every finding from a prior baseline is now `resolved` and no new blocking findings
   exist this run, ask a closed menu (same principle as `/nevo-ai:task-review` step 9 — a
   known state is confirmed and applied now, not left as an instruction to type):

   ```
   Every finding from the previous audit of `<change-id>` (`<slug>`) is now resolved.

   Mark this audit as:
   1. Actioned (the recommended follow-up is done)
   2. Still open (leave as-is)
   ```

   On 1 → set `audit_status: actioned` in the report's frontmatter (already written in
   step 7) and say so in the chat summary. On 2 → leave `audit_status: open`. Skip this
   step entirely on a first-time audit (no baseline) or when unresolved findings remain
   this run — there's nothing to confirm yet, `audit_status` stays `open`.
9. End with `references/review-policy.md` § "Change-wide audits" → "Chat output shape".
   `Next command` is: `owner-decision-required` → the specific decision needed;
   `changes-recommended` → `/nevo-ai:spec-refine <change-id>` to add the recommended
   follow-up task(s); `no-findings` → `No further action required.`

## Rules

- Never modify the files under audit, and never apply a recommended fix itself — writing
  `reviews/audit-<slug>.md` (step 7) and setting `audit_status` after the step 8 menu are
  the two exceptions, same as `/nevo-ai:task-review`'s own rules.
- Never re-open or re-grade a task's own acceptance criteria — an audit finding outside
  a task's acceptance-criteria text is not evidence that task's own `pass` was wrong.
- Do not commit.
