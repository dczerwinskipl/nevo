---
id: multi-provider-agent-sessions.assistant-ui-integration-and-adapter
status: draft
change: multi-provider-agent-sessions
context:
  required:
    - specs/active/multi-provider-agent-sessions/overview.md
    - specs/active/multi-provider-agent-sessions/areas/assistant-ui-frontend.md
    - specs/active/multi-provider-agent-sessions/tasks/04-agent-session-http-sse-api.md
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
  decisions: [D1, D3]
  constraints: [C1, C4, C6]
---

# Task: Assistant-UI integration and adapter

## Goal

Install `@assistant-ui/react` in `tools/dashboard` and build a dedicated `NevoAssistantRuntime` adapter bridging NEvo HTTP and SSE streams to the chat runtime, replacing legacy handcrafted chat mechanics.

## Requirements

- Add `@assistant-ui/react` dependency to `tools/dashboard/package.json`.
- Implement `NevoAssistantRuntime` in `tools/dashboard/src/lib/nevo-assistant-runtime.ts` consuming SSE stream events and delegating turn execution/cancellation to NEvo API.
- Replace manual token accumulation and auto-scroll logic in `tools/dashboard/src/components/ai-chat.tsx` with `@assistant-ui/react` thread and composer primitives.
- Verify React 19 compatibility and TypeScript types.

## Verification

```bash
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
node tools/specs.mjs validate
```
