---
id: refaktoring-tooli.area.dashboard-frontend-features
type: area
change: refaktoring-tooli
---

# Area: Dashboard Frontend Features

## Responsibility

Owns the React frontend application under `tools/dashboard/src/`, structured into vertical feature slices (Specification Detail, Changes & Diffs, AI Assistant Chat), reusable UI primitives, and feature-local view-model projections.

## Current state

- `hooks/use-dashboard-data.ts` is a monolithic global hook mixing unrelated domain queries (specifications, pull requests/diffs, operations, AI sessions).
- `lib/nevo-assistant-runtime.ts` bundles Assistant UI integration, local dispatch state machines, event mapping, and subscription handling.
- In `spec-detail.tsx`, document/section projection and tab navigation are intermingled with overview composition and batch polling.
- In `changes-panel.tsx`, pull request selection, hierarchical file tree rendering, progressive hydration queues, and diff viewer controls are mixed together.
- In `ai-chat.tsx`, visual viewport/keyboard tracking (`useChatVisualViewport`) and session creation dialogs (`CreateAiSessionDialog`) are bundled with page layout orchestration.
- Feature-specific helpers and projections (`chat-projection.ts`, `changes-grouping.ts`, `ai-chat-helpers.ts`, `tool-activity-labels.ts`, `use-scroll-follow.ts`, `pending-dispatch-store.ts`) are scattered globally in `src/lib/`.

## Requirements

- Organize the frontend around cohesive vertical feature slices:
  - **Spec Detail Slice:** `spec-detail` component, document/section projection, overview composition, and feature-local spec queries.
  - **Changes & PR Diffs Slice:** `changes-panel` component, PR selector, file tree, progressive diff hydrator, feature-local changes queries, and feature-local `changes-grouping.ts`.
  - **AI Assistant Chat Slice:** `ai-chat` component, `useChatVisualViewport`, `CreateAiSessionDialog`, assistant runtime (`nevo-assistant-runtime.ts`), feature-local AI session queries, and feature-local helpers (`chat-projection.ts`, `use-scroll-follow.ts`, `ai-chat-helpers.ts`).
- Migrate internal callers from `use-dashboard-data.ts` to feature-local query hooks, retiring redundant forwarding exports as migrations complete.
- Extract independent interaction contracts (e.g. `CreateAiSessionDialog`, diff viewer controls) into dedicated subcomponents with clear lifecycle ownership.
- Extract heavy data transformations outside JSX into pure feature-local view-model functions, promoting to shared `src/lib/` only when there is genuine cross-feature reuse.
- Keep small private render helpers local to their parent component where appropriate.
- Utilize existing Tailwind semantic tokens and Radix UI accessibility primitives.

## Interfaces and boundaries

The frontend communicates with the server backend through REST APIs and SSE event streams. UI components receive typed domain props and emit user intentions via callbacks or domain hooks.

## Area-specific acceptance criteria

1. Query hooks and view-models are owned vertically beside their consuming feature slices rather than monolithic global files.
2. Independent interaction contracts (dialogs, drawers, form modals) have clear lifecycle ownership.
3. Complex data transformations are extracted into pure feature-local view-model functions with dedicated unit tests.
4. Production build (`npm --prefix tools/dashboard run build`) succeeds without TypeScript type errors.
5. All tests in `tools/dashboard/tests/` pass cleanly.

## Out of scope

- UI visual redesign (the visual presentation, layout, and styling remain identical).
- Changing frontend framework dependencies (retaining React 19, Tailwind, TanStack, Radix).
