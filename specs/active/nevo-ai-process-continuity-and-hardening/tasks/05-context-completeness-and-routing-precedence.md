---
id: nevo-ai-process-continuity-and-hardening.context-completeness-and-routing-precedence
status: draft
change: nevo-ai-process-continuity-and-hardening
context:
  required:
    - specs/active/nevo-ai-process-continuity-and-hardening/areas/context-and-validation-hardening.md
    - tools/specs/service.mjs
    - tools/specs.mjs
    - docs/ai/task-routing.md
    - docs/ai/change-impact-map.md
    - docs/ai/how-to-navigate.md
  optional:
    - tools/specs/validation.mjs
allowed_paths:
  - tools/specs/service.mjs
  - tools/specs.mjs
  - tools/specs/validation.mjs
  - tools/tests/context.test.mjs
  - docs/ai/how-to-navigate.md
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
  - docs/development/**
  - docs/usage/**
  - docs/ai/task-routing.md
  - docs/ai/change-impact-map.md
---

# Task: Context completeness and routing precedence

## Goal

Add a deterministic, path-only derivation that suggests relevant context from
`docs/ai/task-routing.md` and `docs/ai/change-impact-map.md`, diffs it against a task's
declared `context.required`/`optional`, and warns (never blocks) on a material gap;
support an explicit `context_exception` override; state the precedence rule in
`how-to-navigate.md`.

## Dependencies

`state-and-fingerprint-semantics` — no functional dependency beyond running on top of a
consistent schema; ordered here per the change's rollout plan.

## Implementation constraints

- Matching is path-glob only (same rule already documented for humans in
  `how-to-navigate.md`) — no content/semantic search, no full-repository scan.
- A declared `context.required`/`optional` entry always wins over a routing-doc
  suggestion when they conflict; routing-doc suggestions only ever add gap-check
  candidates.
- The completeness check is a warning surfaced by `tools/specs.mjs context` (and
  optionally `validate`, as a non-gating note) — it must never turn into a hard failure
  of `context`/`validate`/`start`.
- `context_exception: <reason>` in task front matter suppresses the warning for that
  task; `validateSpecs` does not require a reason format beyond non-empty text.
- Do not read `docs/ai/task-routing.md`/`docs/ai/change-impact-map.md` content into this
  task's `allowed_paths` for writing — this task reads them, it does not modify them
  (hence they are absent from `allowed_paths` and explicitly listed in
  `forbidden_paths`).

## Acceptance criteria

1. A task whose `allowed_paths` overlap a `change-impact-map.md`/`task-routing.md` entry
   not present in its declared context produces a warning, not a `validate` failure
   (automated: `node --test tools/tests/context.test.mjs`).
2. `context_exception` suppresses that warning for the same task (automated).
3. `docs/ai/how-to-navigate.md` states the precedence rule (a task's own declared context
   always wins) explicitly (inspection).

## Verification

```
node --test tools/tests/context.test.mjs
node tools/specs.mjs validate
node tools/docs.mjs validate
```

## Documentation impact

`docs/ai/how-to-navigate.md` — precedence rule between declared context and routing-doc
suggestions.

## Out of scope

- Modifying `task-routing.md`/`change-impact-map.md` content.
- `consequential_paths`, the follow-up ledger, and structured acceptance-criteria
  evidence tags (task 06).
