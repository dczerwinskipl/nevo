---
id: spec.multi-provider-agent-sessions
type: change
title: Multi-provider local agent chat and session integration
status: draft
change: multi-provider-agent-sessions
---

# Multi-provider local agent chat and session integration

## Context

NEvo Dashboard provides a local, file-backed workspace for specifications, tasks, lifecycle gates, and pull request reviews. The previous specification (`ai-sessions-live-chat-integration`) laid the foundation for specification identity and basic session abstractions, but was heavily focused on Claude as a solitary provider and relied on handcrafted chat mechanics.

This specification supersedes the architectural approach of the older spec. It generalizes the agent session domain into a truly **provider-neutral local agent chat and session architecture**. The system allows users to leverage their existing local subscriptions (Claude, Antigravity/Gemini, and later Codex/ACP) through local CLI processes on their workstation, without separate API billing or direct frontend-to-CLI coupling.

## Goal

Provide a robust, full-featured multi-provider chat and session experience within the NEvo Dashboard:
1. **Multi-provider local runtime**: Backend-managed local agent processes (Claude first, Antigravity/Gemini second, Codex later) authenticated via existing local subscriptions.
2. **Provider-neutral contracts**: Clean separation of Nevo session identity (`nevoSessionId`), provider identity, and provider internal session IDs (`providerSessionId`). Capability-driven behavior model (`AgentCapabilities`).
3. **Normalized turn & interaction stream**: Common streaming event model (`turn.started`, `text.delta`, `tool.*`, `interaction.requested` for permissions/questions/confirmations, `turn.completed`, `turn.failed`).
4. **Modern React Chat UI**: Adoption of `@assistant-ui/react` connected via a clean frontend adapter to replace manual chat mechanics, customized with NEvo styling, tool renderers, and permission/question interactions.
5. **Specification context & persistence**: Workstation-local session registry associating multiple sessions/providers with specifications, preserved across server restarts and short-lived CLI turn processes.

## Non-goals

- Implementing cloud-hosted AI proxy servers or billing gateways.
- Equating a Nevo session to a permanent daemon process (sessions survive process lifecycles).
- Exposing raw provider protocols or CLI arguments to the frontend.
- Implementing Codex in the initial scope (architecture remains future-compatible).
- Committing local session credentials, transcripts, or provider tokens to git.

## Classification

| Signal | Rating | Reason |
|---|---|---|
| Behavioral clarity | GREEN | Comprehensive requirements, clear architectural boundaries, capability model, and explicit integration priorities. |
| Public surface impact | RED | Introduces normalized multi-provider HTTP/SSE API, capability schemas, and frontend chat adapter. |
| Package boundary impact | RED | Spans `tools/ai/`, dashboard server routes, and dashboard client architecture. |
| Blast radius | RED | Replaces frontend chat UI, extends backend turn runtime for multi-provider adapters, adds Antigravity adapter alongside Claude. |
| Reversibility | YELLOW | Local session state lives under `.nevo-ai-local/`; API is backward-compatible with spec identity. |

**Classification: A — Architectural.**

## Constraints

- **C1.** Frontend isolation: The frontend must never communicate directly with provider CLIs or consume raw provider events.
- **C2.** Provider-neutral backend API: Public REST/SSE endpoints use generic names (`/api/agent-sessions/...`), never provider-specific routes.
- **C3.** Session identity separation: `nevoSessionId` is distinct from internal `providerSessionId`. Provider IDs and tokens stay local and are never committed.
- **C4.** Capability model: Provider differences (e.g. interactive questions, tool streaming, permissions, cancellation) are declared via `AgentCapabilities`, not hardcoded provider branches (`if (provider === 'claude')`).
- **C5.** Process lifecycle vs Session lifecycle: A Nevo session persists across multiple turns and short-lived provider CLI process executions.
- **C6.** UI separation: Chat UI uses `@assistant-ui/react` as the underlying runtime library, bridged via a Nevo frontend adapter so that UI library swaps never impact the backend.
- **C7.** Multi-provider validation: Antigravity is a mandatory second provider to ensure the abstraction does not leak Claude-specific assumptions.
- **C8.** Git safety: No credentials, session tokens, or raw transcripts in version control. All local state lives under `.nevo-ai-local/`.

## Affected Areas

1. `areas/provider-neutral-core.md`: Core contracts, session identity, capability model, turn runtime, SSE/HTTP API.
2. `areas/claude-provider.md`: Claude Code CLI adapter, streaming json parsing, resume, permissions, and question handling.
3. `areas/assistant-ui-frontend.md`: `@assistant-ui/react` integration, Nevo runtime adapter, styling, custom renderers for tools/interactions.
4. `areas/antigravity-provider.md`: Antigravity CLI adapter, machine-readable stream integration, capability declaration, consistency audit.
5. `areas/migration-and-superseded-spec.md`: Superseded spec analysis, reused components, generalized models, and replaced UI code.

## Implementation Decomposition

The implementation is organized into 3 sequential parts plus future extension:

- **Part 1: Backend Foundation & Claude Vertical Slice** (Tasks 01–04)
  - Neutral core contracts, capability schema, persistence under `.nevo-ai-local/`
  - Claude CLI provider adapter (spawning, streaming, resume, cancel)
  - Claude permission & question interaction mapping
  - Neutral HTTP and SSE session API
- **Part 2: Frontend Chat Replacement (`assistant-ui`)** (Tasks 05–07)
  - Integration of `@assistant-ui/react` and custom NEvo runtime adapter
  - Custom tool call, thinking, and permission/question interaction components
  - Dashboard session navigation, spec/task context linking, and multi-provider selection
- **Part 3: Antigravity Provider & Multi-Provider Consistency** (Tasks 08–10)
  - Antigravity CLI adapter with honest capability declaration
  - Event and tool mapping for Antigravity
  - Multi-provider consistency pass, architecture documentation, and end-to-end tests
- **Part 4: Future Provider Extension** (Out of initial implementation scope)
  - Codex App Server / ACP adapter

## Acceptance Criteria & Verification

1. **AC1 — Neutral Session & Capability Model:** `AgentProvider` interface supports dynamic capability querying (`AgentCapabilities`) and neutral turn execution. Verified via `tools/tests/ai-contracts.test.mjs`.
2. **AC2 — Claude Vertical Slice:** Real Claude CLI can be invoked for turns, supports resume via `providerSessionId`, streams deltas, handles interactive permissions and `AskUserQuestion`, and supports cancellation. Verified via `tools/tests/claude-adapter.test.mjs` and e2e tests.
3. **AC3 — `@assistant-ui/react` Integration:** Dashboard chat renders streaming messages, reasoning/thinking, tool calls, and interactive forms with NEvo theme styling. Verified via `tools/dashboard/tests/ai-chat.test.mjs` and build verification (`npm --prefix tools/dashboard run build`).
4. **AC4 — Antigravity Second Provider:** Antigravity CLI operates through the exact same session API and UI, honestly exposing its capabilities without backend or frontend provider branching hacks. Verified via `tools/tests/antigravity-adapter.test.mjs`.
5. **AC5 — Multi-Provider Session Context:** Multiple sessions across different providers can be attached to a single specification and navigated seamlessly in the dashboard. Verified via dashboard integration tests and specs CLI checks.
