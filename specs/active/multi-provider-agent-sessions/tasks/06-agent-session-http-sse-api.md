---
id: multi-provider-agent-sessions.agent-session-http-sse-api
status: draft
change: multi-provider-agent-sessions
context:
  required:
    - specs/active/multi-provider-agent-sessions/overview.md
    - specs/active/multi-provider-agent-sessions/areas/provider-neutral-core.md
    - specs/active/multi-provider-agent-sessions/tasks/02-session-binding-and-execution-context.md
    - specs/active/multi-provider-agent-sessions/tasks/05-claude-interaction-and-deferral.md
    - tools/dashboard/server/index.mjs
    - tools/dashboard/server/ai-routes.mjs
    - tools/dashboard/server/ai-services.mjs
allowed_paths:
  - tools/dashboard/server/ai-routes.mjs
  - tools/dashboard/server/ai-services.mjs
  - tools/dashboard/server/index.mjs
  - tools/dashboard/tests/ai-server.test.mjs
  - tools/dashboard/tests/ai-contract-drift.test.mjs
forbidden_paths:
  - src/**
  - tools/dashboard/src/**
semantic_references:
  decisions: [D1, D2, D6, D7]
  constraints: [C1, C2, C3, C4, C6, C8]
---

# Task: Agent session HTTP and SSE API

## Goal

Expose the complete provider-neutral agent session API on the dashboard server, supporting session listing/creation with spec/task binding, turn initiation, turn cancellation, interaction resolution, state snapshots, normalized message history, and real-time SSE event streaming with reconnect support using canonical `(provider, providerSessionId)` routing.

## Requirements

- Update `tools/dashboard/server/ai-routes.mjs` to handle `/api/agent-sessions` endpoints using `(provider, providerSessionId)` locators.
- Support `GET /api/agent-sessions` filtering by query parameters `specId` or `taskId` via `AgentSessionBindingService`.
- Support `POST /api/agent-sessions` starting a provider session and registering initial spec/task binding.
- Expose session state snapshot and normalized thread history in `GET /api/agent-sessions/:provider/:providerSessionId` (including status, active turn, pending interaction, capabilities, and normalized messages with `lastEventSeq` cursor reading from `.nevo-ai-local/transcripts/<provider>/<providerSessionId>.json`).
- Support SSE event endpoint (`GET /api/agent-sessions/:provider/:providerSessionId/events`) broadcasting normalized `AgentEvent` streams with sequence numbers for reconnect/replay deduplication.
- Support interaction response endpoint (`POST /api/agent-sessions/:provider/:providerSessionId/interactions/:interactionId/respond`).
- Ensure no provider credentials, internal process tokens, or raw provider formats leak to API responses.

## Verification

```bash
npm --prefix tools/dashboard test
node tools/specs.mjs validate
```
