---
id: refaktoring-tooli.dashboard-frontend-query-hooks-and-runtime-state
status: draft
change: refaktoring-tooli
context:
  required:
    - specs/active/refaktoring-tooli/overview.md
    - specs/active/refaktoring-tooli/owner-decisions.md
    - specs/active/refaktoring-tooli/areas/dashboard-frontend-architecture.md
    - docs/development/react-component-guidelines.md
    - docs/development/node-tooling-guidelines.md
    - tools/dashboard/src/hooks/use-dashboard-data.ts
    - tools/dashboard/src/lib/nevo-assistant-runtime.ts
  optional: []
allowed_paths:
  - tools/dashboard/src/hooks/**
  - tools/dashboard/src/lib/**
  - tools/dashboard/tests/**
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D4]
  constraints: [C1, C2, C4, C6, C8]
---

# Task: Dashboard frontend query hooks and runtime state

## Goal

Decompose the monolithic global query file `tools/dashboard/src/hooks/use-dashboard-data.ts` and assistant runtime adapter `tools/dashboard/src/lib/nevo-assistant-runtime.ts` into domain-focused query hooks and modular runtime state layers.

## Problem

- `hooks/use-dashboard-data.ts` acts as a monolithic catch-all hook combining unrelated queries and mutations (specifications, pull request diffs, operations, AI sessions) across the entire application (§6.2 of `react-component-guidelines.md`).
- `lib/nevo-assistant-runtime.ts` conflates Assistant UI adapter bridge bindings, local dispatch stores, SSE event stream mapping, and message state transitions (§8.1).

## Expected outcome

- `use-dashboard-data.ts` is split into domain-focused query hooks under `tools/dashboard/src/hooks/` (e.g. `use-specs.ts`, `use-changes.ts`, `use-operations.ts`, `use-ai-sessions.ts`), retaining a backward-compatible re-export module if needed.
- `nevo-assistant-runtime.ts` is decomposed into modular layers separating pure chat message state management, `@assistant-ui/react` runtime adapter bindings, and SSE event mapping.
- Pure data projections and transformations are kept in `src/lib/` and covered by unit tests.

## Preserved contracts & behavior

- All frontend queries, cache invalidation keys, mutation behavior, assistant messaging interactions, and optimistic updates must behave identically.

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
node tools/specs.mjs validate
```

## Out of scope

- Refactoring visual JSX components (handled in task 06).
