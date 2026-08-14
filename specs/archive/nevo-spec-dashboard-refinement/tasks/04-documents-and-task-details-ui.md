---
id: nevo-spec-dashboard-refinement.documents-and-task-details-ui
status: draft
change: nevo-spec-dashboard-refinement
context:
  required:
    - specs/active/nevo-spec-dashboard-refinement/overview.md
    - specs/active/nevo-spec-dashboard-refinement/areas/spec-content-and-task-details.md
    - specs/active/nevo-spec-dashboard-refinement/owner-decisions.md
    - tools/dashboard/src/components/spec-detail.tsx
    - tools/dashboard/src/components/status-board.tsx
    - tools/dashboard/src/hooks/use-dashboard-data.ts
    - tools/dashboard/src/lib/types.ts
  optional: []
allowed_paths:
  - tools/dashboard/src/**
  - tools/dashboard/package.json
  - tools/dashboard/package-lock.json
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  dependency_contracts: [dashboard-content-runtime]
  decisions: [D4]
  constraints: [C1, C7]
---

# Task: Documents and task details UI

## Goal

Turn the selected specification into a source-backed reading workspace with full Specification and Areas tabs plus accessible task details.

## Dependencies

Depends on `dashboard-content-runtime` for the canonical document contract.

## Implementation constraints

- Use `react-markdown` and `remark-gfm`; do not use raw HTML from specification files.
- Keep tab state local and avoid adding a routing dependency.
- Preserve the current overview metrics and responsive lane behavior.
- Task cards must be real keyboard- and touch-operable controls.

## Acceptance criteria

1. Overview, Specification, Areas, and Changes navigation is accessible and preserves the existing Overview content. `automated: npm --prefix tools/dashboard run build; inspection: keyboard and mobile navigation`
2. Overview and area documents render headings, lists, tables, task lists, links, inline code, and fenced code blocks readably. `automated: npm --prefix tools/dashboard run build; inspection: representative specification documents`
3. Clicking or activating any task opens its canonical full description and available dependency/status metadata. `inspection: task detail from every workflow stage`
4. Loading, missing-content, and error states are explicit and do not discard the selected specification. `inspection: exercise each content query state`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

## Out of scope

- Markdown editing or document search.
