---
id: nevo-ai-process-continuity-and-hardening.scope-and-follow-up-mechanisms
status: draft
change: nevo-ai-process-continuity-and-hardening
context:
  required:
    - specs/active/nevo-ai-process-continuity-and-hardening/areas/context-and-validation-hardening.md
    - tools/specs/validation.mjs
    - .claude/skills/nevo-ai-spec-workflow/templates/task.md
    - .claude/skills/nevo-ai-spec-workflow/references/review-policy.md
    - .claude/commands/nevo-ai/task-review.md
    - .claude/commands/nevo-ai/spec-finalize.md
  optional:
    - .claude/commands/nevo-ai/spec-audit.md
allowed_paths:
  - tools/specs/validation.mjs
  - tools/specs/lifecycle.mjs
  - tools/specs.mjs
  - tools/tests/validation.test.mjs
  - .claude/skills/nevo-ai-spec-workflow/templates/task.md
  - .claude/commands/nevo-ai/task-review.md
  - .claude/commands/nevo-ai/spec-finalize.md
  - .claude/commands/nevo-ai/spec-audit.md
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
  - docs/development/**
  - docs/usage/**
---

# Task: Scope and follow-up mechanisms

## Goal

Add `consequential_paths` to the `allowed_paths` schema, the durable `follow-ups.md`
ledger, `spec-finalize`'s block-on-open-follow-up check, and per-criterion
acceptance-criteria verification tags — the four additive mechanisms from owner decision
D5.

## Dependencies

`context-completeness-and-routing-precedence` — shares the same schema surface
(`allowed_paths`/context front matter) this task extends further.

## Implementation constraints

- `consequential_paths` is a sibling list to `allowed_paths`, optional, task-level.
  `validateSpecs` rejects a task file where any `consequential_paths` glob overlaps
  `forbidden_paths` — a hard `validate` error naming the overlapping glob.
- A write inside `consequential_paths` is not flagged as a scope violation by
  `task-review.md`'s existing step 4 instruction — update that instruction, not the
  underlying (currently non-existent) enforcement code, since no script diffs
  `allowed_paths` against `git diff` today (confirmed in discovery); this task does not
  introduce that enforcement script as a prerequisite.
- `follow-ups.md` lives at `specs/active/<change-id>/follow-ups.md`, one append-only file
  per change, fields: source task, reason, severity, `blocks-completion` (bool), resolver
  task (nullable), resolution state (`open`/`resolved`/`dismissed`). Not a database, not
  a priority queue — a flat Markdown table is sufficient.
- `task-review.md` and `spec-audit.md` gain an explicit "record as follow-up" action for
  a `NON_BLOCKING` finding — this does not change how `AUTO_FIX`/`OWNER_DECISION`/
  `NEEDS_CLARIFICATION` findings are categorized or handled.
- `validateFinalize` (`lifecycle.mjs`) gains a check: any `follow-ups.md` entry with
  `blocks-completion: true` and `resolution: open` fails finalize with a message naming
  the entry, evaluated alongside the existing terminal-task check (same severity, added
  to the same ordered condition list, not a separate gate).
- `templates/task.md`'s acceptance-criteria section documents the optional per-criterion
  tag syntax (`automated:`/`inspection:`/`owner-decision:`); this task does not require
  retrofitting the tag onto any existing task file outside this change.

## Acceptance criteria

1. A `consequential_paths`/`forbidden_paths` overlap is a `validate` error naming the
   glob (automated: `node --test tools/tests/validation.test.mjs`).
2. `follow-ups.md`'s shape is documented in the updated `task-review.md`/`spec-audit.md`,
   and a `NON_BLOCKING` finding can be recorded into it via the "record as follow-up"
   action (inspection + manual trace).
3. `spec-finalize` blocks on an open, `blocks-completion: true` follow-up entry
   (automated: extends `tools/tests/task-lifecycle.test.mjs` or a new
   `finalize.test.mjs`).
4. `templates/task.md` documents the per-criterion evidence tag syntax (inspection).

## Verification

```
node --test tools/tests/validation.test.mjs
node --test tools/tests/task-lifecycle.test.mjs
node tools/specs.mjs validate
```

## Documentation impact

`templates/task.md`, `task-review.md`, `spec-audit.md`, `spec-finalize.md`.

## Out of scope

- The mechanical task type itself (task 07) — this task only builds the
  `consequential_paths`/follow-up/evidence-tag primitives it depends on.
- Retrofitting existing (non-this-change) task files with the new tag syntax.
