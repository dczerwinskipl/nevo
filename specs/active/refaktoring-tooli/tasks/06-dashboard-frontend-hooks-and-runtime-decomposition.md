---
id: refaktoring-tooli.dashboard-frontend-hooks-and-runtime-decomposition
status: draft
change: refaktoring-tooli
context:
  required:
    - specs/active/refaktoring-tooli/overview.md
    - specs/active/refaktoring-tooli/owner-decisions.md
    - specs/active/refaktoring-tooli/areas/dashboard-frontend-and-runtime.md
    - docs/development/node-tooling-guidelines.md
    - docs/development/react-component-guidelines.md
    - tools/dashboard/src/lib/nevo-assistant-runtime.ts
    - tools/dashboard/src/hooks/use-dashboard-data.ts
  optional: []
allowed_paths:
  - tools/dashboard/src/hooks/**
  - tools/dashboard/src/lib/**
  - tools/dashboard/tests/view-models/**
  - tools/dashboard/tests/server/**
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D4]
  constraints: [C1, C2, C4, C6, C8]
---

# Task: Dashboard frontend hooks and runtime decomposition

## Goal

Decompose the oversized assistant runtime adapter `tools/dashboard/src/lib/nevo-assistant-runtime.ts` (953 LOC) and the global query file `tools/dashboard/src/hooks/use-dashboard-data.ts` (706 LOC) into focused domain hooks and single-responsibility runtime modules.

## Implementation constraints

- Split `use-dashboard-data.ts` into dedicated hooks under `tools/dashboard/src/hooks/`:
  - `use-specs.ts` (queries and mutations for specifications and tasks)
  - `use-changes.ts` (queries for pull requests, diffs, and changed files)
  - `use-operations.ts` (asynchronous operations and progress subscriptions)
  - `use-ai-sessions.ts` (AI sessions and conversation threads)
  - Retain `use-dashboard-data.ts` as a re-export layer to facilitate incremental component migration.
- Decompose `nevo-assistant-runtime.ts` into:
  - `lib/runtime/chat-state-machine.ts` (pure message and thread state management)
  - `lib/runtime/assistant-ui-adapter.ts` (bridge to `@assistant-ui/react`)
  - `lib/runtime/event-mapper.ts` (SSE event mapping)
- Move pure data transformations to dedicated view-model functions under `src/lib/` covered by unit tests.

## Acceptance criteria

1. No newly created hook or runtime module exceeds ~250–300 LOC.
2. Assistant logic and data fetching maintain 100% behavioral parity with existing UI interactions. `automated: npm --prefix tools/dashboard test`
3. TypeScript compilation (`tsc -b`) passes without errors. `automated: npm --prefix tools/dashboard run build`

## Verification

```text
npm --prefix tools/dashboard run build
npm --prefix tools/dashboard test
node tools/specs.mjs validate
```

## Out of scope

- Modifying JSX layout in components (handled in task 07).
