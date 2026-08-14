---
id: nevo-spec-dashboard.dashboard-data-runtime
status: draft
change: nevo-spec-dashboard
context:
  required:
    - specs/active/nevo-spec-dashboard/overview.md
    - specs/active/nevo-spec-dashboard/areas/data-runtime.md
    - specs/active/nevo-spec-dashboard/owner-decisions.md
    - tools/specs/service.mjs
  optional:
    - docs/development/testing-strategy.md
allowed_paths:
  - tools/dashboard/server/**
  - tools/dashboard/shared/**
  - tools/dashboard/tests/**
  - tools/dashboard/package.json
  - tools/dashboard/package-lock.json
  - tools/specs.mjs
  - specs/archive/**
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D1]
  constraints: [C1, C2, C3, C4, C6]
---

# Task: Dashboard data runtime

## Goal

Build the read-only repository adapter and local HTTP runtime that project canonical specification files into dashboard data and notify clients when those files change.

## Implementation constraints

- Import the existing specification service for manifest loading.
- Do not expose absolute filesystem paths or add mutation endpoints.
- Use Node built-ins for HTTP serving and file watching unless an approved frontend dependency already provides necessary development integration.

## Acceptance criteria

1. Active and archived changes load from their canonical directories and include task status, per-stage counts, Done-only completion progress, and safe repository-relative links. `automated: npm --prefix tools/dashboard test`
2. Overview Markdown produces a concise summary with a deterministic fallback. `automated: npm --prefix tools/dashboard test`
3. Relevant source changes emit a refresh event without requiring server restart. `automated: npm --prefix tools/dashboard test`
4. The API is read-only and rejects unsafe or unknown paths. `automated: npm --prefix tools/dashboard test`
5. Completion progress is zero until at least one actionable task reaches Done, and abandoned tasks are excluded from its denominator. `automated: npm --prefix tools/dashboard test`
6. Archived changes project as archived even for legacy manifests, and future archive operations persist that top-level status. `automated: npm --prefix tools/dashboard test; inspection: archive handler writes status before rebuilding indexes`

## Verification

```text
npm --prefix tools/dashboard test
```

## Out of scope

- Browser interface implementation.
- Editing lifecycle state.
