---
id: exit-gate-improvements.derived-registry-and-deterministic-generators
status: draft
change: exit-gate-improvements
context:
  required:
    - specs/active/exit-gate-improvements/overview.md
    - specs/active/exit-gate-improvements/areas/01-derived-artifacts.md
    - tools/specs/indexes.mjs
    - tools/docs/service.mjs
  optional:
    - specs/active/exit-gate-improvements/discovery.md
allowed_paths:
  - tools/specs/derived/**
  - tools/specs/indexes.mjs
  - tools/docs/service.mjs
  - tools/tests/derived-artifacts.test.mjs
  - tools/tests/index-generation.test.mjs
forbidden_paths:
  - tools/specs/workflow/**
  - tools/dashboard/**
  - src/**
semantic_references:
  decisions: [D2, D4]
---

# Task: Derived-artifact registry and deterministic generators

## Goal

Introduce the static generator registry and make both generators idempotent, with no
engine integration yet.

## Implementation constraints

- Static array registry; no event bus, plugin loading or DI.
- Wrap existing build/write/check functions; do not duplicate their logic.
- `writeDocsIndexes` must preserve the previous `generated` timestamp (JSON and the
  `_Generated:` Markdown line) when content is unchanged.

## Acceptance criteria

- `planDerivedSync(paths)` returns only generators whose inputs match; `change.yaml` ⇒
  specs only, `docs/**/*.md` ⇒ docs only, unrelated path ⇒ none. `automated: node --test tools/tests/derived-artifacts.test.mjs`
- `resolveDerivedOwnedPaths` returns exact output paths of planned generators only.
- Running `sync` twice on a fixture yields byte-identical outputs and no git diff for
  both generators.
- Inventory in this task's PR notes: every consumer of `specs/index.generated.json`
  `tasks[].workflow_progress` (input for decision D4). `inspection: grep results listed`

## Verification

```bash
node --test tools/tests/derived-artifacts.test.mjs
node --test tools/tests/index-generation.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Engine, commit-action, publish or batch integration; index projection change (task 04).
