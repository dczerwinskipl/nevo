---
id: ai-sessions-live-chat-integration.interactive-turn-runtime
status: draft
change: ai-sessions-live-chat-integration
depends_on: [provider-neutral-ai-contracts]
context:
  required:
    - specs/active/ai-sessions-live-chat-integration/overview.md
    - specs/active/ai-sessions-live-chat-integration/areas/provider-neutral-ai-runtime.md
    - specs/active/ai-sessions-live-chat-integration/owner-decisions.md
    - tools/ai/contracts.mjs
  optional:
    - tools/dashboard/server/watcher.mjs
allowed_paths:
  - tools/ai/**
  - tools/tests/ai-turn-runtime.test.mjs
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/src/**
semantic_references:
  decisions: [D4, D5, D10]
  constraints: [C5, C9, C10, C11, C12, C20]
  dependency_contracts: [provider-neutral-ai-contracts]
---

# Task: Interactive turn runtime

## Goal

Implement an in-memory provider-neutral runtime that correlates live turns and pending interactions, preserves them across observer reconnects, and cleanly terminates or interrupts them.

## Dependencies

Depends on task 02's normalized contracts and adapter operations.

## Implementation constraints

- Generate NEvo-owned opaque `turnId` and `interactionId` values.
- Keep private provider operation/request references inaccessible from serialized snapshots/events.
- Assign monotonic event sequence IDs and retain a bounded replay buffer plus current snapshot for the life of a turn.
- Treat observer subscription/unsubscription independently from provider cancellation.
- Allow at most one resolution per interaction; reject wrong turn/interaction correlations.
- Track at most one non-terminal turn per session; a start-turn request while one is already `running`/`waitingForUser` returns a normalized conflict naming the existing `turnId` and never reaches the adapter. An optional caller-supplied idempotency key on start-turn, when it matches the still-non-terminal turn's own recorded key, returns that turn's `turnId` instead of a conflict.
- Assign a stable NEvo `id` to every question inside a multi-question interaction; resolve strictly by `interactionId` + question `id`, never by matching question/answer text.
- Keep the provider operation alive while waiting for an interaction response.
- On runtime shutdown, emit/record interrupted failure for active turns without attempting process reconstruction.
- Bound completed/failed turn retention so an in-memory demo cannot leak indefinitely; exact limits are internal configuration.

## Acceptance criteria

1. Starting a turn emits `turn.started`, streams ordered `message.delta` events, and completes with the defined status transition. `automated: node --test tools/tests/ai-turn-runtime.test.mjs`
2. Permission and question requests each create one interaction, set `waitingForUser`, resolve through normalized responses, return to `running`, and continue the same turn. `automated: node --test tools/tests/ai-turn-runtime.test.mjs`
3. Duplicate, unknown, or cross-turn responses cannot resolve another provider request. `automated: node --test tools/tests/ai-turn-runtime.test.mjs`
4. Disconnecting the last subscriber does not call adapter cancellation; reconnect from an event sequence receives missed events and the unresolved interaction snapshot. `automated: node --test tools/tests/ai-turn-runtime.test.mjs`
5. Explicit cancellation calls the adapter only when supported and produces one terminal event. `automated: node --test tools/tests/ai-turn-runtime.test.mjs`
6. Runtime shutdown marks active turns interrupted/failed while leaving provider session identity available to callers. `automated: node --test tools/tests/ai-turn-runtime.test.mjs`
7. Starting a second turn on a session with a non-terminal turn never invokes the adapter and returns a normalized conflict naming the existing `turnId`; a same-idempotency-key retry against that same turn returns its `turnId` instead of a conflict. `automated: node --test tools/tests/ai-turn-runtime.test.mjs`
8. Resolving a multi-question interaction by an unknown or mismatched question `id` is rejected; only the exact matching question's own `id` resolves it. `automated: node --test tools/tests/ai-turn-runtime.test.mjs`

## Verification

```text
node --test tools/tests/ai-turn-runtime.test.mjs
node tools/specs.mjs validate
```

## Out of scope

- HTTP/SSE serialization.
- Durable turn recovery or background job infrastructure.
