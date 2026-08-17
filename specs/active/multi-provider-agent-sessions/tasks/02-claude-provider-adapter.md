---
id: multi-provider-agent-sessions.claude-provider-adapter
status: draft
change: multi-provider-agent-sessions
context:
  required:
    - specs/active/multi-provider-agent-sessions/overview.md
    - specs/active/multi-provider-agent-sessions/areas/claude-provider.md
    - specs/active/multi-provider-agent-sessions/tasks/01-provider-neutral-core-and-capabilities.md
    - tools/ai/contracts.mjs
    - tools/ai/registry.mjs
  optional:
    - tools/ai/mock-adapter.mjs
allowed_paths:
  - tools/ai/claude-adapter.mjs
  - tools/ai/registry.mjs
  - tools/tests/claude-adapter.test.mjs
forbidden_paths:
  - src/**
  - tools/dashboard/src/**
semantic_references:
  decisions: [D1, D2, D4]
  constraints: [C1, C3, C4, C5]
---

# Task: Claude provider adapter

## Goal

Implement the `AgentProvider` adapter for Claude Code CLI (`claude`), supporting process spawning with stream-json I/O, session creation with UUID assignment, session resumption via `providerSessionId`, text delta streaming, turn cancellation, and error mapping.

## Requirements

- Implement `ClaudeAgentProvider` adhering to `AgentProvider` in `tools/ai/claude-adapter.mjs`.
- Declare `CLAUDE_CAPABILITIES` with all supported features.
- Execute `claude` CLI with `--print --output-format stream-json --input-format stream-json`.
- Parse stdout JSON lines, mapping text deltas, thinking blocks, and completion events to `AgentEvent`s.
- Support session resumption (`--resume <providerSessionId>`) and initial session creation (`--session-id <uuid>`).
- Implement `cancelTurn` by sending process termination signals cleanly.

## Verification

```bash
node --test tools/tests/claude-adapter.test.mjs
node tools/specs.mjs validate
```
