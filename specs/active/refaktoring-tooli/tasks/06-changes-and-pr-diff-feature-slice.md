---
id: refaktoring-tooli.changes-and-pr-diff-feature-slice
status: draft
change: refaktoring-tooli
context:
  required:
    - specs/active/refaktoring-tooli/overview.md
    - specs/active/refaktoring-tooli/owner-decisions.md
    - specs/active/refaktoring-tooli/areas/dashboard-frontend-features.md
    - docs/development/react-component-guidelines.md
    - tools/dashboard/src/components/changes-panel.tsx
    - tools/dashboard/src/lib/changes-grouping.ts
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

# Task: Changes and PR diff feature slice

## Goal

Refactor the Changes & Pull Request Diff capability into a cohesive vertical feature slice, modularizing the composite changes panel, organizing diff query hooks into `src/hooks/use-changes.ts`, and keeping diff grouping logic feature-local.

## Problem

- `components/changes-panel.tsx` mixes pull request selection, hierarchical file tree rendering, progressive hydration queues, and git-diff-view controls into one composite component (§1.1, §2.3 of `react-component-guidelines.md`).
- `lib/changes-grouping.ts` is placed globally in `src/lib/` despite being used solely by the changes panel feature (§2.4).
- Pull request queries (`useSpecificationPullRequests`, `useSpecificationPullRequestFiles`, `useSpecificationPullRequestFullDiff`, `useSpecificationPullRequestFileDiffs`) are mixed in the global `use-dashboard-data.ts` (§6.2).

## Expected outcome

- `changes-panel` is decomposed into focused subcomponents (e.g. PR selector, changed file tree item, diff viewer controls, progressive hydration queue) with clear ownership.
- Pull request and diff queries are extracted into `use-changes.ts` (with backward-compatible re-exports in `use-dashboard-data.ts`).
- `changes-grouping.ts` and related diff projection logic remain feature-local to the changes feature slice.

## Preserved contracts & behavior

- All pull request selection, file diff expanding/collapsing, side-by-side / unified diff switching, and progressive hydration behavior must remain 100% identical.

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
node tools/specs.mjs validate
```

## Out of scope

- UI visual redesign (styling and diff rendering libraries remain unchanged).
