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

Refactor the Specification Detail & Task Workflow capability into a cohesive vertical feature slice, extracting document/section projections out of JSX, owning specification queries feature-locally, and migrating specification callers directly away from `use-dashboard-data.ts`.

## Problem

- In `components/spec-detail.tsx`, document/section projection (`DocumentationPanel`, `DocGroup`, `DocItem` grouping, tab icon resolution) and data calculations (metric counting, status summaries) are performed directly inside the JSX render path, obscuring high-level page composition (§1.1, §7 of `react-component-guidelines.md`).
- Specification queries (`useSpecificationManifest`, `useSpecificationDocument`, `useTaskStatuses`, `useSpecificationActions`, `useExecuteSpecificationAction`) are coupled in the global `use-dashboard-data.ts` rather than being owned feature-locally beside the specification feature domain (§2.4, §6.2).
- Batch action orchestration, polling intervals, and operation modal states are managed within the main component without clear boundary separation.

## Expected outcome

- Specification domain queries and mutations are extracted into a feature-local query module (e.g. beside `spec-detail` or within its feature directory), migrating specification callers directly away from `use-dashboard-data.ts`.
- Document and section projections (`DocumentationPanel`, tab resolution) are structured as focused feature-local subcomponents and pure view-model helpers covered by unit tests.
- Overview composition, metrics formatting, and batch action state are cleanly separated, keeping `spec-detail` focused on page orchestration.

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
- Refactoring pull request diffs or AI chat (handled sequentially in tasks 06 and 07).
