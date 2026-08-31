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

Modularize dashboard server route handlers into capability-focused route modules, eliminate event-loop blocking on the dashboard data request path, and ensure robust subscription replay and lifecycle management for resumable operation SSE streams.

## Problem

- `tools/dashboard/server/index.mjs` and `data.mjs` combine HTTP port listening, static file serving, route registration, and data formatting inside route handlers without consistent boundary separation between request validation, application execution, and response mapping (§2.2, §3, §10 of `node-tooling-guidelines.md`).
- **Request-path filesystem I/O**: The `GET /api/dashboard` request path currently executes dashboard data loading synchronously. In `loadDashboardData()` and its helper paths, potentially unbounded repository traversal (recursive directory walking in `latestModifiedAt` / `collectRelevantFiles`) and repeated synchronous file reads (`readFileSync` for `overview.md` and all task markdown files across active and archived specifications) block the Node event loop on a long-running dashboard request path. Small, bounded synchronous operations that are demonstrably harmless must be distinguished from repository traversal, repeated reads, Git work, or other operations whose duration grows with repository/spec size, which must not execute synchronously on request paths (§8.2, §9.2).
- **Resumable operation SSE lifecycle**: In `tools/dashboard/server/index.mjs`, operation SSE event streaming contains a subscription replay edge-case: `OperationRuntime.subscribe()` can synchronously replay already-recorded events before returning the unsubscribe handle. Reconnecting to an operation that is already terminal invokes terminal event handling during subscription setup before the cleanup function reference is initialized (causing Temporal Dead Zone / initialization errors), and lacks a robust lifecycle guaranteeing exactly-once cleanup without leaked listeners across all reconnect scenarios (§8.2).

## Expected outcome

- Route definitions are organized into modular route handlers (e.g. under `tools/dashboard/server/routes/` or cohesive capability modules) covering specifications, pull request diffs, and operations.
- `tools/dashboard/server/index.mjs` handles only server bootstrap, static asset mounting, middleware registration, and graceful shutdown.
- Potentially unbounded repository traversal and repeated file reads on `GET /api/dashboard` are moved off the blocking request path or executed asynchronously using the smallest appropriate boundary (without introducing unnecessary background job frameworks), ensuring the event loop remains responsive.
- The operation SSE route handler and runtime subscription lifecycle are refactored to cleanly support:
  - first connection to a running operation;
  - reconnect/resume using the existing event cursor mechanism (`afterSequence` / `Last-Event-ID`);
  - reconnect to an already-completed operation;
  - reconnect to an already-failed/cancelled operation;
  - exactly-once connection cleanup on client disconnect or terminal completion;
  - safe initialization order with no use-before-initialization errors during synchronous event replay;
  - no duplicate terminal handling or leaked subscriptions/listeners.

## Preserved contracts & behavior

- All REST API endpoints, query parameters, JSON payload structures (including `/api/dashboard` response data shape and error semantics), status codes, and SSE event formats must remain 100% backward compatible.
- Repository and specification discovery semantics remain intact.

## Verification

```text
npm --prefix tools/dashboard test
node tools/specs.mjs validate
```

The task requires focused automated test coverage in `tools/dashboard/tests/` without real-time sleeps, timing-sensitive assertions, or millisecond benchmarks:

1. **Focused regression tests for resumable SSE lifecycle:**
   - initial subscription to a running operation;
   - cursor-based reconnect/resume using `afterSequence` / `Last-Event-ID`;
   - reconnect to an already-completed operation;
   - reconnect to an already-failed/cancelled operation;
   - synchronous replay of terminal events during subscription setup (verifying absence of use-before-initialization errors);
   - exactly-once connection cleanup on client disconnect or completion;
   - no duplicate terminal handling;
   - no leaked subscriptions or event listeners under controlled deterministic events.
2. **Focused coverage for asynchronous dashboard-data boundary:**
   - verification that `GET /api/dashboard` uses the non-blocking data-loading boundary while preserving exact response data shapes, error responses, and active/archive spec discovery semantics under controlled test fixtures.

## Out of scope

- **AI route internals**: Existing `tools/dashboard/server/ai-routes.mjs` is already a capability-owned route boundary. Preserve its internal AI/session behavior and structure in this task except for minimal wiring changes required by server bootstrap/routing extraction. AI route decomposition belongs outside this specification.
- Modifying frontend React components in `tools/dashboard/src/`.
- Redesigning AI provider adapters or protocols in `tools/ai/**`.
- Introducing background job frameworks or message queues.
