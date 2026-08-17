---
id: spec.multi-provider-agent-sessions
type: change
title: Multi-provider local agent chat and session integration
status: draft
change: multi-provider-agent-sessions
---

# Multi-provider local agent chat and session integration

## Context

NEvo Dashboard provides a local, file-backed workspace for specifications, tasks, lifecycle gates, and pull request reviews. The previous specification (`ai-sessions-live-chat-integration`) laid the foundation for specification identity and basic session abstractions, but was heavily focused on Claude as a solitary provider, assumed unrealistic long-running stdin/stdout process interaction, and relied on handcrafted chat mechanics.

This specification supersedes the architectural approach of the older spec. It establishes a truly **provider-neutral local agent chat and session architecture** based on confirmed provider runtime capabilities. The system enables users to leverage their existing local subscriptions (Claude, Antigravity/Gemini, and later Codex/ACP) through local CLI processes on their workstation, without separate API billing, direct frontend-to-CLI coupling, or fragile persistent process loops.

## Goal

Provide a robust, full-featured multi-provider chat and session experience within the NEvo Dashboard and CLI workflow:
1. **Multi-provider local runtime**: Backend-managed local agent processes (Claude first, Antigravity/Gemini second, Codex later) authenticated via existing local subscriptions.
2. **Provider-neutral contracts & capability model**: Clean separation of Nevo session identity (`nevoSessionId`), provider identity, and provider internal session IDs (`providerSessionId`). Explicit `AgentCapabilities` contract where unsupported operations fail with standard `CapabilityNotSupportedError`.
3. **Short-lived turn process & interaction deferral**: Turns execute via short-lived CLI processes. Interactive questions (`AskUserQuestion`) and permissions use verified `PreToolUse/defer` roundtrip resuming across processes, eliminating stdin request-response assumptions.
4. **Unified session binding & execution context**: Shared `AgentSessionBindingService` and `AgentExecutionContext` linking agent sessions to `specId` and optional `taskId` across CLI commands, hooks, and dashboard actions in a history-oriented many-to-one relationship.
5. **Normalized event model with reconnect & replay**: Standardized streaming event model (`turn.started`, `text.delta`, `reasoning.delta`, `tool.*`, `interaction.requested`, `turn.completed`, `turn.failed`). SSE reconnect support with initial state snapshot and pending interaction persistence.
6. **Modern React Chat UI**: Adoption of `@assistant-ui/react` connected via a clean `NevoAssistantRuntime` adapter to replace manual chat mechanics, customized with NEvo styling, tool renderers, thinking accordions, and interactive forms.
7. **Workstation-local persistence**: Session metadata and bindings stored locally under `.nevo-ai-local/sessions.json`, kept strictly outside version control.

## Non-goals

- Implementing cloud-hosted AI proxy servers or billing gateways.
- Maintaining long-running background daemon processes waiting on stdin pipes.
- Exposing raw provider protocols or CLI arguments to the frontend.
- Implementing Codex in the initial scope (architecture remains future-compatible).
- Committing local session credentials, transcripts, or provider tokens to git.

## Classification

| Signal | Rating | Reason |
|---|---|---|
| Behavioral clarity | GREEN | Comprehensive requirements, verified `PreToolUse/defer` interaction flow, capability model, and explicit integration priorities. |
| Public surface impact | RED | Introduces normalized multi-provider HTTP/SSE API, capability schemas, CLI session attach commands, and frontend chat adapter. |
| Package boundary impact | RED | Spans `tools/ai/`, specification tooling runtime context, dashboard backend routes, and dashboard client architecture. |
| Blast radius | RED | Replaces frontend chat UI, extends backend turn runtime for multi-provider adapters, adds Antigravity adapter alongside Claude, and unifies CLI session binding. |
| Reversibility | YELLOW | Local session state lives under `.nevo-ai-local/`; API is backward-compatible with spec identity. |

**Classification: A — Architectural.**

## Constraints

- **C1.** Frontend isolation: The frontend must never communicate directly with provider CLIs or consume raw provider events.
- **C2.** Provider-neutral backend API: Public REST/SSE endpoints use generic names (`/api/agent-sessions/...`), never provider-specific routes.
- **C3.** Session identity separation: `nevoSessionId` is distinct from internal `providerSessionId`. Provider IDs and tokens stay local and are never committed.
- **C4.** Capability model: Provider differences (e.g. interactive questions, tool streaming, permissions, cancellation) are declared via `AgentCapabilities`, not hardcoded provider branches (`if (provider === 'claude')`). Invoking an unsupported capability throws a normalized `CapabilityNotSupportedError`.
- **C5.** Short-lived process lifecycle vs durable session: A Nevo session persists across multiple turns. Turns spawn or resume short-lived provider CLI processes. Interactions (e.g. `AskUserQuestion`) exit the process via `PreToolUse/defer` and resume in a new process upon user response, rather than holding open stdin pipes.
- **C6.** Unified session binding & execution context: Agent sessions bind to specifications (`specId`) and optionally tasks (`taskId`) via a shared `AgentSessionBindingService` and `AgentExecutionContext` used uniformly across CLI commands, hooks, and dashboard.
- **C7.** UI separation: Chat UI uses `@assistant-ui/react` as the underlying runtime library, bridged via a Nevo frontend adapter (`NevoAssistantRuntime`).
- **C8.** Reconnect and transcript semantics: SSE streams support reconnection via session snapshot replay. Pending interactions and session metadata are persisted in `.nevo-ai-local/` across page reloads.
- **C9.** Multi-provider validation: Antigravity is a mandatory second provider with verified modern session/resume support to ensure the abstraction does not leak Claude-specific assumptions.
- **C10.** Git safety: No credentials, session tokens, or raw transcripts in version control. All local state lives under `.nevo-ai-local/`.

## Affected Areas

1. `areas/provider-neutral-core.md`: Core contracts, session identity, capability model, turn runtime, SSE/HTTP API, reconnect/replay semantics.
2. `areas/session-binding-and-context.md`: Shared `AgentSessionBindingService`, `AgentExecutionContext`, spec/task correlation, CLI `agent-session attach`, hook integration.
3. `areas/claude-provider.md`: Claude Code CLI adapter, `PreToolUse/defer` interaction transport discovery, streaming json parsing, resume, permissions, and question handling.
4. `areas/assistant-ui-frontend.md`: `@assistant-ui/react` integration, `NevoAssistantRuntime` adapter, styling, custom renderers for tools/interactions.
5. `areas/antigravity-provider.md`: Antigravity CLI adapter, verified session/resume support, capability declaration, consistency audit.
6. `areas/migration-and-superseded-spec.md`: Superseded spec analysis, reused components, generalized models, and replaced UI code.

## Implementation Decomposition

The implementation is organized into 3 sequential parts (12 tasks total) plus future extension:

- **Part 1: Backend Foundation, CLI Binding & Discovery** (Tasks 01–06)
  - Neutral core contracts, capability schema, persistence under `.nevo-ai-local/`
  - Unified session binding service and `AgentExecutionContext` for CLI and hooks
  - Narrow Claude interaction transport discovery (`PreToolUse/defer` & native permissions)
  - Claude CLI provider adapter (short-lived process, stream-json parsing, resume, cancel)
  - Claude interaction adapter (`PreToolUse/defer` roundtrip, tool events, parallel batch limitation)
  - Neutral HTTP and SSE session API with reconnect and interaction response routes
- **Part 2: Frontend Chat Replacement (`assistant-ui`)** (Tasks 07–09)
  - Integration of `@assistant-ui/react` and custom `NevoAssistantRuntime` adapter
  - Custom tool call, thinking accordion, and interactive permission/question components
  - Dashboard session navigation, spec/task context linking, and multi-provider selection
- **Part 3: Antigravity Provider & Multi-Provider Consistency** (Tasks 10–12)
  - Antigravity CLI adapter with verified session/resume and honest capability declaration
  - Multi-provider consistency audit and contract refinement across Claude and Antigravity
  - Final end-to-end verification, architecture documentation, and ADR updates
- **Part 4: Future Provider Extension** (Out of initial implementation scope)
  - Codex App Server / ACP adapter

## Acceptance Criteria & Verification

1. **AC1 — Neutral Session & Capability Model:** `AgentProvider` interface supports dynamic capability querying (`AgentCapabilities`), normalized `text.delta` event stream, and throws standard `CapabilityNotSupportedError` on unsupported operations. Verified via `tools/tests/ai-contracts.test.mjs`.
2. **AC2 — Shared Session Binding & CLI Execution Context:** `AgentSessionBindingService` and `AgentExecutionContext` resolve `spec-slug` and `spec-id` canonically and bind multiple sessions to specs/tasks across CLI commands, hooks, and dashboard actions. Verified via `tools/tests/agent-binding.test.mjs`.
3. **AC3 — Claude Interaction Discovery & Deferral Roundtrip:** `PreToolUse/defer` flow verified for `AskUserQuestion`, capturing fixtures and executing full roundtrip (`defer -> exit -> resume -> updatedInput -> continuation`) without stdin request-response pipes. Verified via `tools/tests/claude-deferral-discovery.test.mjs` and `tools/tests/claude-interaction.test.mjs`.
4. **AC4 — Claude Vertical Slice:** Real Claude CLI can be invoked for turns, supports resume via `providerSessionId`, streams deltas, handles native permissions, and supports cancellation. Verified via `tools/tests/claude-adapter.test.mjs`.
5. **AC5 — `@assistant-ui/react` Integration:** Dashboard chat renders streaming messages, reasoning/thinking, tool calls, and interactive forms with NEvo theme styling, supporting reconnection without state loss. Verified via `tools/dashboard/tests/ai-chat.test.mjs` and build verification (`npm --prefix tools/dashboard run build`).
6. **AC6 — Antigravity Second Provider:** Antigravity CLI operates through the exact same session API and UI with verified session resumption, honestly exposing its capabilities without backend or frontend provider branching hacks. Verified via `tools/tests/antigravity-adapter.test.mjs`.
7. **AC7 — Multi-Provider Consistency & Docs:** Full consistency audit confirms no residual provider-specific bias in core contracts, verified across Claude and Antigravity with updated ADRs and architecture docs. Verified via complete test suite pass (`node --test tools/tests/*.test.mjs`, `npm --prefix tools/dashboard test`, `node tools/specs.mjs check`).
