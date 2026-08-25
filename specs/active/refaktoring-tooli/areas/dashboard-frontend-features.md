---
id: refaktoring-tooli.area.dashboard-frontend-features
type: area
change: refaktoring-tooli
---

# Area: Dashboard Frontend Features

## Responsibility

Owns the React frontend application under `tools/dashboard/src/`, structured into vertical feature slices (Specification Detail, Changes & Diffs, AI Assistant Chat), reusable UI primitives, custom query hooks, and view-model projections.

## Current state

- `hooks/use-dashboard-data.ts` is a monolithic global hook mixing unrelated domain queries (specifications, pull requests/diffs, operations, AI sessions).
- `lib/nevo-assistant-runtime.ts` bundles Assistant UI integration, local dispatch state machines, event mapping, and subscription handling.
- Feature components (`spec-detail.tsx`, `changes-panel.tsx`, `ai-chat.tsx`) bundle multiple independent responsibilities: embedded modal dialogs with independent interaction/focus lifecycles, heavy data transformation/grouping inside JSX, and viewport/scroll tracking.
- Feature-specific helpers and projections (`chat-projection.ts`, `changes-grouping.ts`, `ai-chat-helpers.ts`, `tool-activity-labels.ts`, `use-scroll-follow.ts`, `pending-dispatch-store.ts`) are scattered globally in `src/lib/`.

## Requirements

- Organize the frontend around cohesive vertical feature slices:
  - **Spec Detail Slice:** `spec-detail` component, extracted dialogs (`TaskDialog`, `FinalizeDialog`, `RepositoryActionsCard`), domain query hook (`use-specs.ts`), and feature-local projections.
  - **Changes & PR Diffs Slice:** `changes-panel` component, PR selector, file tree, progressive diff hydrator, domain query hook (`use-changes.ts`), and feature-local `changes-grouping.ts`.
  - **AI Assistant Chat Slice:** `ai-chat` component, `ai-session-list`, assistant runtime (`nevo-assistant-runtime.ts`), domain query hook (`use-ai-sessions.ts`), and feature-local helpers (`chat-projection.ts`, `use-scroll-follow.ts`, `ai-chat-helpers.ts`).
- Extract independent interaction contracts (dialogs, drawers, modal forms) into dedicated subcomponents with clear lifecycle ownership.
- Extract heavy data transformations outside JSX into pure feature-local view-model functions, promoting to shared `src/lib/` only when there is genuine cross-feature reuse.
- Keep small private render helpers local to their parent component where appropriate.
- Utilize existing Tailwind semantic tokens and Radix UI accessibility primitives.

## Interfaces and boundaries

The frontend communicates with the server backend through REST APIs and SSE event streams. UI components receive typed domain props and emit user intentions via callbacks or domain hooks.

## Area-specific acceptance criteria

1. Query hooks and view-models are owned vertically beside their consuming feature slices rather than monolithic global files.
2. Independent interaction contracts (dialogs, drawers) have clear lifecycle ownership.
3. Complex data transformations are extracted into pure feature-local view-model functions with dedicated unit tests.
4. Production build (`npm --prefix tools/dashboard run build`) succeeds without TypeScript type errors.
5. All tests in `tools/dashboard/tests/` pass cleanly.

## Out of scope

- UI visual redesign (the visual presentation, layout, and styling remain identical).
- Changing frontend framework dependencies (retaining React 19, Tailwind, TanStack, Radix).
