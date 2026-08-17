---
id: multi-provider-agent-sessions.antigravity-adapter
status: draft
change: multi-provider-agent-sessions
context:
  required:
    - specs/active/multi-provider-agent-sessions/overview.md
    - specs/active/multi-provider-agent-sessions/areas/antigravity-provider.md
    - specs/active/multi-provider-agent-sessions/tasks/04-agent-session-http-sse-api.md
    - tools/ai/contracts.mjs
    - tools/ai/registry.mjs
allowed_paths:
  - tools/ai/antigravity-adapter.mjs
  - tools/ai/registry.mjs
  - tools/tests/antigravity-adapter.test.mjs
forbidden_paths:
  - src/**
  - tools/dashboard/src/**
semantic_references:
  decisions: [D1, D4]
  constraints: [C1, C4, C7]
---

# Task: Antigravity adapter

## Goal

Implement the `AgentProvider` adapter for Antigravity / Gemini CLI (`agy` / `agy-node`), providing process management, session creation/resumption, streaming output consumption, and honest capability declarations.

## Requirements

- Implement `AntigravityAgentProvider` in `tools/ai/antigravity-adapter.mjs`.
- Declare `ANTIGRAVITY_CAPABILITIES` reflecting real CLI features (with `interactivePermissions: false` if headless execution bypasses interactive prompts).
- Support process spawning, stream reading, and conversation ID capture.
- Support session resumption across turns using internal conversation IDs.
- Register the provider in `tools/ai/registry.mjs`.

## Verification

```bash
node --test tools/tests/antigravity-adapter.test.mjs
node tools/specs.mjs validate
```
