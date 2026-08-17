---
id: multi-provider-agent-sessions.provider-neutral-core-and-capabilities
status: draft
change: multi-provider-agent-sessions
context:
  required:
    - specs/active/multi-provider-agent-sessions/overview.md
    - specs/active/multi-provider-agent-sessions/areas/provider-neutral-core.md
    - specs/active/multi-provider-agent-sessions/owner-decisions.md
    - tools/ai/contracts.mjs
    - tools/ai/registry.mjs
    - tools/ai/service.mjs
    - tools/ai/turn-runtime.mjs
  optional:
    - specs/active/multi-provider-agent-sessions/areas/migration-and-superseded-spec.md
allowed_paths:
  - tools/ai/**
  - tools/tests/ai-contracts.test.mjs
  - tools/tests/ai-turn-runtime.test.mjs
forbidden_paths:
  - src/**
  - tools/dashboard/src/**
semantic_references:
  decisions: [D1, D2, D7]
  constraints: [C1, C2, C3, C4, C5, C8]
---

# Task: Provider-neutral core and capabilities

## Goal

Extend the shared `tools/ai/` layer with canonical `AgentIdentity { provider, providerSessionId }`, explicit `AgentCapabilities`, `CapabilityNotSupportedError`, multi-provider registry, normalized event schemas (`text.delta`), turn runtime lifecycle, and local normalized UI read-model caching under `.nevo-ai-local/`.

## Requirements

- Update `tools/ai/contracts.mjs` to define `AgentIdentity { provider, providerSessionId }` as the canonical AI session identifier.
- Define `AgentCapabilities` (`interactivePermissions`, `interactiveQuestions`, `interactiveConfirmations`, `resumeSession`, `cancelTurn`, `toolCalls`, `reasoning`, `usage`).
- Define `CapabilityNotSupportedError` thrown when unsupported capabilities are invoked.
- Define normalized `AgentEvent` schemas (`turn.started`, `text.delta`, `reasoning.delta`, `tool.started`, `tool.updated`, `tool.completed`, `interaction.requested`, `interaction.resolved`, `usage.updated`, `turn.completed`, `turn.failed`).
- Update `tools/ai/registry.mjs` to support multiple registered providers (`claude`, `antigravity`, `mock`).
- Update `tools/ai/turn-runtime.mjs` to manage short-lived turn lifecycles, event broadcasting, interaction correlation (`interactionId`), and turn cancellation indexed by `(provider, providerSessionId)`.
- Implement normalized UI read-model caching in `tools/ai/` storing conversation messages, tool invocations, pending interaction state, and `lastEventSeq` under `.nevo-ai-local/transcripts/<provider>/<providerSessionId>.json`, updated incrementally with batching/flush support to guarantee `lastEventSeq` matches the highest sequence of the persisted thread state without owning an AI session lifecycle.

## Verification

```bash
node --test tools/tests/ai-contracts.test.mjs
node --test tools/tests/ai-turn-runtime.test.mjs
node tools/specs.mjs validate
```
