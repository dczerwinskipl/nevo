# Provider-neutral AI runtime

## Responsibility

Own normalized session, message, provider capability, turn, event, pending-interaction, and access-policy contracts shared by the dashboard and provider adapters.

## Current state

The dashboard has a backend-only pull request provider registry and one-way SSE invalidation, but no AI domain model, process runtime, background turn ownership, normalized streaming events, or user interaction correlation. Lifecycle actions are synchronous HTTP calls and are not a reusable turn engine.

## Requirements

- Define a session reference keyed by provider and opaque session ID plus an immutable spec relation and zero/multiple task IDs.
- Define exactly four statuses and timestamp semantics, including `lastActivityAt` sorting.
- Define provider descriptors with explicit capabilities for list, metadata, messages, create, send/start turn, stream, resume, interactions, and cancellation.
- Define a transient normalized message read model without creating a NEvo transcript store.
- Define an extensible event union with the required turn/message/interaction/terminal events.
- Own in-memory `turnId -> provider operation` and `interactionId -> provider request` correlation.
- Enforce at most one non-terminal turn per session: starting a turn while one is already `running`/`waitingForUser` returns a normalized conflict without invoking the adapter; an optional caller-supplied idempotency key lets a genuine retry return the existing `turnId` instead of a conflict.
- Keep the live provider operation alive while an interaction is pending.
- Assign a stable NEvo `id` to every question inside a multi-question interaction; correlate both the interaction and each question's own answer strictly by ID, never by matching question/answer text.
- Normalize a permission interaction's tool `input`/`details` into a display-safe, bounded, sanitized shape per adapter; never forward a provider's raw event payload as `input`.
- Retain enough bounded in-memory state/events to rehydrate a connected UI after SSE reconnect.
- Mark active turns interrupted/failed on server shutdown/restart without claiming provider process recovery.
- Centralize route authorization as `read` versus `control`; ship only a trusted-network policy in this change.

## Constraints

- Follow C4-C12, C17-C20 and D3-D5, D8.
- No browser-visible provider request IDs or raw provider payloads — including a permission interaction's `input`, which is always adapter-normalized, never a raw passthrough.
- No `isActive`, `waitingForPermission`, or `waitingForQuestion` status.
- No WebSocket requirement, durable turn storage, transcript copy, or standalone service.
- Unknown/unsupported provider capabilities must produce typed provider-neutral errors.

## Interfaces and boundaries

`tools/ai/**` exposes internal JavaScript services/models to `tools/specs.mjs` and the dashboard server. Provider adapters implement the boundary; frontend code consumes only JSON/SSE read models. The access policy receives route capability and request facts without depending on session/provider internals, allowing later OIDC replacement.

## Area-specific acceptance criteria

1. Mock and Claude adapters can satisfy the same contract without browser changes.
2. A permission and a multi-question request round-trip through normalized interactions and continue the same turn.
3. Duplicate/unknown interaction responses are deterministic and cannot resolve the wrong pending request.
4. SSE disconnect does not invoke cancellation; reconnect exposes the latest sequence and unresolved interaction.
5. Provider terminal failure emits `turn.failed`; normal completion emits `turn.completed` and returns session status to `waitingForUser`.
6. Every AI route declares and exercises either `read` or `control` access.
7. Starting a turn against a session with an existing non-terminal turn returns a normalized conflict and never invokes the adapter a second time; a start-turn retry carrying the same idempotency key against that same turn returns its existing `turnId`.
8. Resolving one question inside a multi-question interaction by the wrong question `id` (or by matching prose instead of ID) is rejected rather than silently applied to the wrong question.

## Dependencies

Consumes stable specification identity. Mock/API/UI and all real providers depend on this area.

## Out of scope

- Provider billing/model selection.
- Rich tool visualization or policy engines.
- Durable job orchestration and multi-user authorization implementation.
