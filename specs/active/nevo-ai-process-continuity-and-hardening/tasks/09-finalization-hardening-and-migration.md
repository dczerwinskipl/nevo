---
id: nevo-ai-process-continuity-and-hardening.finalization-hardening-and-migration
status: draft
change: nevo-ai-process-continuity-and-hardening
context:
  required:
    - specs/active/nevo-ai-process-continuity-and-hardening/areas/finalization-and-migration.md
    - specs/active/nevo-ai-process-continuity-and-hardening/owner-decisions.md
    - tools/specs/lifecycle.mjs
    - tools/specs.mjs
    - .claude/commands/nevo-ai/spec-finalize.md
    - specs/active/nevo-documentation-architecture/reviews/spec.md
  optional:
    - docs/development/git-workflow.md
allowed_paths:
  - tools/specs/lifecycle.mjs
  - tools/specs.mjs
  - tools/tests/finalize.test.mjs
  - .claude/commands/nevo-ai/spec-finalize.md
  - specs/active/nevo-ai-process-continuity-and-hardening/**
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
  - docs/development/**
  - specs/active/nevo-documentation-architecture/tasks/**
  - specs/active/nevo-documentation-architecture/change.yaml
---

# Task: Finalization hardening and migration

## Goal

Add a cheap post-merge check to `finalize`, and document the fingerprint-scheme
migration for existing active changes — using `nevo-documentation-architecture`'s
`reviews/spec.md` as the concrete case study — plus the rollout order and per-task
fallback guarantee for this change itself.

## Dependencies

`batch-execution-and-gating-review`, `mechanical-task-type` — this task finalizes and
documents behavior that must already exist.

## Implementation constraints

- The post-merge check runs `node tools/specs.mjs check` and `node tools/docs.mjs check`
  against the post-merge tree only — no duplicate `dotnet build`/`dotnet test`. It is
  reported, not gating (the merge already happened); a failure becomes a follow-up entry
  (task 06's ledger) rather than blocking anything retroactively.
- Do not modify `specs/active/nevo-documentation-architecture/tasks/**` or its
  `change.yaml` — that change is read-only evidence (a case study) for this task, per the
  owner's instruction to treat it as such; only its `reviews/spec.md` is relevant, and
  only as something this task's migration notes point to, not modify.
- Migration notes state explicitly: no `change.yaml` schema migration is required; any
  existing `reviews/*.md` `spec_fingerprint` becomes stale under the new scheme and needs
  exactly one re-review, already correctly surfaced by `validateApproval`'s existing
  stale-fingerprint error with no further code change.
- Document rollout order (tasks 01 → 02-04 → 05-07 → 08 → 09-10) and the per-task
  fallback guarantee (each earlier task must leave the workflow independently working)
  in this task's own notes, cross-checked against the actual `depends_on` graph in
  `change.yaml`.

## Acceptance criteria

1. `finalize`'s post-merge check runs and reports `specs.mjs check`/`docs.mjs check`
   against the post-merge tree (automated: `node --test tools/tests/finalize.test.mjs`).
2. A post-merge check failure is reported but does not attempt to un-merge or block a
   completed finalize (automated).
3. Migration notes correctly identify that no `change.yaml` schema change is needed and
   that exactly one re-review is the expected one-time cost (inspection, cross-checked
   against `nevo-documentation-architecture/reviews/spec.md` as the concrete example).

## Verification

```
node --test tools/tests/finalize.test.mjs
node tools/specs.mjs validate
node tools/docs.mjs validate
```

## Documentation impact

`spec-finalize.md` — post-merge check section. Migration notes recorded in this task
file's own body (already satisfied by this document) plus a short cross-reference from
`overview.md` § "Compatibility and migration" (already present, no edit needed here).

## Out of scope

- Any modification to `specs/active/nevo-documentation-architecture/**` beyond reading
  its `reviews/spec.md` as evidence.
- Writing the ADR (task 10) or updating the shared vendor-neutral workflow doc broadly
  (task 10) — this task's documentation scope is `spec-finalize.md` only.
