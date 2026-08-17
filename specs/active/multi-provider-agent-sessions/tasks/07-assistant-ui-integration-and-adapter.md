---
id: multi-provider-agent-sessions.assistant-ui-integration-and-adapter
status: draft
change: multi-provider-agent-sessions
context:
  required:
    - specs/active/multi-provider-agent-sessions/overview.md
    - specs/active/multi-provider-agent-sessions/areas/assistant-ui-frontend.md
    - specs/active/multi-provider-agent-sessions/tasks/06-agent-session-http-sse-api.md
    - tools/dashboard/package.json
    - tools/dashboard/src/App.tsx
  optional:
    - tools/dashboard/src/lib/ai-chat-helpers.ts
allowed_paths:
  - tools/dashboard/package.json
  - tools/dashboard/package-lock.json
  - tools/dashboard/src/components/ai-chat.tsx
  - tools/dashboard/src/lib/nevo-assistant-runtime.ts
  - tools/dashboard/src/lib/types.ts
  - tools/dashboard/tests/ai-chat-helpers.test.mjs
forbidden_paths:
  - src/**
  - tools/dashboard/server/**
semantic_references:
  decisions: [D1, D3, D7]
  constraints: [C1, C4, C7, C8]
---

# Task: Assistant-UI integration and adapter

## Goal

Install `@assistant-ui/react` in `tools/dashboard` and build a dedicated `NevoAssistantRuntime` adapter bridging NEvo HTTP and SSE streams to the chat runtime with reconnection support, replacing legacy handcrafted chat mechanics.

## Requirements

- Add `@assistant-ui/react` dependency to `tools/dashboard/package.json`.
- Implement `NevoAssistantRuntime` in `tools/dashboard/src/lib/nevo-assistant-runtime.ts` consuming SSE stream events (`text.delta`, `tool.*`, `interaction.requested`) and delegating turn execution/cancellation to NEvo API.
- Support initial state restoration from session snapshot (`GET /api/agent-sessions/:sessionId`) when the page reloads.
- Replace manual token accumulation and auto-scroll logic in `tools/dashboard/src/components/ai-chat.tsx` with `@assistant-ui/react` thread and composer primitives.
- Verify React 19 compatibility and TypeScript types.

## Verification

```bash
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
node tools/specs.mjs validate
```
