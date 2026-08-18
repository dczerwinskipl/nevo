---
id: multi-provider-agent-sessions.agent-execution-modes-and-permissions
status: draft
change: multi-provider-agent-sessions
context:
  required:
    - specs/active/multi-provider-agent-sessions/overview.md
    - specs/active/multi-provider-agent-sessions/tasks/10-antigravity-adapter-and-events.md
    - specs/active/multi-provider-agent-sessions/tasks/11-multi-provider-consistency-audit-and-refinement.md
    - tools/ai/contracts.mjs
    - tools/ai/claude-adapter.mjs
    - tools/ai/antigravity-adapter.mjs
    - tools/ai/binding-service.mjs
allowed_paths:
  - tools/ai/**
  - tools/dashboard/server/**
  - tools/dashboard/src/**
  - tools/tests/**
  - tools/dashboard/tests/**
  - docs/decisions/**
  - docs/development/**
forbidden_paths:
  - src/**
semantic_references:
  decisions: [D1, D2, D3, D4, D5, D7]
  constraints: [C1, C2, C3, C4, C5, C6, C7, C8, C9, C10]
---

# Task: Agent execution modes, permission policies, and unified questions

## Goal

Introduce configurable provider-neutral execution modes (`ask` / `plan` for read-only analysis, `edit` / `acceptEdits` for file edits, and `agent` / `auto` / `bypassPermissions` for full autonomous agent execution), expose mode switching in dashboard session creation and live chat, persist session mode preferences in local bindings (`.nevo-ai-local/bindings.json`), and unify interactive question support across CLI providers.

## Requirements

1. **Provider-neutral execution modes (`AgentExecutionMode`):**
   - Declare supported modes in `ProviderCapabilities` (`supportedModes: ['ask', 'edit', 'agent']`, `defaultMode: 'agent'`).
   - Claude adapter maps:
     - `ask` -> `--permission-mode dontAsk`
     - `edit` -> `--permission-mode acceptEdits`
     - `agent` -> `--permission-mode bypassPermissions` (or `auto`)
   - Antigravity adapter maps execution modes to corresponding CLI tool permissions / subagent profile.

2. **Session creation and dynamic mode switching:**
   - Support `mode` parameter in `CreateSessionOptions` (`POST /api/agent-sessions`) and `StartTurnOptions` (`POST /api/agent-sessions/:provider/:sessionId/turns`).
   - Allow switching mode during an active session in the chat UI.

3. **Persistence in `.nevo-ai-local/`:**
   - Store last-used `mode` per session in `AgentSessionBindingService` (`.nevo-ai-local/bindings.json`) so refreshed/reopened sessions retain their execution mode.

4. **Unified interactive question handling:**
   - Enable unified question prompts (`interaction.requested` / `kind: 'question'`) across providers.
   - For Claude Code headless mode: inject custom tool definition / prompt instructions via temporary settings so the model can invoke interactive questions which get deferred/intercepted to the native Question UI.

## Verification

```bash
node --test tools/tests/*.test.mjs
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
node tools/specs.mjs validate
```
