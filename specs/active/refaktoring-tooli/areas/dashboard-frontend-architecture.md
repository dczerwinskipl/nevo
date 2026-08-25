---
id: refaktoring-tooli.area.dashboard-frontend-architecture
type: area
change: refaktoring-tooli
---

# Area: Dashboard Frontend Architecture

## Responsibility

Owns the React frontend application under `tools/dashboard/src/`, including user interface components, custom TanStack Query hooks, the assistant runtime (`nevo-assistant-runtime.ts`), view-model projections, and routing structure.

## Current state

- `hooks/use-dashboard-data.ts` is a monolithic global hook mixing unrelated domain queries (specifications, pull requests/diffs, operations, AI sessions).
- `lib/nevo-assistant-runtime.ts` bundles Assistant UI integration, local dispatch state machines, event mapping, and subscription handling.
- `components/spec-detail.tsx`, `components/changes-panel.tsx`, and `components/ai-chat.tsx` bundle multiple independent responsibilities: embedded modal dialogs with independent interaction/focus lifecycles, heavy data transformation/grouping inside JSX, and viewport/scroll tracking.

## Requirements

- Decompose `hooks/use-dashboard-data.ts` into domain-focused query hooks under `tools/dashboard/src/hooks/`:
  - `use-specs.ts` — specification and task queries/mutations.
  - `use-changes.ts` / `use-pull-requests.ts` — PR, diff, and file change queries.
  - `use-operations.ts` — asynchronous operation execution and progress subscriptions.
  - `use-ai-sessions.ts` — AI sessions and conversation threads.
- Decompose `lib/nevo-assistant-runtime.ts` into modular layers:
  - Message state and dispatch state machines.
  - Bridge adapter to `@assistant-ui/react`.
  - SSE event mapping to UI structures.
- Decompose complex feature components:
  - Extract independent interaction contracts (dialogs, drawers, modal forms) into dedicated subcomponents.
  - Extract heavy data transformations and groupings outside JSX into pure view-model functions.
  - Keep small private render helpers local to their parent component where appropriate.
  - Create feature-local directories only where a feature has real internal structure.
- Utilize existing Tailwind semantic tokens and Radix UI accessibility primitives.

## Interfaces and boundaries

The frontend communicates with the server backend through REST APIs and SSE event streams. UI components receive typed domain props and emit user intentions via callbacks or domain hooks.

## Area-specific acceptance criteria

1. Query hooks are organized by domain capability rather than a single monolithic file.
2. Independent interaction contracts (dialogs, drawers) have clear lifecycle ownership.
3. Complex data transformations are extracted into pure view-model functions in `src/lib/` with dedicated unit tests.
4. Production build (`npm --prefix tools/dashboard run build`) succeeds without TypeScript type errors.
5. All tests in `tools/dashboard/tests/` pass cleanly.

## Out of scope

- UI redesign (the visual presentation, layout, and styling remain identical).
- Changing frontend framework dependencies (retaining React 19, Tailwind, TanStack, Radix).
