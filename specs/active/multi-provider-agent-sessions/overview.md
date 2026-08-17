---
id: spec.multi-provider-agent-sessions
type: change
title: Multi-provider local agent chat and session integration
status: draft
change: multi-provider-agent-sessions
---

# Multi-provider local agent chat and session integration

## Context

NEvo Dashboard provides a local, file-backed workspace for specifications, tasks, lifecycle gates, and pull request reviews. The previous specification (`ai-sessions-live-chat-integration`) attempted to layer an artificial Nevo-owned session lifecycle and synthetic session IDs over provider sessions, while assuming unrealistic long-running stdin/stdout loops.

This specification supersedes that approach with an essential simplification: **Nevo does not own AI session lifecycles. Providers own their sessions; Nevo stores local provider-neutral bindings from specs and tasks to provider session identities `(provider, providerSessionId)` and uses backend adapters to interact with those sessions.**

## Goal

Provide a robust, multi-provider chat and session integration for local AI coding agents within the NEvo Dashboard and CLI workflow:
1. **Provider-owned local sessions**: Local agent processes (Claude first, Antigravity/Gemini second, Codex later) authenticate via existing user subscriptions without separate token billing.
2. **Canonical session identity**: An agent session is identified solely by its `(provider, providerSessionId)` pair. No artificial `nevoSessionId` or secondary lifecycle state machine is introduced.
3. **Provider-neutral binding service**: A shared `AgentSessionBindingService` and `AgentExecutionContext` associate `(provider, providerSessionId)` with canonical `specId` and optional `taskId` across CLI commands, hooks, and dashboard actions in a history-oriented many-to-one mapping.
4. **Capability-driven provider adapters**: Differences in provider behavior (interactive questions, permissions, tool streaming, cancellation) are declared via `AgentCapabilities`. Unsupported operations fail predictably with `CapabilityNotSupportedError`.
5. **Short-lived turn process & interaction deferral**: Turns execute via short-lived CLI processes. Interactive questions (`AskUserQuestion`) use verified `PreToolUse/defer` roundtrip resuming across processes. Native permission prompts are evaluated and chosen in Task 03 discovery to preserve native CLI security semantics without stdin request-response assumptions.
6. **Normalized streaming events, read-model cache, and thread restoration**: Standardized streaming event model (`turn.started`, `text.delta`, `reasoning.delta`, `tool.*`, `interaction.requested`, `turn.completed`, `turn.failed`). Local normalized UI read-model cache under `.nevo-ai-local/transcripts/<provider>/<providerSessionId>.json` restores `@assistant-ui/react` thread state and pending interactions on page reload, with SSE reconnect deduplication.
7. **Modern React Chat UI**: Adoption of `@assistant-ui/react` connected via a clean `NevoAssistantRuntime` adapter to replace manual chat mechanics, customized with NEvo styling, tool renderers, thinking accordions, and interactive forms.
8. **Workstation-local persistence**: Session bindings and normalized transcript caches stored under `.nevo-ai-local/`, kept strictly outside version control so multiple developers work independently without Git conflicts.

## Non-goals

- Inventing a Nevo-owned session lifecycle or duplicate session IDs (`nevoSessionId`).
- Implementing cloud-hosted AI proxy servers or billing gateways.
- Maintaining long-running background daemon processes waiting on stdin pipes.
- Exposing raw provider protocols or CLI arguments to the frontend.
- Implementing Codex in the initial scope (architecture remains future-compatible).
- Committing local session credentials, transcripts, or provider session IDs to git.

## Classification

| Signal | Rating | Reason |
|---|---|---|
| Behavioral clarity | GREEN | Simplified architecture: providers own session lifecycle, Nevo owns local spec/task bindings and adapter communication. |
| Public surface impact | RED | Introduces normalized multi-provider HTTP/SSE API (`/api/agent-sessions/:provider/:providerSessionId/...`), capability schemas, CLI session attach commands, and frontend chat adapter. |
| Package boundary impact | RED | Spans `tools/ai/`, specification tooling runtime context, dashboard backend routes, and dashboard client architecture. |
| Blast radius | RED | Replaces frontend chat UI, unifies session binding across CLI and dashboard, implements Claude `PreToolUse/defer` adapter, and adds Antigravity adapter. |
| Reversibility | YELLOW | Local session bindings live under `.nevo-ai-local/`; API is backward-compatible with spec identity. |

**Classification: A — Architectural.**

## Constraints

- **C1.** Frontend isolation: The frontend must never communicate directly with provider CLIs or consume raw provider events.
- **C2.** Provider-neutral backend API: Public REST/SSE endpoints use generic names (`/api/agent-sessions/:provider/:providerSessionId/...`), never provider-specific routes.
- **C3.** Canonical session identity: Sessions are canonically identified by `(provider, providerSessionId)`. Nevo does not own a separate `nevoSessionId` or artificial session lifecycle. Provider session IDs and local bindings stay local under `.nevo-ai-local/` and are never committed to version control.
- **C4.** Capability model: Provider differences (e.g. interactive questions, tool streaming, permissions, cancellation) are declared via `AgentCapabilities`, not hardcoded provider branches (`if (provider === 'claude')`). Invoking an unsupported capability throws a normalized `CapabilityNotSupportedError`.
- **C5.** Provider-owned lifecycle & short-lived processes: Providers own their session lifecycles. Turn execution spawns or resumes short-lived CLI processes. `AskUserQuestion` uses `PreToolUse/defer` roundtrip. Native permissions mechanism is determined in Task 03 discovery.
- **C6.** Unified session binding & execution context: Agent sessions bind to specifications (`specId`) and optionally tasks (`taskId`) via a shared `AgentSessionBindingService` and `AgentExecutionContext` integrated at the shared execution boundary in `tools/specs.mjs` and dashboard.
- **C7.** UI separation: Chat UI uses `@assistant-ui/react` as the underlying runtime library, bridged via a Nevo frontend adapter (`NevoAssistantRuntime`).
- **C8.** Reconnect, UI read-model cache, and thread restoration: SSE streams support reconnection with event deduplication. A local normalized UI read-model cache under `.nevo-ai-local/transcripts/<provider>/<providerSessionId>.json` restores conversation thread state and pending interactions across page reloads without creating a second AI session lifecycle.
- **C9.** Multi-provider validation: Antigravity is a mandatory second provider with verified modern session/resume support to ensure the abstraction does not leak Claude-specific assumptions.
- **C10.** Git safety: No credentials, session tokens, or raw transcripts in version control. All local state lives under `.nevo-ai-local/`.

## Affected Areas

1. `areas/provider-neutral-core.md`: Core contracts, canonical identity `(provider, providerSessionId)`, capability model, turn runtime, SSE/HTTP API, normalized UI read-model cache, reconnect/replay semantics.
2. `areas/session-binding-and-context.md`: Shared `AgentSessionBindingService`, `AgentExecutionContext`, spec/task correlation, CLI `agent-session attach`, integration with real `tools/specs.mjs` execution path.
3. `areas/claude-provider.md`: Claude Code CLI adapter, `AskUserQuestion` `PreToolUse/defer` roundtrip, Task 03 native permissions discovery, streaming json parsing, and resume.
4. `areas/assistant-ui-frontend.md`: `@assistant-ui/react` integration, `NevoAssistantRuntime` adapter, thread history restoration from local read-model cache, styling, custom renderers.
5. `areas/antigravity-provider.md`: Antigravity CLI adapter, verified session/resume support, capability declaration, consistency audit.
6. `areas/migration-and-superseded-spec.md`: Superseded spec analysis, reused components, generalized models, and replaced UI code.

## Implementation Decomposition

The implementation is organized into 3 sequential parts (12 tasks total) plus future extension:

- **Part 1: Backend Foundation, CLI Binding & Discovery** (Tasks 01–06)
  - Task 01: `provider-neutral-core-and-capabilities` (Core contracts, `AgentIdentity { provider, providerSessionId }`, capabilities, event schemas, normalized UI read-model cache)
  - Task 02: `session-binding-and-execution-context` (Shared `AgentSessionBindingService`, `AgentExecutionContext`, integration with `tools/specs.mjs` shared execution boundary, `agent-session attach` CLI)
  - Task 03: `claude-interaction-transport-discovery` (Narrow `PreToolUse/defer` verification for `AskUserQuestion`, min version >= 2.1.89, fixtures, native permissions comparison)
  - Task 04: `claude-provider-adapter` (Claude CLI short-lived process, stream-json parsing, resume via UUID, cancel)
  - Task 05: `claude-interaction-and-deferral` (`AskUserQuestion` deferral roundtrip, native permission handling selected from Task 03, parallel tool call limitation)
  - Task 06: `agent-session-http-sse-api` (Provider-neutral REST endpoints `/api/agent-sessions/:provider/:providerSessionId/...`, SSE stream with reconnect, session snapshot and history endpoint)
- **Part 2: Frontend Chat Replacement (`assistant-ui`)** (Tasks 07–09)
  - Task 07: `assistant-ui-integration-and-adapter` (`@assistant-ui/react`, custom `NevoAssistantRuntime` adapter, thread restoration on reload, removal of legacy chat mechanics)
  - Task 08: `custom-renderers-and-interaction-ui` (Tailwind/Radix renderers for thinking accordion, tool cards, permission prompts, question forms, pending interaction correlation)
  - Task 09: `dashboard-session-ux-and-spec-binding` (Sidebar session list, provider badges, spec detail session panel, new session modal)
- **Part 3: Antigravity Provider & Multi-Provider Consistency** (Tasks 10–12)
  - Task 10: `antigravity-adapter-and-events` (Antigravity CLI adapter, verified session resume, stream parsing, capability enforcement)
  - Task 11: `multi-provider-consistency-audit-and-refinement` (Cross-provider consistency audit, eliminating provider bias in backend and UI)
  - Task 12: `final-verification-and-architecture-docs` (ADR-0007 update, architecture docs in `docs/development/`, full repo verification)
- **Part 4: Future Provider Extension** (Out of initial implementation scope)
  - Codex App Server / ACP adapter

## Acceptance Criteria & Verification

1. **AC1 — Neutral Session & Capability Model:** `AgentProvider` interface supports dynamic capability querying (`AgentCapabilities`), normalized `text.delta` event stream, and throws standard `CapabilityNotSupportedError` on unsupported operations. Sessions are identified solely by `(provider, providerSessionId)`. Verified via `tools/tests/ai-contracts.test.mjs`.
2. **AC2 — Shared Session Binding & CLI Execution Context:** `AgentSessionBindingService` and `AgentExecutionContext` integrate at the shared execution boundary of `tools/specs.mjs`, resolve `spec-slug` and `spec-id` canonically, and bind multiple sessions to specs/tasks across CLI commands, hooks, and dashboard actions. Verified via `tools/tests/agent-binding.test.mjs`.
3. **AC3 — Claude Interaction Discovery & Deferral Roundtrip:** `PreToolUse/defer` flow verified for `AskUserQuestion`, capturing fixtures and executing full roundtrip (`defer -> exit -> resume -> updatedInput -> continuation`) without stdin request-response pipes; native permissions transport evaluated and selected in Task 03. Verified via `tools/tests/claude-deferral-discovery.test.mjs` and `tools/tests/claude-interaction.test.mjs`.
4. **AC4 — Claude Vertical Slice:** Real Claude CLI can be invoked for turns, supports resume via `providerSessionId`, streams deltas, handles native permissions, and supports cancellation. Verified via `tools/tests/claude-adapter.test.mjs`.
5. **AC5 — `@assistant-ui/react` Integration & Reload Thread Restoration:** Dashboard chat renders streaming messages, reasoning/thinking, tool calls, and interactive forms with NEvo theme styling; page reloads restore full conversation thread and pending interactions from the local normalized read-model cache without state loss. Verified via `tools/dashboard/tests/ai-chat.test.mjs` and build verification (`npm --prefix tools/dashboard run build`).
6. **AC6 — Antigravity Second Provider:** Antigravity CLI operates through the exact same session API and UI with verified session resumption, honestly exposing its capabilities without backend or frontend provider branching hacks. Verified via `tools/tests/antigravity-adapter.test.mjs`.
7. **AC7 — Multi-Provider Consistency & Docs:** Full consistency audit confirms no residual provider-specific bias in core contracts, verified across Claude and Antigravity with updated ADRs and architecture docs. Verified via complete test suite pass (`node --test tools/tests/*.test.mjs`, `npm --prefix tools/dashboard test`, `node tools/specs.mjs check`).
