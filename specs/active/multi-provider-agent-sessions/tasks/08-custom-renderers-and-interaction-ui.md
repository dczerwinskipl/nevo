---
id: multi-provider-agent-sessions.custom-renderers-and-interaction-ui
status: draft
change: multi-provider-agent-sessions
context:
  required:
    - specs/active/multi-provider-agent-sessions/overview.md
    - specs/active/multi-provider-agent-sessions/areas/assistant-ui-frontend.md
    - specs/active/multi-provider-agent-sessions/tasks/07-assistant-ui-integration-and-adapter.md
    - tools/dashboard/src/components/ai-chat.tsx
allowed_paths:
  - tools/dashboard/src/components/ai-chat.tsx
  - tools/dashboard/src/components/ai-tool-view.tsx
  - tools/dashboard/src/components/ai-interaction-prompt.tsx
  - tools/dashboard/src/components/ai-reasoning-view.tsx
  - tools/dashboard/src/lib/types.ts
forbidden_paths:
  - src/**
  - tools/dashboard/server/**
semantic_references:
  decisions: [D1, D3]
  constraints: [C1, C4, C7]
---

# Task: Custom renderers and interaction UI

## Goal

Build NEvo-tailored UI renderers for thinking/reasoning blocks, tool call inspection, interactive permission approval prompts, and interactive question forms inside the `@assistant-ui/react` thread.

## Requirements

- Implement custom reasoning/thinking accordion renderer matching NEvo design system.
- Implement tool call inspection card component (`ai-tool-view.tsx`) showing tool status, arguments, and syntax-highlighted outputs.
- Implement interactive permission prompt card with "Allow" and "Deny" actions, shown only when provider capabilities support permissions.
- Implement interactive question card for user clarification with text input and choice buttons.
- Connect interaction responses to `POST /api/agent-sessions/:sessionId/interactions/:interactionId/respond`.

## Verification

```bash
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
node tools/specs.mjs validate
```
