---
id: refaktoring-tooli.dashboard-frontend-feature-components-decomposition
status: draft
change: refaktoring-tooli
context:
  required:
    - specs/active/refaktoring-tooli/overview.md
    - specs/active/refaktoring-tooli/owner-decisions.md
    - specs/active/refaktoring-tooli/areas/dashboard-frontend-architecture.md
    - docs/development/react-component-guidelines.md
    - tools/dashboard/src/components/spec-detail.tsx
    - tools/dashboard/src/components/changes-panel.tsx
    - tools/dashboard/src/components/ai-chat.tsx
  optional: []
allowed_paths:
  - tools/dashboard/src/components/**
  - tools/dashboard/src/lib/**
  - tools/dashboard/tests/**
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D4]
  constraints: [C1, C2, C4, C6, C8]
---

# Task: Dashboard frontend feature components decomposition

## Goal

Decompose complex feature components (`components/spec-detail.tsx`, `components/changes-panel.tsx`, `components/ai-chat.tsx`) into composable subcomponents, extracting independent interaction contracts (dialogs, drawers) and pure data projections out of JSX while keeping small private render helpers local.

## Problem

- In `components/spec-detail.tsx`: embedded task dialogs, follow-up forms, and metadata editing with independent focus and modal lifecycles obscure page-level orchestration; data projection and filtering logic are embedded directly inside JSX.
- In `components/changes-panel.tsx`: pull request selection, file tree rendering, progressive hydration queues, and diff viewer controls are mixed together.
- In `components/ai-chat.tsx`: chat layout orchestration is coupled with live tool execution cards, reasoning view panels, and viewport/scroll lifecycle tracking.
- Violates §1.1, §2.3, §2.4, §5.3, and §7 of `react-component-guidelines.md`.

## Expected outcome

- Independent interaction contracts (e.g. task detail dialogs, follow-up forms, session creators, file diff items) are extracted into dedicated subcomponents with clear lifecycle ownership.
- Heavy data calculations and grouping logic are moved out of JSX into pure feature-local view-model functions (or shared `src/lib/` where reused).
- Page and container components read clearly as orchestration and composition.
- Small private presentational helpers remain local where they own no independent state or lifecycle.
- Feature directories are created only where a feature has real internal structure (components + local hooks + view models).

## Preserved contracts & behavior

- All visual layout, styling, user interactions, keyboard navigation, and accessibility features must remain 100% identical.

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
node tools/specs.mjs validate
```

## Out of scope

- UI visual redesign (colors, typography, and component layout remain unchanged).
- Router structure modifications (`router.tsx`).
