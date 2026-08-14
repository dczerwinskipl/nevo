---
id: nevo-spec-dashboard-refinement.dashboard-content-runtime
status: draft
change: nevo-spec-dashboard-refinement
context:
  required:
    - specs/active/nevo-spec-dashboard-refinement/overview.md
    - specs/active/nevo-spec-dashboard-refinement/areas/spec-content-and-task-details.md
    - specs/active/nevo-spec-dashboard-refinement/owner-decisions.md
    - tools/dashboard/server/data.mjs
    - tools/dashboard/server/index.mjs
  optional: []
allowed_paths:
  - tools/dashboard/server/**
  - tools/dashboard/tests/**
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  constraints: [C1, C7]
---

# Task: Dashboard content runtime

## Goal

Expose canonical overview, area, and task Markdown through a safe on-demand dashboard endpoint.

## Implementation constraints

- Reuse loaded change manifests and repository path safety helpers.
- Strip front matter for display without rewriting source files.
- Return repository-relative paths only.
- Keep the main dashboard list payload concise.

## Acceptance criteria

1. The endpoint returns deterministic overview, area, and manifest-ordered task documents for active and archived specifications. `automated: npm --prefix tools/dashboard test`
2. Missing optional files have explicit empty states and do not fail the whole response. `automated: npm --prefix tools/dashboard test`
3. Unknown sources, slugs, traversal attempts, and non-GET methods are rejected without filesystem disclosure. `automated: npm --prefix tools/dashboard test`
4. Existing dashboard routes retain their contract. `automated: npm --prefix tools/dashboard test`

## Verification

```text
npm --prefix tools/dashboard test
```

## Out of scope

- Provider calls or React rendering.
