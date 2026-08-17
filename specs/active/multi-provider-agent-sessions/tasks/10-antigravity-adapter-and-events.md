---
id: multi-provider-agent-sessions.antigravity-adapter-and-events
status: draft
change: multi-provider-agent-sessions
context:
  required:
    - specs/active/multi-provider-agent-sessions/overview.md
    - specs/active/multi-provider-agent-sessions/areas/antigravity-provider.md
    - specs/active/multi-provider-agent-sessions/tasks/06-agent-session-http-sse-api.md
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
  decisions: [D1, D2, D4]
  constraints: [C1, C3, C4, C9]
---

# Task: Antigravity adapter and events

## Goal

Implement the `AgentProvider` adapter for Antigravity / Gemini CLI (`agy` / `agy-node`), verifying real modern session creation and resumption contracts, mapping output stream to normalized `text.delta`, `reasoning.delta`, and `tool.*` events, and declaring honest capabilities with `CapabilityNotSupportedError`.

## Requirements

- Implement `AntigravityAgentProvider` in `tools/ai/antigravity-adapter.mjs` adhering to `AgentProvider`.
- Declare `ANTIGRAVITY_CAPABILITIES` reflecting real CLI features (with `interactivePermissions: false`).
- Throw `CapabilityNotSupportedError` if unsupported operations (such as interactive permission responses) are invoked.
- Support process spawning, stream reading, and conversation ID capture as `providerSessionId`.
- Support session resumption across turns using `(provider, providerSessionId)`.
- Parse Antigravity output stream into normalized `text.delta`, `reasoning.delta`, and `tool.*` events.
- Register the provider in `tools/ai/registry.mjs`.

## Verification

```bash
node --test tools/tests/antigravity-adapter.test.mjs
node tools/specs.mjs validate
```
