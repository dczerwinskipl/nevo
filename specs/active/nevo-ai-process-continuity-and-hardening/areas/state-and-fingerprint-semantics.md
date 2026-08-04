# Area: State and fingerprint semantics

> Refined 2026-08-04 — see `owner-decisions.md` D7, D8. The area's boundary is unchanged;
> its content is significantly more specific than the original draft.
>
> Refined again 2026-08-04 (second pass) — see D16, D18. `blocked`/`needs-decision` are
> now actively removed from the status vocabulary (not merely left unreachable), with
> `validate`-time enum enforcement at both task and change level. The task-level
> fingerprint's dependency/decision/constraint inputs are now the explicit
> `semantic_references` schema block, not the prose "actually references" rule.
>
> Refined a third time 2026-08-04 — see D26. `validateSpecs` can confirm a declared
> `semantic_references` entry exists (reference *integrity*), but not that the list
> actually covers everything the task's content depends on (reference *completeness*) —
> this area now states the completeness requirement (requirement 8); the actual
> model-review step is implemented and documented by task 11, since this task cannot
> touch `.claude/commands/**`/`.claude/skills/**` under its own `forbidden_paths`.

## Responsibility

Own the persisted state model of `change.yaml`: what a lifecycle status means, which
statuses satisfy a dependency, the `execution.suspension` schema (orthogonal to status),
and the three-tier semantic fingerprint model. This area is the foundation every other
area depends on.

## Current state

See `overview.md` § "Current architecture" for full citations. Summary: `TERMINAL_STATUSES`
treats `implemented`/`verified`/`archived`/`abandoned` identically for dependency
satisfaction (`lifecycle.mjs:11-17`); `superseded` is inert; `blocked`/`needs-decision`
are valid-but-unreachable today — the first refinement pass (D8) left them that way,
reversing the original plan to make them *reachable*; the second refinement pass (D16)
goes further and removes them from the valid vocabulary entirely, since a status
`validateSpecs` accepts but no transition can ever leave is itself a defect. Neither
`change.status` nor task `status` is currently enum-validated at all (`validateSpecs`
today only checks `change.status` is *present*) — this task adds that check as part of
removing the two statuses. `computeSpecFingerprint` hashes whole files, including
`status` (`service.mjs:128-153`), which both causes the original confirmed cross-task
invalidation defect and, even after excluding `status` alone, still over-invalidates
under other operational-adjacent changes (D7); its task-level tier originally scoped
dependency/decision/constraint inputs in prose ("actually references"), which D18
(second refinement pass) replaces with an explicit, validated `semantic_references`
schema block.

## Requirements

1. **Fingerprint tiers (D7).** Replace `computeSpecFingerprint` with three functions:
   - `computeChangeFingerprint(change)` — a canonical projection over change scope,
     shared constraints, owner decisions, change-level acceptance criteria, the task
     graph's shape (ids + `depends_on` edges only, not per-task status), cross-task
     invariants, and shared context rules.
   - `computeTaskFingerprint(change, taskId)` — a canonical projection over that task's
     own definition, acceptance criteria, `allowed_paths`/`consequential_paths`/
     `forbidden_paths`, `context`, `context_exceptions` (D13, added by task 06 — this
     task only reserves the field in the projection), and `semantic_references` (D18 —
     `dependency_contracts`, `decisions`, `constraints`; see requirement 7).
   - `computeImplementationFingerprint(change, taskId)` — the task-level fingerprint plus
     a reviewed diff/revision identifier and evidence references (populated by later
     tasks; this task only defines the function's contract).

   "Canonical projection" means: extract the specific semantic fields listed above from
   parsed YAML/Markdown structures and hash *that*, not raw file bytes — no exclusion
   list to maintain, because nothing operational is included in the first place.
2. Implement the invalidation matrix from `overview.md` § "Proposed architecture" →
   "State model" as the acceptance contract for requirement 1 — every row is a test case.
3. **`execution.suspension` (D8).** Add the optional, per-task
   `execution: { suspension: { kind, code, previous_action, created_at } }` structure to
   the schema. This task defines and validates the *shape* only — writing/clearing
   suspensions is area `recovery-and-resume`'s job (task 02). Both `status` and
   `execution.suspension` (when present) are excluded from all three fingerprint tiers.
4. `depsSatisfied` excludes `abandoned` from dependency-satisfying terminal statuses.
5. Resolve `superseded`: either give it real, non-dependency-satisfying terminal
   semantics, or remove it from `service.mjs`'s `STATUS_ORDER`. Do not leave it inert.
6. **Remove `blocked`/`needs-decision` from the status vocabulary entirely (D16,
   second refinement pass)** — not merely leave them unreachable, which was D8's
   original, now-superseded position for this specific point. Delete both values from
   `service.mjs`'s task-level `STATUS_ORDER` and from `lifecycle.mjs`'s change-level
   `ACTIVE_CHANGE_STATUSES`. Add an explicit enum check to `validateSpecs` for both
   `change.status` and every task's `status` (neither is enum-checked today — only
   presence, for `change.status`) against the corrected vocabulary; a value of `blocked`
   or `needs-decision` at either level fails with the fixed message `` Status `blocked`
   is no longer supported. Use `execution.suspension`. `` (substitute `needs-decision`
   for the other value). `TRANSITIONS` (`lifecycle.mjs:29-34`) is not modified by this
   task — this is a vocabulary/validation change, not a transition change.
7. **`semantic_references` schema (D18, second refinement pass).** Add an optional,
   per-task front-matter block (absent is equivalent to all three lists empty — a task
   that declares nothing references nothing beyond its own content):

   ```yaml
   semantic_references:
     decisions: [D7, D13]
     constraints: [C2]
     dependency_contracts: [task-a]
   ```

   `validateSpecs` rejects: a `dependency_contracts` entry not present in the task's own
   `depends_on`; a `decisions` entry that doesn't resolve to an entry in the change's
   `owner-decisions.md`; a `constraints` entry that doesn't resolve to a named constraint
   in `overview.md` § "Constraints"; a `decisions` entry naming a decision explicitly
   marked superseded (by another entry's "Refined by"/"Refines" note using supersession
   language, e.g. D1's "kept for the audit trail; D7 is authoritative") on the exact
   question referenced — the error names the superseding decision the task should
   reference instead. `computeTaskFingerprint` (requirement 1) reads exactly this block
   for its dependency/decision/constraint inputs — no separate inference step exists. A
   task with an empty `semantic_references` block (all three lists empty) is valid — it
   means the task's fingerprint depends on nothing beyond its own content.
8. **Reference completeness requires a model-review step, not just schema validation
   (D26, third refinement pass).** Requirement 7's validation proves a declared
   reference *exists*; it cannot prove the list is *complete* — that every owner
   decision, shared constraint, and dependency contract the task's goal, constraints,
   acceptance criteria, context rules, or path rules actually rely on is listed. This
   task **states** the requirement: `/nevo-ai:spec-review` must, for every task,
   inspect its goal/constraints/acceptance-criteria/context/path definitions; identify
   the owner decisions, shared constraints, and dependency contracts the task's content
   actually relies on; compare that against its declared `semantic_references`; and
   report any missing, stale, or unnecessary reference as a finding (categorized per the
   normal `AUTO_FIX`/`OWNER_DECISION`/`NON_BLOCKING` rules). Implementing this step in
   `references/review-policy.md`/`.claude/commands/nevo-ai/spec-review.md` is task 11's
   job, not this task's — this task only defines what the check must do and why schema
   validation alone cannot do it.

## Constraints

- No new lifecycle status names are introduced; two are removed (`blocked`,
  `needs-decision` — D16).
- `TRANSITIONS` keeps its existing four entries unchanged — this task's own analysis
  confirmed the refined state model does not require touching it (contrast with the
  original draft's "must no longer prohibit transition changes if genuinely required" —
  the genuine requirement turned out to be satisfiable without doing so).
- The three fingerprint functions must not read or hash `status` or
  `execution.suspension` under any circumstance — a test enforces this directly (change
  either field, assert the relevant fingerprint(s) are byte-identical).
- `semantic_references` resolution (requirement 7) must not require loading any file
  outside the change's own `specs/active/<change-id>/**` — it resolves against
  `owner-decisions.md`, `overview.md`, and sibling task files' `depends_on`, never a
  broader repository scan.

## Interfaces and boundaries

Exposes: `computeChangeFingerprint`, `computeTaskFingerprint`,
`computeImplementationFingerprint`, the validated `execution.suspension` shape, an
updated `depsSatisfied`, (if kept) defined `superseded` semantics, the corrected
task-/change-level status enum with `validate`-time enforcement, and the validated
`semantic_references` schema.

Consumes: nothing new from other areas — this is the foundation.

## Area-specific acceptance criteria

- A test suite covers every row of the invalidation matrix in `overview.md`.
- A test proves `execution.suspension` never changes any fingerprint tier's output.
- A test proves a task depending on an `abandoned` task is excluded from `next`.
- `node tools/specs.mjs validate` passes with `superseded` either removed or fully
  defined.
- A test proves setting a task's or the change's `status` to `blocked` or
  `needs-decision` fails `validate` with the fixed migration message (D16).
- A test proves a `semantic_references.dependency_contracts` entry outside the task's
  own `depends_on`, or an unresolvable `decisions`/`constraints` entry, fails `validate`
  (D18).
- A test proves `computeTaskFingerprint` changes when and only when a referenced
  `semantic_references` entry's target content changes (D18).
- Requirement 8's completeness check itself is verified by task 11 (a model-review
  procedure, not something this task's own automated suite can exercise) — this area's
  own acceptance criteria stop at requirement 7's deterministic integrity checks.

## Dependencies

None — this is the first area implemented.

## Out of scope

- Writing or clearing `execution.suspension` values (area `recovery-and-resume`).
- `context_exceptions`' actual population (area `context-and-validation-hardening`) —
  this task only reserves the field in the task-level fingerprint's input set.
- Implementing the `semantic_references` completeness model-review step in
  `review-policy.md`/`spec-review.md` (task 11, D26) — this task only states the
  requirement and the reference-integrity checks it can validate deterministically.
