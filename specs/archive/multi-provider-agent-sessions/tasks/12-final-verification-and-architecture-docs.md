---
id: multi-provider-agent-sessions.final-verification-and-architecture-docs
status: draft
change: multi-provider-agent-sessions
context:
  required:
    - specs/active/multi-provider-agent-sessions/overview.md
    - specs/active/multi-provider-agent-sessions/tasks/11-multi-provider-consistency-audit-and-refinement.md
    - docs/decisions/ADR-0007-provider-neutral-ai-sessions.md
    - docs/development/ai-sessions.md
allowed_paths:
  - docs/decisions/**
  - docs/development/**
  - docs/index.generated.json
  - docs/index.generated.md
  - docs/routing.generated.json
forbidden_paths:
  - src/**
  - tools/**
semantic_references:
  decisions: [D1, D2, D3, D4, D5, D6, D7]
  constraints: [C1, C2, C3, C4, C5, C6, C7, C8, C9, C10]
---

# Task: Final verification and architecture docs

## Goal

Document the completed multi-provider local agent chat and session architecture in `docs/development/ai-sessions.md` and `docs/decisions/ADR-0007-provider-neutral-ai-sessions.md`, rebuild documentation indexes, and run the repository-wide test suite.

## Requirements

- Update `docs/decisions/ADR-0007-provider-neutral-ai-sessions.md` documenting the provider-owned session lifecycle, `(provider, providerSessionId)` canonical identity, shared `AgentSessionBindingService`, `PreToolUse/defer` interaction transport, and `@assistant-ui/react` runtime.
- Update `docs/development/ai-sessions.md` with operational guidance for Claude and Antigravity local integrations.
- Run complete test suite and index checks.

## Verification

```bash
node --test tools/tests/*.test.mjs
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
node tools/specs.mjs check
node tools/docs.mjs check
```
