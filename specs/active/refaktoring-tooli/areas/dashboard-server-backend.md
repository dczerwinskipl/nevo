---
id: refaktoring-tooli.area.dashboard-server-backend
type: area
change: refaktoring-tooli
---

# Area: Dashboard Server Backend

## Responsibility

Owns the HTTP/SSE server layer for the specification dashboard (`tools/dashboard/server/`), data projections for specifications and tasks, API endpoint routing, asynchronous operation runtimes, and Git provider integrations.

## Current state

- `tools/dashboard/server/index.mjs` (559 LOC) combines HTTP port listening, static file serving, route registrations, AI session integrations, and graceful shutdown logic.
- `tools/dashboard/server/data.mjs` (595 LOC) bundles specification data loading, filesystem reads, diff parsing, and view projections.
- `ai-routes.mjs` (419 LOC) places AI turn streaming business logic directly inside Express/HTTP route handlers.
- Violates §2.2, §2.3, §9.2, and §12 of `node-tooling-guidelines.md`.

## Requirements

- Extract route handlers into dedicated modules under `tools/dashboard/server/routes/`:
  - `routes/specs.mjs` — specifications, manifests, Markdown documents, and tasks.
  - `routes/changes.mjs` — diff data, changed files, and GitHub provider integration.
  - `routes/ai.mjs` — SSE streaming for AI sessions and turn management.
  - `routes/operations.mjs` — starting and tracking background operations.
- HTTP handlers must strictly:
  - Validate request parameters (`parse -> validate -> normalize`).
  - Invoke application operations (shared with CLI or provided by server services).
  - Map results to HTTP responses or SSE event streams.
- Prevent blocking the Node event loop (`execFileSync`, `spawnSync` on long work) on server request paths (§9.2).
- Handle HTTP client disconnections (cancelling active SSE streams/operations) and graceful server shutdown.

## Interfaces and boundaries

The server exposes REST and SSE interfaces consumed by the React frontend. All JSON formats, status codes, and SSE event names must remain 100% backward compatible.

## Area-specific acceptance criteria

1. `tools/dashboard/server/index.mjs` is under 200 LOC and handles only server bootstrap and shutdown.
2. Server routes are modularized under `server/routes/`.
3. No HTTP/SSE request handler executes blocking synchronous child process calls.
4. All tests in `tools/dashboard/tests/server/` pass cleanly.

## Out of scope

- Changing the underlying HTTP server framework.
