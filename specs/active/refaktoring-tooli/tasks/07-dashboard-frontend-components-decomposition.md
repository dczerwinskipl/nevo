---
id: refaktoring-tooli.dashboard-frontend-components-decomposition
status: draft
change: refaktoring-tooli
context:
  required:
    - specs/active/refaktoring-tooli/overview.md
    - specs/active/refaktoring-tooli/owner-decisions.md
    - specs/active/refaktoring-tooli/areas/dashboard-frontend-and-runtime.md
    - docs/development/react-component-guidelines.md
    - tools/dashboard/src/components/spec-detail.tsx
    - tools/dashboard/src/components/changes-panel.tsx
    - tools/dashboard/src/components/ai-chat.tsx
    - tools/dashboard/src/router.tsx
  optional: []
allowed_paths:
  - tools/dashboard/src/components/**
  - tools/dashboard/src/router.tsx
  - tools/dashboard/src/router-tree.ts
  - tools/dashboard/tests/ui/**
  - tools/dashboard/tests/integration/**
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D4]
  constraints: [C1, C2, C4, C6, C8]
---

# Task: Dashboard frontend components decomposition

## Goal

Decompose oversized view components `components/spec-detail.tsx` (784 LOC), `components/changes-panel.tsx` (676 LOC), `components/ai-chat.tsx` (521 LOC), and `router.tsx` (497 LOC) into small, focused composable components in feature-local subfolders, adhering to guidelines for pure JSX, Tailwind tokens, and Radix primitives.

## Implementation constraints

- Decompose `components/spec-detail.tsx` into `components/spec-detail/`:
  - `spec-detail-view.tsx` (main composition container)
  - `spec-header.tsx` (title, status, metadata)
  - `tasks-tab.tsx` (task list and filtering)
  - `overview-tab.tsx` (Markdown content and details)
  - `follow-ups-list.tsx` (follow-up ledger display)
- Decompose `components/changes-panel.tsx` into `components/changes-panel/`:
  - `changes-panel-view.tsx` (main view container)
  - `pr-selector.tsx` (pull request selection and metadata)
  - `file-tree-view.tsx` (file list tree and status badges)
  - `file-diff-item.tsx` (individual file diff view)
- Decompose `components/ai-chat.tsx` into `components/ai-chat/`:
  - `chat-layout.tsx` (chat container and layout panels)
  - `session-switcher.tsx` (session selection)
  - `reasoning-panel.tsx` (model reasoning visualization)
- Modularize route definitions in `router.tsx` into clean route modules.
- Extract heavy data computations and groupings outside JSX into pure view-model functions.

## Acceptance criteria

1. No component file exceeds ~250–300 LOC. `inspection: line count components < 300`
2. All views render and behave identically in terms of user interaction, styling, and accessibility. `automated: npm --prefix tools/dashboard test`
3. TypeScript compilation and production Vite build succeed without errors. `automated: npm --prefix tools/dashboard run build`

## Verification

```text
npm --prefix tools/dashboard run build
npm --prefix tools/dashboard test
node tools/specs.mjs validate
```

## Out of scope

- Visual redesign (styling and UI layout remain unchanged).
