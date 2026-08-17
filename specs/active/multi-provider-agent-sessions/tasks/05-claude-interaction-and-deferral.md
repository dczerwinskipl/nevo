---
id: multi-provider-agent-sessions.claude-interaction-and-deferral
status: draft
change: multi-provider-agent-sessions
context:
  required:
    - specs/active/multi-provider-agent-sessions/overview.md
    - specs/active/multi-provider-agent-sessions/areas/claude-provider.md
    - specs/active/multi-provider-agent-sessions/tasks/03-claude-interaction-transport-discovery.md
    - specs/active/multi-provider-agent-sessions/tasks/04-claude-provider-adapter.md
    - tools/ai/claude-adapter.mjs
    - tools/ai/contracts.mjs
allowed_paths:
  - tools/ai/claude-adapter.mjs
  - tools/tests/claude-interaction.test.mjs
forbidden_paths:
  - src/**
  - tools/dashboard/src/**
semantic_references:
  decisions: [D1, D4, D5]
  constraints: [C1, C4, C5]
---

# Task: Claude interaction and deferral

## Goal

Implement `PreToolUse/defer` roundtrip flow for `AskUserQuestion`, integrate native permission request handling based on Task 03 discovery results, map tool execution lifecycle events, and test resumption with `updatedInput` without stdin request-response pipes.

## Requirements

- Intercept `AskUserQuestion` via `PreToolUse` hook returning `permissionDecision: 'defer'`.
- Map tool deferral stop reason into normalized `interaction.requested` (kind `question`) with stable `interactionId`.
- Implement native permission prompt handling based on the chosen mechanism from Task 03 discovery, emitting `interaction.requested` (kind `permission`).
- Implement `respondInteraction` to resume Claude session (`--resume <uuid>`) providing `updatedInput` / decisions to the hook without relying on active stdin pipes.
- Map tool execution started, updated, and completed events with sanitized inputs and outputs.
- Test parallel tool call boundary and ensure graceful error handling if parallel deferrals occur.

## Verification

```bash
node --test tools/tests/claude-interaction.test.mjs
node tools/specs.mjs validate
```
