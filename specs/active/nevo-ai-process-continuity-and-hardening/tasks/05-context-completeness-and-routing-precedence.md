---
id: nevo-ai-process-continuity-and-hardening.context-completeness-and-routing-precedence
status: draft
change: nevo-ai-process-continuity-and-hardening
context:
  required:
    - specs/active/nevo-ai-process-continuity-and-hardening/areas/context-and-validation-hardening.md
    - specs/active/nevo-ai-process-continuity-and-hardening/owner-decisions.md
    - tools/specs/service.mjs
    - tools/specs.mjs
    - tools/docs.mjs
    - docs/ai/task-routing.md
    - docs/ai/change-impact-map.md
    - docs/ai/how-to-navigate.md
  optional:
    - tools/specs/validation.mjs
allowed_paths:
  - tools/specs/service.mjs
  - tools/specs.mjs
  - tools/specs/validation.mjs
  - tools/docs.mjs
  - tools/tests/context.test.mjs
  - tools/tests/docs-routing.test.mjs
  - docs/ai/how-to-navigate.md
  - docs/ai/task-routing.md
  - docs/ai/change-impact-map.md
consequential_paths:
  - docs/routing.generated.json
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
  - docs/development/**
  - docs/usage/**
---

# Task: Context completeness and routing precedence

> Refined 2026-08-04 (see `owner-decisions.md` D12) — routing is no longer parsed from
> free-form prose. `task-routing.md`/`change-impact-map.md` gain a validated table; a
> generated `docs/routing.generated.json` is the only thing the completeness check reads.

## Goal

Add a fixed-column, validated routing table to `docs/ai/task-routing.md` and
`docs/ai/change-impact-map.md`; generate `docs/routing.generated.json` from it; add a
deterministic context-completeness check that reads only the generated JSON, diffs it
against a task's declared `context.required`/`optional`, and warns (never blocks) on a
material gap; state the precedence rule in `how-to-navigate.md`.

## Dependencies

`state-and-fingerprint-semantics` — ordered here per the change's rollout plan; no
functional dependency beyond a consistent schema.

## Implementation constraints

- Table shape: `rule_id | path_glob | doc_ref`, one row per rule. `rule_id` must be
  unique within and across both files — `tools/docs.mjs validate` enforces both the
  shape and the uniqueness.
- `tools/docs.mjs generate` emits `docs/routing.generated.json` from the validated
  tables; `tools/docs.mjs check` fails if it's stale relative to the source tables (same
  convention as every other generated index in this repo). It is declared in
  `consequential_paths`, not `allowed_paths`, since regenerating it is a direct,
  mechanical consequence of editing the source tables — not a second thing this task
  independently decides to write.
- The context-completeness check (a new `tools/specs.mjs` subcommand or an extension of
  `context`) reads only `docs/routing.generated.json` — it must never open
  `task-routing.md`/`change-impact-map.md` at check time.
- Matching is path-glob only (`path_glob` vs. the task's `allowed_paths`) — no
  content/semantic search, no full-repository scan.
- A declared `context.required`/`optional` entry always wins over a routing-table
  suggestion when they conflict; suggestions only ever add gap-check candidates.
- The completeness check is a warning, never a hard failure of `context`/`validate`/
  `start`.
- When no routing rule matches a task's paths at all, report "no routing rule matched —
  verify context manually" (a warning, not silent success and not a failure).
- `context_exceptions` (task 06) is not implemented by this task — this task's warning
  mechanism only needs to exist; task 06 adds the suppression field.

## Acceptance criteria

1. `tools/docs.mjs validate` rejects a routing table with a duplicate `rule_id` or a
   malformed row (automated: `node --test tools/tests/docs-routing.test.mjs`).
2. `tools/docs.mjs check` fails when `docs/routing.generated.json` is stale relative to
   the source tables (automated, same suite).
3. A task whose `allowed_paths` match a routing rule not present in its declared context
   produces a warning, not a `validate` failure, and the check reads only the generated
   JSON — never the source Markdown — at check time (automated: `node --test
   tools/tests/context.test.mjs`, verified by asserting the check still works after
   temporarily corrupting the prose table body while leaving the generated JSON intact).
4. A task with no matching routing rule produces the "verify context manually" warning,
   not silent success (automated).
5. `docs/ai/how-to-navigate.md` states the precedence rule explicitly (inspection).

## Verification

```
node --test tools/tests/docs-routing.test.mjs
node --test tools/tests/context.test.mjs
node tools/specs.mjs validate
node tools/docs.mjs validate
node tools/docs.mjs check
```

## Documentation impact

`docs/ai/task-routing.md`, `docs/ai/change-impact-map.md` (add the validated table),
`docs/ai/how-to-navigate.md` (precedence rule).

## Out of scope

- `context_exceptions` (task 06).
- `consequential_paths`, the follow-up ledger, and structured acceptance-criteria
  evidence tags (task 06).
