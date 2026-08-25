---
id: refaktoring-tooli.spec-detail-and-workflow-feature-slice
status: draft
change: refaktoring-tooli
context:
  required:
    - specs/active/refaktoring-tooli/overview.md
    - specs/active/refaktoring-tooli/owner-decisions.md
    - specs/active/refaktoring-tooli/areas/dashboard-frontend-features.md
    - docs/development/react-component-guidelines.md
    - tools/dashboard/src/components/spec-detail.tsx
    - tools/dashboard/src/components/task-dialog.tsx
    - tools/dashboard/src/components/spec-actions.tsx
    - tools/dashboard/src/hooks/use-dashboard-data.ts
  optional: []
allowed_paths:
  - tools/dashboard/src/components/**
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

# Task: Specification detail and workflow feature slice

## Goal

Refactor the Specification Detail & Task Workflow capability into a cohesive vertical feature slice, extracting independent modal dialogs and pure data projections out of JSX, separating specification query hooks into `src/hooks/use-specs.ts`, and keeping feature-local projections close to the feature.

## Problem

- `components/spec-detail.tsx` is a composite component embedding task detail dialogs (`TaskDialog`), finalization modal dialogs (`FinalizeDialog`), and action footer cards (`TaskActionFooter`) with independent modal and focus lifecycles, obscuring page-level orchestration (§1.1, §2.3 of `react-component-guidelines.md`).
- Heavy data calculations (e.g. section tab resolution, metric counting, status summaries) are performed directly inside the JSX render path (§7).
- Specification queries (`useSpecificationManifest`, `useSpecificationDocument`, `useTaskStatuses`, `useSpecificationActions`, `useExecuteSpecificationAction`) are coupled in the global `use-dashboard-data.ts` rather than being owned by the specification feature domain (§2.4, §6.2).

## Expected outcome

- Independent interaction contracts (`TaskDialog`, `FinalizeDialog`, `RepositoryActionsCard`) have clear lifecycle ownership and are composed cleanly into `spec-detail`.
- Specification domain queries and mutations are extracted into a dedicated hook `use-specs.ts` (with backward-compatible re-exports in `use-dashboard-data.ts`).
- Pure data transformations and view-models are kept feature-local (e.g. within `spec-detail/` or alongside the feature) and unit-tested.
- Page components read clearly as orchestration and composition.

## Preserved contracts & behavior

- All visual layout, specification document viewing, task status displays, action dialog triggers, and keyboard navigation must behave identically.

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
node tools/specs.mjs validate
```

## Out of scope

- UI redesign (styling, colors, and layout remain unchanged).
- Refactoring pull request diffs or AI chat (handled in tasks 06 and 07).
