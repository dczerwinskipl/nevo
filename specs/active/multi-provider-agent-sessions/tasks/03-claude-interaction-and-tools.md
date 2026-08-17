---
id: multi-provider-agent-sessions.claude-interaction-and-tools
status: draft
change: multi-provider-agent-sessions
context:
  required:
    - specs/active/multi-provider-agent-sessions/overview.md
    - specs/active/multi-provider-agent-sessions/areas/claude-provider.md
    - specs/active/multi-provider-agent-sessions/tasks/02-claude-provider-adapter.md
    - tools/ai/claude-adapter.mjs
    - tools/ai/contracts.mjs
allowed_paths:
  - tools/ai/claude-adapter.mjs
  - tools/tests/claude-interaction.test.mjs
forbidden_paths:
  - src/**
  - tools/dashboard/src/**
semantic_references:
  decisions: [D1, D4]
  constraints: [C1, C4, C5]
---

# Task: Claude interaction and tools

## Goal

Add interactive permission handling, `AskUserQuestion` support, tool execution lifecycle event mapping, and stdin response writing to the Claude provider adapter.

## Requirements

- Intercept tool permission requests from the Claude stream and emit normalized `interaction.requested` (kind `permission`).
- Intercept interactive questions / clarifications (`AskUserQuestion`) and emit normalized `interaction.requested` (kind `question`).
- Implement `respondInteraction` to format and write the user's decision or answers to the child process's `stdin`.
- Map tool execution started, updated, and completed events with sanitized inputs and outputs.
- Test interaction correlation and turn resume after interactive response.

## Verification

```bash
node --test tools/tests/claude-interaction.test.mjs
node tools/specs.mjs validate
```
