---
id: nevo-ai-process-continuity-and-hardening.scope-and-follow-up-mechanisms
status: draft
change: nevo-ai-process-continuity-and-hardening
context:
  required:
    - specs/active/nevo-ai-process-continuity-and-hardening/areas/context-and-validation-hardening.md
    - specs/active/nevo-ai-process-continuity-and-hardening/owner-decisions.md
    - tools/specs/validation.mjs
    - tools/specs/service.mjs
    - .claude/skills/nevo-ai-spec-workflow/templates/task.md
    - .claude/skills/nevo-ai-spec-workflow/references/review-policy.md
    - .claude/commands/nevo-ai/task-review.md
    - .claude/commands/nevo-ai/spec-finalize.md
  optional:
    - .claude/commands/nevo-ai/spec-audit.md
allowed_paths:
  - tools/specs/validation.mjs
  - tools/specs/service.mjs
  - tools/specs/lifecycle.mjs
  - tools/specs.mjs
  - tools/tests/validation.test.mjs
  - tools/tests/follow-ups.test.mjs
  - .claude/skills/nevo-ai-spec-workflow/templates/task.md
  - .claude/commands/nevo-ai/task-review.md
  - .claude/commands/nevo-ai/spec-finalize.md
  - .claude/commands/nevo-ai/spec-audit.md
consequential_paths:
  - specs/active/nevo-ai-process-continuity-and-hardening/follow-ups.md
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
  - docs/development/**
  - docs/usage/**
---

# Task: Scope and follow-up mechanisms

> Refined 2026-08-04 (see `owner-decisions.md` D13, D15) — `context_exception` is now a
> list of `{omitted, decision, reason}` entries that must resolve to a real owner
> decision and affects the task-level fingerprint; the follow-up ledger is explicitly a
> mutable current-state list, never described as append-only.

## Goal

Add `context_exceptions` (owner-decision-referenced, fingerprint-affecting) and
`consequential_paths` to the schema, the mutable `follow-ups.md` ledger, `spec-finalize`'s
block-on-open-blocking-follow-up check, and per-criterion acceptance-criteria
verification tags.

## Dependencies

`context-completeness-and-routing-precedence` — shares the same schema surface this task
extends further; `context_exceptions` suppresses that task's completeness warning.

## Implementation constraints

- `context_exceptions: [{omitted: <path>, decision: <D-id>, reason: <text>}]` —
  `validateSpecs` rejects an entry whose `decision` doesn't resolve to an entry in the
  change's own `owner-decisions.md`. This field is included in
  `computeTaskFingerprint`'s projection (task 01 reserved the field; this task populates
  it) — a change to `context_exceptions` invalidates the task-level fingerprint.
- `consequential_paths` is a sibling list to `allowed_paths`, optional, task-level.
  `validateSpecs` rejects a task file where any `consequential_paths` glob overlaps
  `forbidden_paths`, naming the overlapping glob.
- A write inside `consequential_paths` is not flagged as a scope violation by
  `task-review.md`'s existing step 4 instruction — update that instruction; no
  enforcement script exists today to diff `allowed_paths` against `git diff`, and this
  task does not introduce one as a prerequisite.
- `follow-ups.md` lives at `specs/active/<change-id>/follow-ups.md`, one **mutable**
  file per change — not append-only. Fields per entry: `id`, `source_task`, `kind`,
  `severity` (`blocking`/`non-blocking`), `reason`, `resolver_task` (nullable), `status`
  (`open`/`resolved`/`dismissed`), `resolution` (populated on resolve/dismiss).
- Dismissing a `blocking` entry requires a recorded owner decision (a new
  `owner-decisions.md` entry, referenced from the follow-up's `resolution`); a
  `non-blocking` entry may be dismissed by whoever applies the resolution.
- `validateSpecs` detects a `resolver_task` that doesn't resolve to a real task id (in
  the same or an explicitly named change) and reports it as stale.
- `task-review.md` and `spec-audit.md` gain an explicit "record as follow-up" action for
  a `NON_BLOCKING` finding — this does not change how `AUTO_FIX`/`OWNER_DECISION`/
  `NEEDS_CLARIFICATION` findings are categorized or handled.
- `validateFinalize` (`lifecycle.mjs`) gains a check: any `follow-ups.md` entry with
  `severity: blocking` and `status: open` fails finalize, naming the entry, evaluated
  alongside the existing terminal-task check.
- `templates/task.md`'s acceptance-criteria section documents the optional per-criterion
  tag syntax (`automated:`/`inspection:`/`owner-decision:`).

## Acceptance criteria

1. An unresolvable `context_exceptions[].decision` is a `validate` error (automated:
   `node --test tools/tests/validation.test.mjs`).
2. A valid `context_exceptions` entry changes `computeTaskFingerprint`'s output for that
   task and no other (automated, extends task 01's fingerprint suite).
3. A `consequential_paths`/`forbidden_paths` overlap is a `validate` error naming the
   glob (automated, same suite).
4. `follow-ups.md` entries are mutated in place — a resolve/dismiss action changes the
   existing entry's `status`, never appends a new entry for the same follow-up
   (automated: `node --test tools/tests/follow-ups.test.mjs`).
5. Dismissing a `blocking` entry without a referenced owner decision is rejected
   (automated, same suite).
6. A stale `resolver_task` reference is detected by `validateSpecs` (automated, same
   suite).
7. `spec-finalize` blocks on an open, `blocking`-severity follow-up entry (automated:
   extends `tools/tests/task-lifecycle.test.mjs` or a new `finalize.test.mjs`).
8. `templates/task.md` documents the per-criterion evidence tag syntax (inspection).

## Verification

```
node --test tools/tests/validation.test.mjs
node --test tools/tests/follow-ups.test.mjs
node --test tools/tests/fingerprint.test.mjs
node --test tools/tests/task-lifecycle.test.mjs
node tools/specs.mjs validate
```

## Documentation impact

`templates/task.md`, `task-review.md`, `spec-audit.md`, `spec-finalize.md`.

## Out of scope

- The mechanical task type itself (task 07) — this task only builds the primitives it
  depends on.
- Retrofitting existing (non-this-change) task files with the new tag syntax.
- An event-sourced or history-preserving ledger — explicitly rejected (D15).
