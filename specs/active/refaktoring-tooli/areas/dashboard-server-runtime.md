---
id: refaktoring-tooli.area.dashboard-server-runtime
type: area
change: refaktoring-tooli
---

# Area: Dashboard Server Runtime

## Responsibility

Owns the HTTP/SSE server layer for the specification dashboard (`tools/dashboard/server/`), asynchronous action execution, data projections for specifications and tasks, API endpoint routing, and Git provider integrations.

## Current state

- `tools/dashboard/server/actions.mjs` executes `execFileSync` to spawn `tools/specs.mjs` synchronously on request paths (for gate checks and branch tracking), duplicating execution paths and blocking the Node event loop on request paths.
- `tools/dashboard/server/index.mjs` and `data.mjs` combine HTTP port listening, static file serving, route registrations, and data formatting in route handlers.

## Requirements

- Eliminate blocking `execFileSync` calls in `server/actions.mjs` by calling shared application operations directly in-process for gate evaluations (`taskGate`, `finalizeGate`).
- Ensure all action triggers (approve, verify, finalize) remain asynchronous, cancellable, and preserve progress streaming without blocking server responsiveness.
- Organize server route handlers into focused capability modules (for example under `tools/dashboard/server/routes/` covering specifications, changes/diffs, AI sessions, and operations).
- HTTP handlers must strictly:
  - Validate request parameters (`parse -> validate -> normalize`).
  - Invoke application operations (shared with CLI or provided by server services).
  - Map results to HTTP responses or SSE event streams.
- Handle client disconnections (cancelling active SSE streams/operations) and graceful server shutdown.

## Interfaces and boundaries

The server exposes REST and SSE interfaces consumed by the React frontend. All JSON formats, status codes, and SSE event names must remain 100% backward compatible.

## Area-specific acceptance criteria

1. Server actions (`server/actions.mjs`) no longer call `execFileSync` or spawn CLI subprocesses for gate evaluations, invoking shared application operations directly.
2. Server routes are modularized with input validation and clean boundary mapping.
3. No HTTP/SSE request handler executes blocking synchronous child process calls.
4. All tests in `tools/dashboard/tests/` pass cleanly.

## Out of scope

- Changing the underlying HTTP server framework.
