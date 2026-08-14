---
id: nevo-spec-dashboard.dashboard-interface
status: draft
change: nevo-spec-dashboard
context:
  required:
    - specs/active/nevo-spec-dashboard/overview.md
    - specs/active/nevo-spec-dashboard/areas/dashboard-ui.md
    - specs/active/nevo-spec-dashboard/owner-decisions.md
    - tools/dashboard/shared/status-stages.js
  optional: []
allowed_paths:
  - tools/dashboard/src/**
  - tools/dashboard/index.html
  - tools/dashboard/components.json
  - tools/dashboard/vite.config.*
  - tools/dashboard/tsconfig*.json
  - tools/dashboard/package.json
  - tools/dashboard/package-lock.json
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  dependency_contracts: [dashboard-data-runtime]
  decisions: [D1]
  constraints: [C1, C2, C4]
---

# Task: Dashboard interface

## Goal

Implement the responsive React dashboard with active/archive navigation, specification summaries, metrics, and simplified workflow lanes backed by the runtime API.

## Dependencies

Depends on `dashboard-data-runtime` for the API contract and canonical status projection.

## Implementation constraints

- Use React, Tailwind, and shadcn-style components owned by the dashboard source tree.
- Keep primary desktop navigation on the left and open the mobile drawer from the same side.
- Keep archive list-first and automatically select a sole active specification.
- Avoid adding workflow state that does not exist in canonical files.

## Acceptance criteria

1. Active and archive navigation follows the selected list behavior on desktop and small screens. `inspection: exercise active, archived, empty, and single-active states`
2. The selected specification shows its summary, progress, task counts, next-ready task, and last-change information. `inspection: compare rendered values with the API response`
3. Canonical task statuses appear in the six approved simplified lanes with task details preserved. `automated: npm --prefix tools/dashboard test`
4. Live refresh updates the current view while preserving a valid selection. `inspection: edit and restore a relevant spec file while the dashboard is running`
5. Loading, error, and empty states are accessible and visually coherent. `inspection: exercise each state with keyboard and mobile-width navigation`
6. The main and list progress bars show Done, Review, Implementation, Ready, Design, and New in that order; only Done is fully emphasized and the numeric percentage counts Done tasks exclusively. `inspection: compare segment widths and completion percentage with stage counts from the API`
7. Workflow lanes stack in one column on phones and wrap responsively without requiring undiscoverable horizontal scrolling. `inspection: inspect phone, tablet, and desktop widths`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

## Out of scope

- Write controls, drag-and-drop status changes, or authentication.
