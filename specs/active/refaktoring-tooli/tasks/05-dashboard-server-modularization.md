---
id: refaktoring-tooli.dashboard-server-modularization
status: draft
change: refaktoring-tooli
context:
  required:
    - specs/active/refaktoring-tooli/overview.md
    - specs/active/refaktoring-tooli/owner-decisions.md
    - specs/active/refaktoring-tooli/areas/dashboard-server-backend.md
    - docs/development/node-tooling-guidelines.md
    - tools/dashboard/server/**
  optional: []
allowed_paths:
  - tools/dashboard/server/**
  - tools/dashboard/tests/server/**
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D4]
  constraints: [C1, C2, C4, C5, C7]
---

# Task: Dashboard server modularization

## Goal

Modularize the dashboard server (`tools/dashboard/server/`), splitting `index.mjs` (559 LOC), `data.mjs` (595 LOC), and `ai-routes.mjs` (419 LOC) into dedicated route modules under `server/routes/`, reducing `index.mjs` to a bootstrap file (< 200 LOC), and eliminating blocking synchronous calls on request paths.

## Implementation constraints

- Create route modules under `tools/dashboard/server/routes/`:
  - `routes/specs.mjs` (specifications, manifests, Markdown documents, and tasks)
  - `routes/changes.mjs` (pull requests, diffs, and Git provider integrations)
  - `routes/ai.mjs` (AI sessions and SSE streaming)
  - `routes/operations.mjs` (starting and tracking background operations)
- HTTP handlers must strictly handle input validation and delegation to domain logic or shared application operations.
- Eliminate blocking `execFileSync` invocations on HTTP/SSE request paths — use asynchronous operations with timeouts.
- Ensure proper resource cleanup and child process termination upon client disconnection (SSE disconnect) and server shutdown.

## Acceptance criteria

1. `tools/dashboard/server/index.mjs` is under 200 LOC. `inspection: line count index.mjs < 200`
2. All REST endpoints and SSE streams maintain existing response contracts and JSON formats. `automated: npm --prefix tools/dashboard test`
3. All server unit and integration tests pass cleanly. `automated: node --test tools/dashboard/tests/server/**/*.test.mjs`

## Verification

```text
npm --prefix tools/dashboard test
node tools/specs.mjs validate
```

## Out of scope

- Modifying frontend React components in `tools/dashboard/src/`.
