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
- The `GET /api/dashboard` request path executes synchronous directory traversal and file reads (`loadDashboardData`) whose duration grows with repository size.
- Operation SSE subscription in `server/index.mjs` has an edge-case during synchronous replay of terminal events before subscription cleanup initialization.

## Requirements

- Eliminate blocking `execFileSync` calls in `server/actions.mjs` by calling shared application operations directly in-process for gate evaluations (`taskGate`, `finalizeGate`).
- Ensure all action triggers (approve, verify, finalize) remain asynchronous, cancellable, and preserve progress streaming without blocking server responsiveness.
- Move potentially unbounded repository traversal and repeated file reads off the blocking request path or execute them asynchronously using the smallest appropriate boundary.
- Refactor the operation SSE subscription lifecycle to robustly handle reconnects, synchronous event replay, exactly-once cleanup, and no use-before-initialization errors.
- Organize server route handlers into focused capability modules (for example under `tools/dashboard/server/routes/` covering specifications, changes/diffs, and operations).
- Preserve existing `tools/dashboard/server/ai-routes.mjs` internal behavior and structure, allowing only minimal wiring changes required for server bootstrap extraction.
- HTTP handlers must strictly:
  - Validate request parameters (`parse -> validate -> normalize`).
  - Invoke application operations (shared with CLI or provided by server services).
  - Map results to HTTP responses or SSE event streams.
- Handle client disconnections (cancelling active SSE streams/operations) and graceful server shutdown.
- **Fastify adapter (D5):** Replace manual `node:http` request/route/method matching with Fastify. Register each capability route module as a Fastify plugin/route group using Fastify's own routing (paths, params, prefixes). Centralize HTTP error mapping (e.g. `HttpError`) through Fastify's error handler instead of per-route catch/response duplication. Use Fastify's lifecycle hooks for startup and graceful shutdown. Preserve SSE response headers, event framing, and the resumable cursor/reconnect semantics unchanged — only how the raw response stream is obtained may change. Use Fastify's `inject()` for route-level HTTP tests where it materially simplifies over the current manual-request test doubles, without dropping existing SSE/behavioral coverage.

## Interfaces and boundaries

The server exposes REST and SSE interfaces consumed by the React frontend. All JSON formats, status codes, and SSE event names must remain 100% backward compatible.

## Area-specific acceptance criteria

1. Server actions (`server/actions.mjs`) no longer call `execFileSync` or spawn CLI subprocesses for gate evaluations, invoking shared application operations directly in-process.
2. Server routes are modularized with input validation and clean boundary mapping.
3. No HTTP/SSE request handler executes blocking synchronous child process calls or unbounded synchronous filesystem traversals.
4. Resumable operation SSE streaming correctly supports initial connections, cursor-based reconnects, completed/failed operations, and clean teardown without leaked listeners.
5. All tests in `tools/dashboard/tests/` pass cleanly.
6. The server runs on Fastify: capability route modules are registered as Fastify plugins/route groups, HTTP error mapping is centralized via Fastify's error handler, and startup/shutdown use Fastify's lifecycle hooks.
7. SSE routes preserve their exact response headers, event framing, and resumable cursor/reconnect semantics after the Fastify migration.

## Out of scope

- Decomposing or redesigning internal AI/session route handlers in `tools/dashboard/server/ai-routes.mjs` beyond the minimal wiring needed to register it as a Fastify plugin.
- Introducing additional HTTP-related dependencies beyond Fastify itself (e.g. separate schema/validation libraries) without a further owner decision.
