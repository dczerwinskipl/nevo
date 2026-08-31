---
id: refaktoring-tooli.dashboard-fastify-http-adapter-migration
status: draft
change: refaktoring-tooli
context:
  required:
    - specs/active/refaktoring-tooli/overview.md
    - specs/active/refaktoring-tooli/owner-decisions.md
    - specs/active/refaktoring-tooli/areas/dashboard-server-runtime.md
    - docs/development/node-tooling-guidelines.md
    - tools/dashboard/server/index.mjs
    - tools/dashboard/server/http-utils.mjs
    - tools/dashboard/server/routes/specs.mjs
  optional:
    - tools/dashboard/server/routes/events.mjs
    - tools/dashboard/server/routes/operations.mjs
    - tools/dashboard/server/routes/pull-requests.mjs
    - tools/dashboard/server/routes/health.mjs
    - tools/dashboard/server/ai-routes.mjs
    - tools/dashboard/server/operations.mjs
    - tools/dashboard/server/actions.mjs
    - tools/dashboard/server/data.mjs
allowed_paths:
  - tools/dashboard/server/**
  - tools/dashboard/tests/**
  - tools/dashboard/package.json
  - tools/dashboard/package-lock.json
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/src/**
  - tools/ai/**
depends_on:
  - dashboard-server-runtime-and-routes
  - e2e-verification-and-guidelines-audit
semantic_references:
  decisions: [D5]
  constraints: [C1, C2, C4, C5, C7]
---

# Task: Dashboard Fastify HTTP adapter migration

## Goal

Replace the dashboard server's manual `node:http` request handling with Fastify, so route matching, request/response glue, and HTTP error mapping are provided by the framework instead of hand-rolled in `tools/dashboard/server/index.mjs` and `http-utils.mjs`, while preserving every capability route module and application operation call established by task 4 (`dashboard-server-runtime-and-routes`).

## Dependencies

- `dashboard-server-runtime-and-routes` (task 4) — establishes the capability route modules (`routes/*.mjs`) and application-operation boundaries this task adapts to Fastify.
- `e2e-verification-and-guidelines-audit` (task 8) — most recent audit of `tools/dashboard/server/index.mjs`; this task starts from its cleaned-up state.

## Problem

- `tools/dashboard/server/index.mjs` and `http-utils.mjs` perform manual method/path matching, manual request body parsing, and ad hoc per-route error handling on top of `node:http`, duplicating concerns a mature HTTP framework already solves (§2.3 of `node-tooling-guidelines.md`; see also the "Check for an existing solution before proposing a custom one" principle in the specification workflow).
- HTTP error mapping (`HttpError` and friends) is caught and formatted per-route rather than centrally, and SSE response setup is done directly against the raw `node:http` response object with no framework-level lifecycle support.

## Expected outcome

- The dashboard server bootstraps a Fastify instance instead of `http.createServer`.
- Each existing capability route module (`routes/specs.mjs`, `routes/events.mjs`, `routes/operations.mjs`, `routes/pull-requests.mjs`, `routes/health.mjs`, `ai-routes.mjs`) is registered as a Fastify plugin/route group, keeping its existing application-operation calls and response mapping — only the thin request/response glue is adapted to Fastify's `request`/`reply` API.
- Route paths, methods, and params use Fastify's native routing instead of the manual matching currently in `index.mjs`/`http-utils.mjs`.
- HTTP error mapping is centralized via a Fastify error handler (`setErrorHandler` or equivalent), replacing the duplicated per-route catch/format logic.
- Server startup, static asset serving, and graceful shutdown use Fastify's lifecycle hooks, preserving current dev vs. built-asset serving behavior exactly.
- SSE endpoints (`routes/events.mjs`, `routes/operations.mjs`) keep their exact response headers, event framing, and the resumable cursor/`Last-Event-ID` reconnect semantics from task 4 — Fastify only changes how the raw response stream is obtained, not the SSE protocol itself.
- `ai-routes.mjs` keeps its existing internal behavior; only the wiring needed to register it as a Fastify plugin changes.
- `fastify` is added to `tools/dashboard/package.json` as the sole new HTTP-related dependency (no additional schema/validation libraries without a further owner decision).

## Preserved contracts & behavior

- All REST API endpoints, query parameters, JSON payload structures, status codes, and error response bodies remain 100% backward compatible.
- All SSE event names, framing, and cursor-based reconnect/replay semantics established by task 4 remain unchanged.
- `tools/dashboard/server/ai-routes.mjs` internal session/AI behavior is unchanged.

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
node tools/specs.mjs validate
```

The task requires test coverage confirming:

1. Every existing route continues to return identical status codes, JSON shapes, and error bodies under Fastify.
2. SSE routes preserve exact event framing and all reconnect scenarios already covered by task 4's tests (initial connection, cursor-based reconnect, reconnect to completed/failed operations, exactly-once cleanup, no leaked listeners).
3. Centralized HTTP error mapping produces the same response shape/status codes as the previous per-route handling for each existing error case.
4. Fastify `inject()`-based tests are used where they materially simplify over the current manual-request test doubles, without removing existing behavioral/SSE coverage.

## Out of scope

- Redesigning or decomposing `ai-routes.mjs` internal behavior beyond the minimal Fastify plugin wiring.
- Modifying frontend React code in `tools/dashboard/src/`.
- Redesigning AI provider adapters or protocols in `tools/ai/**`.
- Adding schema/validation libraries or other HTTP-related dependencies beyond Fastify itself.
