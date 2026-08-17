---
id: multi-provider-agent-sessions.antigravity-event-and-tool-mapping
status: draft
change: multi-provider-agent-sessions
context:
  required:
    - specs/active/multi-provider-agent-sessions/overview.md
    - specs/active/multi-provider-agent-sessions/areas/antigravity-provider.md
    - specs/active/multi-provider-agent-sessions/tasks/08-antigravity-adapter.md
    - tools/ai/antigravity-adapter.mjs
allowed_paths:
  - tools/ai/antigravity-adapter.mjs
  - tools/tests/antigravity-events.test.mjs
forbidden_paths:
  - src/**
  - tools/dashboard/src/**
semantic_references:
  decisions: [D1, D4]
  constraints: [C1, C4, C7]
---

# Task: Antigravity event and tool mapping

## Goal

Map Antigravity-specific execution events (deltas, subagent/tool activities, reasoning, token usage, errors) into normalized `AgentEvent`s and verify clean frontend handling of unsupported interactions.

## Requirements

- Parse Antigravity output stream into normalized `message.delta`, `reasoning.delta`, and `tool.*` events.
- Map execution errors and process terminations into `turn.failed` or `turn.completed`.
- Verify that the frontend gracefully handles turns without attempting interactive permission prompts when `interactivePermissions` is false.
- Test end-to-end turn flow with mock and local Antigravity processes.

## Verification

```bash
node --test tools/tests/antigravity-events.test.mjs
node tools/specs.mjs validate
```
