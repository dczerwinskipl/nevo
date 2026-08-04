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
  optional:
    - tools/specs/validation.mjs
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

## Goal

Replace `computeSpecFingerprint` with three canonical semantic-projection functions
(change-level, task-level, implementation-review — D7) and implement the full
invalidation matrix from `overview.md`; add the validated `execution.suspension` schema
(D8, shape only — writers live in task 02); correct `depsSatisfied` so `abandoned` no
longer satisfies a dependency; resolve `superseded`. This is the foundation every other
task in this change depends on.

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
  architecture" → "State model" as a distinct test case.
- Add the `execution: { suspension: { kind, code, previous_action, created_at } }` shape
  to schema validation (`validateSpecs`): when present, `kind` must be one of
  `automatic`/`confirm-required`/`owner-decision`/`unsafe-manual`, `code` must be a
  recognized identifier (task 02 defines the actual `REC-xx` list; this task only
  validates the shape, not the specific set, since task 02 hasn't landed yet — validate
  `code` as a non-empty string here, tighten to the enum once task 02 exists).
- `depsSatisfied` excludes `abandoned` from dependency-satisfying statuses.
- Resolve `superseded`: either wire it into a real, non-dependency-satisfying terminal
  state with a documented convention, or remove it from `service.mjs`'s `STATUS_ORDER`.
- Do **not** modify `TRANSITIONS` (`lifecycle.mjs:29-34`) and do **not** add
  `blocked`/`needs-decision` as writable/reachable statuses — D8 reversed this from the
  original task scope.
- Update `docs/ai/specification-workflow.md` to describe the three fingerprint tiers and
  the `execution.suspension` concept (full documentation consolidation still happens in
  task 11; this task documents the mechanism it directly introduces).

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

## Verification

```
node --test tools/tests/fingerprint.test.mjs
node --test tools/tests/task-lifecycle.test.mjs
node tools/specs.mjs validate
node tools/docs.mjs validate
```

## Documentation impact

`docs/ai/specification-workflow.md` — fingerprint tiers and suspension-schema sections.

## Out of scope

- Writing or clearing `execution.suspension` values (task 02).
- Populating `context_exceptions` (task 06) — this task only reserves the field.
- Any change to `TRANSITIONS` or the four existing lifecycle commands' behavior.
