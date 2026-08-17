---
id: multi-provider-agent-sessions.agent-session-http-sse-api
status: draft
change: multi-provider-agent-sessions
context:
  required:
    - specs/active/multi-provider-agent-sessions/overview.md
    - specs/active/multi-provider-agent-sessions/areas/provider-neutral-core.md
    - specs/active/multi-provider-agent-sessions/tasks/03-claude-interaction-and-tools.md
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
  decisions: [D1, D2]
  constraints: [C1, C2, C3, C4]
---

# Task: Agent session HTTP and SSE API

## Goal

Expose the complete provider-neutral agent session API on the dashboard server, supporting session listing/creation, turn initiation, turn cancellation, interaction resolution, and real-time SSE event streaming.

## Requirements

- Update `tools/dashboard/server/ai-routes.mjs` to handle `/api/agent-sessions` endpoints.
- Support provider selection on session creation (defaulting to available registered provider).
- Support SSE event endpoint (`GET /api/agent-sessions/:sessionId/events`) broadcasting normalized `AgentEvent` streams.
- Support interaction response endpoint (`POST /api/agent-sessions/:sessionId/interactions/:interactionId/respond`).
- Ensure no provider credentials, internal process IDs, or raw provider formats leak to API responses.

## Verification

```bash
npm --prefix tools/dashboard test
node tools/specs.mjs validate
```
