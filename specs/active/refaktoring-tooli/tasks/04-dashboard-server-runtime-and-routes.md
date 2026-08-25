---
id: refaktoring-tooli.dashboard-server-runtime-and-routes
status: draft
change: refaktoring-tooli
context:
  required:
    - specs/active/refaktoring-tooli/overview.md
    - specs/active/refaktoring-tooli/owner-decisions.md
    - specs/active/refaktoring-tooli/areas/dashboard-server-runtime.md
    - docs/development/node-tooling-guidelines.md
    - tools/dashboard/server/index.mjs
    - tools/dashboard/server/data.mjs
    - tools/dashboard/server/actions.mjs
    - tools/dashboard/server/operations.mjs
  optional: []
allowed_paths:
  - tools/dashboard/server/**
  - tools/dashboard/tests/**
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D4]
  constraints: [C1, C2, C4, C5, C7]
---

# Task: Dashboard server runtime and routes

## Goal

Modularize dashboard server route handlers into capability-focused route modules, separating HTTP server bootstrap and static serving from endpoint handling, request validation, and SSE event streaming.

## Problem

- `tools/dashboard/server/index.mjs` and `data.mjs` combine HTTP port listening, static file serving, route registration, and data formatting inside route handlers.
- Route handlers lack a consistent boundary separation between request validation, application execution, and response mapping (§2.2, §3, §10 of `node-tooling-guidelines.md`).

## Expected outcome

- Route definitions are organized into modular route handlers (e.g. under `tools/dashboard/server/routes/` or cohesive capability modules) covering specifications, pull request diffs, operations, and AI sessions.
- `tools/dashboard/server/index.mjs` handles only server bootstrap, static asset mounting, middleware registration, and graceful shutdown.
- Handlers validate input at the boundary and map outcomes to HTTP/SSE responses with proper resource cleanup upon client disconnect.

## Preserved contracts & behavior

- All REST API endpoints, query parameters, JSON payload structures, error status codes, and SSE event formats must remain 100% backward compatible.

## Verification

```text
npm --prefix tools/dashboard test
node tools/specs.mjs validate
```

## Out of scope

- Modifying frontend React components in `tools/dashboard/src/`.
