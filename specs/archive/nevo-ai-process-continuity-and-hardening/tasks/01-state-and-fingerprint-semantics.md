---
id: nevo-ai-process-continuity-and-hardening.state-and-fingerprint-semantics
status: draft
change: nevo-ai-process-continuity-and-hardening
context:
  required:
    - specs/active/nevo-ai-process-continuity-and-hardening/areas/state-and-fingerprint-semantics.md
    - specs/active/nevo-ai-process-continuity-and-hardening/owner-decisions.md
    - specs/active/nevo-ai-process-continuity-and-hardening/overview.md
    - tools/specs/lifecycle.mjs
    - tools/specs/service.mjs
    - tools/specs/validation.mjs
  optional:
    - tools/tests/fingerprint.test.mjs
    - tools/tests/task-lifecycle.test.mjs
allowed_paths:
  - tools/specs/lifecycle.mjs
  - tools/specs/service.mjs
  - tools/specs/validation.mjs
  - tools/tests/fingerprint.test.mjs
  - tools/tests/task-lifecycle.test.mjs
  - docs/ai/specification-workflow.md
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
  - docs/development/**
  - docs/usage/**
  - docs/reference/**
  - .claude/commands/**
  - .claude/skills/**
---

# Task: State and fingerprint semantics

> Refined 2026-08-04 (see `owner-decisions.md` D7, D8) — this task now implements a
> three-tier semantic fingerprint model instead of a single status-excluding hash, and
> reserves (but does not populate) the `execution.suspension` schema. It no longer
> touches `TRANSITIONS` at all — the refined recovery model doesn't require new lifecycle
> statuses.
>
> Refined again 2026-08-04 (second pass, see D16, D18) — `blocked`/`needs-decision` are
> now actively removed from the status vocabulary (task- and change-level), with new
> `validate`-time enum enforcement that didn't exist before. The task-level fingerprint's
> dependency/decision/constraint inputs are now the explicit, validated
> `semantic_references` schema block, not a prose "actually references" rule.
>
> Refined a third time 2026-08-04 (see D26) — this task's `semantic_references`
> validation proves reference *integrity* only (existence, activeness, no duplicates);
> it does not and cannot prove *completeness*. This task now states the completeness
> requirement explicitly (as a documented limitation of what it validates); the actual
> model-review completeness check is implemented by task 11 in `review-policy.md`/
> `spec-review.md`, which this task's `forbidden_paths` excludes it from touching.
>
> Refined a fourth time 2026-08-04 (see D27, D28, D29) — the invalidation matrix's
> task-addition/removal rows are corrected: `computeChangeFingerprint`'s own field list
> already includes the task graph's ids, so adding/removing a task must invalidate the
> change-level fingerprint (D27) — this needed a test fix, not a code change. This task
> adds the validated, optional `self_check` schema (D28), structurally parallel to
> `execution.suspension`, excluded from every fingerprint tier. D29 tightens the
> completeness-check categorization this task documents (see D26 note above) but does
> not otherwise touch this task's own validation.

## Goal

Replace `computeSpecFingerprint` with three canonical semantic-projection functions
(change-level, task-level, implementation-review — D7) and implement the full
invalidation matrix from `overview.md` — including the corrected task-addition/removal
rows (D27); add the validated `execution.suspension` schema (D8, shape only — writers
live in task 02); add the validated `semantic_references` schema and wire it into
`computeTaskFingerprint` (D18); add the validated `self_check` schema (D28, shape only —
writers live in task 08); correct `depsSatisfied` so `abandoned` no longer satisfies a
dependency; resolve `superseded`; remove `blocked`/`needs-decision` from the status
vocabulary entirely and add the enum validation that catches them (D16). This is the
foundation every other task in this change depends on.

## Dependencies

None — first task in the change.

## Implementation constraints

- Implement `computeChangeFingerprint(change)`, `computeTaskFingerprint(change, taskId)`,
  and `computeImplementationFingerprint(change, taskId)` as canonical semantic
  projections (extract specific fields, hash the extracted structure) — not whole-file
  byte hashing with an exclusion list. Exact field lists are in
  `areas/state-and-fingerprint-semantics.md` requirement 1.
- None of the three functions may read `status` or `execution.suspension` for any task,
  under any circumstance.
- `computeTaskFingerprint` includes a `context_exceptions` field in its projection even
  though task 06 is what actually populates that data — reserve the field now so task 06
  doesn't need to touch this function again.
- Implement every row of the invalidation matrix in `overview.md` § "Proposed
  architecture" → "State model" as a distinct test case, **including (D27, fourth
  refinement pass) the corrected task-addition/task-removal rows**: adding or removing
  any task always invalidates `computeChangeFingerprint`'s output (its task-graph-ids
  input already covers this — no code change needed, only the test); an unrelated task's
  task-level fingerprint is unaffected unless its own
  `semantic_references.dependency_contracts` names the added/removed task.
- Add the `execution: { suspension: { kind, code, previous_action, created_at } }` shape
  to schema validation (`validateSpecs`): when present, `kind` must be one of
  `automatic`/`confirm-required`/`owner-decision`/`unsafe-manual`, `code` must be a
  recognized identifier (task 02 defines the actual `REC-xx` list; this task only
  validates the shape, not the specific set, since task 02 hasn't landed yet — validate
  `code` as a non-empty string here, tighten to the enum once task 02 exists).
- **`semantic_references` schema (D18, second refinement pass).** Add an optional,
  per-task front-matter block: `semantic_references: { decisions: [...], constraints:
  [...], dependency_contracts: [...] }` (absent, or all three lists empty, is valid).
  `validateSpecs` rejects: a `dependency_contracts` entry not present in the task's own
  `depends_on`; a `decisions` entry that doesn't resolve to an entry in the change's
  `owner-decisions.md`, or that resolves to a decision explicitly marked superseded (by
  another entry's "Refined by"/"Refines" note using supersession language) on the exact
  question referenced — name the superseding decision in the error; a `constraints`
  entry that doesn't resolve to a named constraint in `overview.md` § "Constraints".
  `computeTaskFingerprint` reads exactly `semantic_references.dependency_contracts`/
  `decisions`/`constraints` for its dependency/decision/constraint inputs — no separate
  prose-inference step. Both `execution.suspension` and `semantic_references` are
  optional, additive fields; no existing task file becomes invalid without edits.
  **This validation proves reference integrity only (D26, third refinement pass)** — it
  cannot prove the list is *complete* (that it covers everything the task's content
  actually depends on); that check is a model-review step task 11 implements in
  `review-policy.md`/`spec-review.md`, not something this task's schema validation can
  do. **D29 (fourth refinement pass) tightens how task 11's check categorizes a missing
  reference** — never `NON_BLOCKING`; `AUTO_FIX` when unambiguous, `OWNER_DECISION` when
  ambiguous — this task's own deterministic integrity validation is unaffected by that
  categorization change.
- **`self_check` schema (D28, fourth refinement pass).** Add an optional, per-task
  `self_check` block to schema validation, structurally parallel to
  `execution.suspension`: `self_check: { status, fingerprint, revision, failed_criteria,
  commands: [{ command, exit_code }] }`. `validateSpecs` rejects: a `status` other than
  `failed`/`passed`; a `failed_criteria` entry present when `status` is not `failed`; a
  `commands` entry missing `command` (string) or `exit_code` (integer). This task
  defines and validates the *shape* only — writing it after a self-check run is task
  08's job. `self_check` is excluded from all three fingerprint tiers, exactly like
  `status` and `execution.suspension` — add it to the same "must not read or hash" test
  that already covers those two.
- `depsSatisfied` excludes `abandoned` from dependency-satisfying statuses.
- Resolve `superseded`: either wire it into a real, non-dependency-satisfying terminal
  state with a documented convention, or remove it from `service.mjs`'s `STATUS_ORDER`.
- **Remove `blocked`/`needs-decision` from the status vocabulary entirely (D16, second
  refinement pass)** — delete both from `service.mjs`'s task-level `STATUS_ORDER` and
  from `lifecycle.mjs`'s change-level `ACTIVE_CHANGE_STATUSES`. Add an explicit enum
  check to `validateSpecs` for both `change.status` and every task's `status` (neither
  is enum-checked today) against the corrected vocabulary; a value of `blocked` or
  `needs-decision` at either level fails with the fixed message `` Status `blocked` is
  no longer supported. Use `execution.suspension`. `` (substitute `needs-decision` for
  the other value). Do **not** modify `TRANSITIONS` (`lifecycle.mjs:29-34`) — this is a
  vocabulary/validation change, not a transition change; D8's original position (leave
  the two statuses unreachable-but-present) is superseded on this specific point by D16,
  which removes them outright.
- Update `docs/ai/specification-workflow.md` to describe the three fingerprint tiers,
  the `execution.suspension` concept, the `semantic_references` schema, and the removed
  status vocabulary (full documentation consolidation still happens in task 11; this
  task documents the mechanisms it directly introduces).

## Acceptance criteria

1. Every row of the invalidation matrix in `overview.md` passes as a distinct automated
   test (automated: `node --test tools/tests/fingerprint.test.mjs`).
2. Changing `execution.suspension` never changes any fingerprint tier's output
   (automated, same suite).
3. A task depending on an `abandoned` task is never reported `next`-ready (automated:
   `node --test tools/tests/task-lifecycle.test.mjs`).
4. `superseded` has either full, real semantics or no longer appears anywhere in
   `tools/specs/` (automated: `node tools/specs.mjs validate` + a grep-backed check).
5. `execution.suspension`'s shape is validated by `validateSpecs`; a malformed `kind` is
   a `validate` error (automated).
6. `docs/ai/specification-workflow.md` accurately describes the tiered fingerprint model
   and the suspension concept (inspection).
7. Setting a task's or the change's `status` to `blocked` or `needs-decision` fails
   `validate` with the fixed migration message naming `execution.suspension` (automated:
   `node --test tools/tests/task-lifecycle.test.mjs`) (D16).
8. A `semantic_references.dependency_contracts` entry outside the task's own
   `depends_on`, or an unresolvable `decisions`/`constraints` entry, fails `validate`
   (automated: `node --test tools/tests/fingerprint.test.mjs`) (D18).
9. `computeTaskFingerprint` changes when and only when a referenced `semantic_references`
   entry's target content changes — proven for at least one entry of each of the three
   lists (automated, same suite) (D18).
10. Adding or removing a task always invalidates `computeChangeFingerprint`'s output; an
    unrelated task's task-level fingerprint is unaffected unless it names the
    added/removed task in `semantic_references.dependency_contracts` (automated:
    `node --test tools/tests/fingerprint.test.mjs`) (D27).
11. `self_check`'s shape is validated by `validateSpecs` (a malformed `status`, a
    `failed_criteria` entry present without `status: failed`, or a `commands` entry
    missing `exit_code` are each `validate` errors); changing any `self_check` field
    never changes any fingerprint tier's output (automated, same suite) (D28).

## Verification

```
node --test tools/tests/fingerprint.test.mjs
node --test tools/tests/task-lifecycle.test.mjs
node tools/specs.mjs validate
node tools/docs.mjs validate
```

## Documentation impact

`docs/ai/specification-workflow.md` — fingerprint tiers, suspension schema,
`semantic_references` schema, `self_check` schema, and the corrected status vocabulary.

## Out of scope

- Writing or clearing `execution.suspension` values (task 02).
- Populating `context_exceptions` (task 06) — this task only reserves the field.
- Reviewing/annotating other active changes' existing task files with
  `semantic_references` — recommended follow-up, not required by this task (D18).
- Any change to `TRANSITIONS` or the four existing lifecycle commands' behavior.
- Implementing the `semantic_references` completeness model-review step — task 11, D26/D29.
- Writing or reading `self_check` after an actual self-check run — task 08, D28 — this
  task only defines and validates its shape.
