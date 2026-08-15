---
id: ai-sessions-live-chat-integration.ai-session-http-and-sse-api
status: draft
change: ai-sessions-live-chat-integration
depends_on: [mock-ai-adapter-and-demo-data]
context:
  required:
    - specs/active/ai-sessions-live-chat-integration/overview.md
    - specs/active/ai-sessions-live-chat-integration/areas/provider-neutral-ai-runtime.md
    - specs/active/ai-sessions-live-chat-integration/areas/dashboard-session-experience.md
    - specs/active/ai-sessions-live-chat-integration/owner-decisions.md
    - tools/dashboard/server/index.mjs
    - tools/dashboard/tests/server.test.mjs
  optional:
    - tools/dashboard/server/watcher.mjs
    - tools/dashboard/server/network-config.mjs
allowed_paths:
  - tools/dashboard/server/**
  - tools/dashboard/tests/**
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/src/**
semantic_references:
  decisions: [D3, D4, D5, D8]
  constraints: [C4, C7, C8, C9, C10, C11, C12, C13, C17, C18, C20]
  dependency_contracts: [mock-ai-adapter-and-demo-data]
---

# Task: AI session HTTP and SSE API

## Goal

Expose the provider-neutral session, message, creation, turn, interaction, cancellation, and reconnect resources through the existing Node dashboard server using HTTP commands and one-way SSE events.

## Dependencies

Depends on the fully functional mock provider and in-memory turn runtime from tasks 02-04.

## Implementation constraints

- Compose AI services/adapters through injectable server dependencies so route tests do not start real providers.
- Resolve slug-based spec routes to `specId` before session operations.
- Treat provider/session IDs as opaque and path-safe; do not expose filesystem paths or provider raw errors.
- Return `turnId` from start-turn before streaming; SSE is a separate GET resource with event IDs/replay semantics.
- Start-turn returns the runtime's normalized conflict result (a 409-shaped body naming the existing `turnId`) as-is when a non-terminal turn already exists, rather than re-deriving conflict detection at the route layer; an optional idempotency key in the request body is passed through unchanged to the runtime.
- Resolve permissions/questions and cancel through POST requests with validated normalized bodies and bounded sizes; a question-interaction response body is an `answers` array of `{ questionId, value }` entries, never a text-keyed object.
- Add one central access-policy function receiving `read` or `control`; the shipped trusted-network policy allows both.
- Retain same-origin and explicit-action-header guards for control requests and clearly report/log that trusted-network mode is not identity authentication.
- Keep coarse specification invalidation SSE separate from identified per-turn events.

## Acceptance criteria

1. Provider/session list, metadata, messages, create, start-turn, turn snapshot, SSE, interaction response, and cancel routes return normalized payloads and reject unsupported methods. `automated: npm --prefix tools/dashboard test`
2. Session filters by `specId` and task ID enforce relation semantics and descending activity order. `automated: npm --prefix tools/dashboard test`
3. SSE emits the required events incrementally with IDs, accepts reconnect position, replays missed events, and re-exposes an unresolved interaction. `automated: npm --prefix tools/dashboard test`
4. Closing an SSE request does not cancel the provider turn; explicit cancellation does. `automated: npm --prefix tools/dashboard test`
5. Permission and question response bodies correlate the exact turn/interaction/question `id` and reject duplicates, mismatches, traversal, malformed JSON, and oversized input. `automated: npm --prefix tools/dashboard test`
6. Every route passes through the expected `read` or `control` policy, and control routes retain same-origin/action guards. `automated: npm --prefix tools/dashboard test`
7. Existing dashboard routes and `/api/events` behavior remain green. `automated: npm --prefix tools/dashboard test`
8. Start-turn against a session with an already non-terminal turn returns the runtime's normalized conflict response and never starts a second turn; a same-idempotency-key retry returns the existing `turnId`. `automated: npm --prefix tools/dashboard test`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

## Out of scope

- Frontend rendering, real Claude processes, login/token/OIDC implementation, or durable turn storage.
