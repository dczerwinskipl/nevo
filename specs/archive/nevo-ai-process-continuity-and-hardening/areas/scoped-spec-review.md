# Area: Scoped and incremental spec review

> New area, added 2026-08-06 (seventh refinement pass) per owner decisions D34/D35.
> `/nevo-ai:spec-review` has no scoped/incremental mode today — confirmed during
> discovery for this pass: `spec-review.md` takes only `<change-id>`, and step 3 always
> reads `change.yaml` and every current artifact "in full, fresh." Adding one task to an
> already-`ready-for-approval` 13-task change today re-reads and re-grades all 13.

## Responsibility

Own `/nevo-ai:spec-review <change-id> [--all | --changed | --tasks <spec>]` — the same
review depth `spec-review` already performs, but scoped to only the tasks that actually
need (re-)grading, using persisted fingerprints as the baseline for what counts as
"changed." Own the hard boundary between *reading* an older task for context (never
mutates its own review state) and *reviewing* it (re-grades it, part of the selected
scope) — these must never be conflated.

## Current state

`spec-review.md`'s `argument-hint` is `<change-id>` only; no `--all`/`--changed`/
`--tasks` flag is parsed anywhere in the file. `tools/specs.mjs` has scoped `--all`/
`--tasks` flags only for the unrelated `review-scope`/`bulk-transition` subcommands
(task 12, `implementation-review`-only). `spec-review` itself is always whole-change.
Fingerprint tiers (D7) already make "is task T's content unchanged since its last
review" a real, checkable fact (`computeTaskFingerprint` vs. the fingerprint recorded in
`reviews/spec.md`'s `task_fingerprints` map) — this area is the first place that fact is
actually used to skip re-grading a task, rather than only to detect staleness for a
task already being reviewed.

## Requirements

1. **Command surface**, mirroring task 12's own flag shape for consistency:
   `/nevo-ai:spec-review <change-id> --all` (full review, unchanged behavior — this is
   also the default when no flag is given, preserving compatibility with every existing
   invocation and every reference to `/nevo-ai:spec-review <change-id>` elsewhere in
   this workflow's docs/commands), `/nevo-ai:spec-review <change-id> --changed` (new or
   semantically changed tasks only), `/nevo-ai:spec-review <change-id> --tasks 14-17`
   (order-range), `/nevo-ai:spec-review <change-id> --tasks 14,16,18` (order-list) —
   same `order`-field-based range/list grammar task 12's `--tasks` already established,
   reused rather than reinvented.
2. **Review scope is separate from context scope.** Reading an older, already-reviewed
   task's file as background context (e.g. to understand a dependency the newly-added
   task relies on) must never: re-grade that older task's acceptance criteria,
   regenerate its verdict, replace its stored `task_fingerprints` baseline, change its
   `status`, or add it to the selected review scope for this run. This is the same
   boundary `references/context-policy.md` already draws between `context.required`
   (informational) and a task's own review target — this area states it explicitly for
   `spec-review`'s scoped mode, where the risk of conflating the two is new.
3. **Persisted fingerprints are the baseline, not re-derived judgment.**
   `--changed` selects exactly the tasks whose current `computeTaskFingerprint` (D18)
   does not match the fingerprint recorded in `reviews/spec.md`'s `task_fingerprints`
   map (or has no recorded entry — a genuinely new task) — never a model's own
   assessment of "does this look different."
4. **A scoped review may name older tasks as potentially impacted, but must never
   silently re-review them — and impact is never inferred from the selected task
   depending on the older one.** A new or changed task naming an older, out-of-scope
   task in `semantic_references.dependency_contracts` means the older task is *context*
   for the selected task — it does not, by itself, mean the older task was affected.
   Reading or referencing an older task as a dependency of the selected task never marks
   that older task impacted. An out-of-scope task is potentially impacted only when its
   own current `computeTaskFingerprint` no longer matches the baseline recorded for it
   in `reviews/spec.md`'s `task_fingerprints` map (`scopedReviewBaselineValid`,
   requirement 5) — the deterministic fingerprint baseline is the primary and only
   automated impact signal, and it already accounts for a shared owner decision, a
   shared constraint, or the out-of-scope task's own `dependency_contracts` naming a
   changed selected task, because `computeTaskFingerprint` (D18) already folds a task's
   declared `semantic_references` (including its own `dependency_contracts`) into its
   fingerprint recursively — an out-of-scope task that itself depends on a changed
   in-scope task's contract already gets a different fingerprint for that reason, with
   no second, dependency-direction-based check required. Additional inspection by the
   reviewing model may identify a real cross-contract impact the deterministic
   fingerprint comparison does not represent (e.g. an undeclared coupling); report that
   explicitly as a model-inspection finding, distinct from the deterministic signal, but
   never as an automated function's own output. Either way, the review reports an
   impacted task by name — "`task-X`'s fingerprint no longer matches its recorded
   baseline; not re-reviewed in this scope" — and offers explicit scope expansion
   (re-run with a wider `--tasks`/`--all`) rather than either ignoring the impact or
   quietly grading the older task anyway.
5. **A scoped review must not claim whole-change readiness unless every unreviewed task
   still retains a valid baseline.** The verdict computation (`references/review-policy.md`
   § "Spec-review verdicts are derived, never chosen narratively") gains one more input
   for scoped runs: `ready-for-approval`/`approved-for-implementation` requires that
   every task *outside* the selected scope still has a `task_fingerprints` entry
   matching its current `computeTaskFingerprint` — if even one does not (and wasn't
   itself in scope), the verdict cannot claim whole-change readiness; it reports which
   task(s) need scope expansion instead.
6. **Uses the minimal report format** (tasks 13/14) for the scoped review's own output
   — narrows `references/review-policy.md`'s existing "`spec-review`'s own report shape
   is unchanged" note (D31, task 13 requirement 17) specifically for this new scoped
   mode's report: a normal, fully-passing scoped review renders the same compact
   checklist shape task 14 already defines, adapted to `spec-review`'s own verdict
   vocabulary (`blocked`/`owner-decision-required`/`changes-required`/
   `ready-for-approval`/`approved-for-implementation`) rather than `task-review`'s
   three-value set. As originally shipped, `spec-review`'s existing full-review (`--all`,
   the default) output shape was left unchanged by this area — only the new scoped modes
   adopted the compact shape. **Corrected by task 14/D34/D35's final pre-approval pass:**
   a fully-passing `--all` run now renders through this same function too — see task 14's
   area (§E) for the owner-facing minimization principle extended to every review shape.
   This area's own scoped-mode requirement (this one) is unchanged; only the artificial
   `--all`-is-exempt restriction is lifted, by task 14, not by reopening this area.

## Constraints

- `--all` remains the default with no flag given — every existing invocation of
  `/nevo-ai:spec-review <change-id>` anywhere in this repository's docs/commands
  continues to work unchanged (requirement 1).
- Never let reading an older task as context mutate that task's own review state
  (requirement 2) — a hard boundary, not a judgment call.
- Never re-derive "changed" from prose inspection when a persisted fingerprint
  comparison already answers it (requirement 3).
- Never claim `ready-for-approval`/`approved-for-implementation` for a scoped review
  while any out-of-scope task's baseline is invalid (requirement 5).
- Never silently re-review a task outside the selected scope, even when the review
  suspects it's impacted (requirement 4) — name it and offer expansion instead.

## Interfaces and boundaries

Exposes: the `--all`/`--changed`/`--tasks` command surface (requirement 1), the
context-vs-review-scope boundary rule (requirement 2, consumed by every future
`spec-review` invocation, scoped or not), the fingerprint-based `--changed` selection
(requirement 3), and the scoped-verdict computation (requirement 5, an addition to
`references/review-policy.md`'s existing derived-verdict table).

Consumes: `computeTaskFingerprint`/`computeChangeFingerprint` (D7/D18, task 01) as the
baseline for requirement 3/5; the `--tasks <range-or-list>` grammar already established
by task 12's `review-scope` subcommand (reused, not reinvented, for requirement 1); the
compact checklist renderer (`renderCompactReviewChecklist`, task 14) for requirement 6's
report shape.

## Area-specific acceptance criteria

- A test proves `--tasks 14-17` and `--tasks 14,16,18` both resolve to the correct,
  deduplicated task id list via each task's `order` field, reusing task 12's existing
  range/list parser rather than a second implementation.
- A test proves `--changed` selects exactly the tasks whose current
  `computeTaskFingerprint` differs from (or is absent from) `reviews/spec.md`'s
  `task_fingerprints` map, and excludes every task whose fingerprint still matches.
- A test proves reading an older task as context during a scoped review does not alter
  that task's `task_fingerprints` entry, verdict, or status.
- A test proves a scoped review whose new task's `dependency_contracts` names an
  unselected older task, with that older task's own fingerprint unchanged from its
  recorded baseline, does **not** report the older task as impacted and does not request
  scope expansion — reading it as context is not evidence of impact.
- A test proves an out-of-scope task whose own current fingerprint no longer matches its
  recorded baseline is reported by name as "potentially impacted, not re-reviewed"
  rather than silently included or ignored, regardless of whether anything in the
  selected scope names it.
- A test proves a scoped review cannot report `ready-for-approval`/
  `approved-for-implementation` while any out-of-scope task's fingerprint baseline is
  invalid, and correctly can when every out-of-scope task's baseline is valid.
- A test proves a fully-passing scoped review renders the same compact checklist shape
  as task 14's `task-review` output, adapted to `spec-review`'s own five-value verdict
  set.

## Dependencies

`state-and-fingerprint-semantics` (task 01) — `computeTaskFingerprint`/
`computeChangeFingerprint` (D7/D18), the baseline requirement 3/5 both read.
`implementation-review-orchestration` (task 12) — the `--tasks <range-or-list>` grammar
and its resolver, reused rather than reimplemented (requirement 1).
`review-report-minimization` (task 14) — `renderCompactReviewChecklist`, adapted for
requirement 6's scoped-review report shape.

## Out of scope

- Changing `spec-review`'s existing full-review (`--all`, the default) output shape *as
  this area's own concern* — requirement 6 introduces the compact shape only for the new
  scoped modes; extending it to `--all` too is task 14's own correction (§E), not a
  reopening of this area's requirement 6.
- Changing `task-review`, `spec-audit`, `implementation-review`, or the gating batch
  review's own scope/report model — this area is `spec-review`-only.
- A repository-wide scan across other active changes — `--all` still means "every task
  in this change," never a cross-change scope.
- Automatically expanding scope on a detected potential impact (requirement 4) — always
  named and offered, never silently applied.
