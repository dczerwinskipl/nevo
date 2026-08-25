---
id: refaktoring-tooli.area.dashboard-frontend-and-runtime
type: area
change: refaktoring-tooli
---

# Area: Dashboard Frontend and Runtime

## Responsibility

Owns the React frontend application under `tools/dashboard/src/`, including user interface components, custom TanStack Query hooks, the assistant runtime (`nevo-assistant-runtime.ts`), view-model projections, and routing structure.

## Current state

- `lib/nevo-assistant-runtime.ts` (953 LOC) bundles Assistant UI integration, local dispatch state machines, event mapping, and subscription handling.
- `components/spec-detail.tsx` (784 LOC) combines tab navigation, task editors, metadata forms, follow-up views, batch operations, and Markdown rendering.
- `hooks/use-dashboard-data.ts` (706 LOC) is a monolithic file combining data queries and mutations for the entire application.
- `components/changes-panel.tsx` (676 LOC) mixes PR selection, file trees, diff views, and branch expansion controls.
- `components/ai-chat.tsx` (521 LOC) and `router.tsx` (497 LOC) contain multiple coupled responsibilities in single files.
- Violates §1.1, §1.3, §2.4, §3, §6.2, §7, and §11 of `react-component-guidelines.md`.

## Requirements

- Decompose `hooks/use-dashboard-data.ts` into domain-focused hooks under `tools/dashboard/src/hooks/`:
  - `use-specs.ts` — specification and task queries/mutations.
  - `use-changes.ts` / `use-pull-requests.ts` — PR, diff, and file change queries.
  - `use-operations.ts` — asynchronous operation execution and progress subscriptions.
  - `use-ai-sessions.ts` — AI sessions and thread management.
- Decompose `lib/nevo-assistant-runtime.ts` into modular layers:
  - `runtime/chat-state-machine.ts` — pure message, thread, and status state management.
  - `runtime/assistant-ui-adapter.ts` — bridge to `@assistant-ui/react`.
  - `runtime/event-mapper.ts` — SSE event mapping to UI structures.
- Decompose oversized components under `tools/dashboard/src/components/`:
  - `components/spec-detail/` (`spec-header.tsx`, `tasks-tab.tsx`, `overview-tab.tsx`, `metadata-card.tsx`, `follow-ups-list.tsx`).
  - `components/changes-panel/` (`pr-selector.tsx`, `file-tree-view.tsx`, `file-diff-item.tsx`, `diff-toolbar.tsx`).
  - `components/ai-chat/` (`chat-container.tsx`, `session-switcher.tsx`, `tool-call-card.tsx`, `reasoning-panel.tsx`).
- Organize route definitions in `router.tsx` into modular route files.
- Keep complex data projections outside JSX as pure view-model functions (§7).
- Utilize existing Tailwind semantic tokens and Radix UI primitives (§4).

## Interfaces and boundaries

The frontend communicates with the server backend through REST APIs and SSE event streams. UI components should receive typed domain props and emit user intentions via callbacks or domain hooks.

## Area-specific acceptance criteria

1. No frontend component or hook exceeds ~250–300 LOC.
2. Complex data transformations are extracted into pure view-model functions in `src/lib/` with dedicated unit tests.
3. Production build (`npm --prefix tools/dashboard run build`) succeeds without TypeScript type errors.
4. All tests in `tools/dashboard/tests/` pass cleanly.

## Out of scope

- UI redesign (the visual presentation and styling layout remain identical).
- Changing frontend framework dependencies (retaining React 19, Tailwind, TanStack, Radix).
