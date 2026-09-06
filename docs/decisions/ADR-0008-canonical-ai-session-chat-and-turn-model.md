---
id: adr.0008-canonical-ai-session-chat-and-turn-model
type: adr
title: Canonical AI session chat and turn model in the specification dashboard
status: accepted
date: 2026-09-06
supersedes: adr.0007-provider-neutral-ai-sessions
superseded_by: ~
---

# ADR-0008: Canonical AI session chat and turn model in the specification dashboard

## Status

Accepted (supersedes [ADR-0007](ADR-0007-provider-neutral-ai-sessions.md))

## Context

ADR-0007 introduced provider-neutral local AI sessions for the specification dashboard, but framed the conversation in a message-centric model projected onto `@assistant-ui/react`. In that model, tool invocations and reasoning blocks were treated as message attachments, and session progress was driven by message lists (`GET /api/agent-sessions/:provider/:sessionId/messages`).

Real-world usage across multiple providers (Claude Code, OpenAI Codex, and Google Antigravity) demonstrated that this message-centric abstraction was insufficient:
- Provider executions are not monolithic messages; they are structured, multi-step execution lifecycles (Turns) consisting of reasoning, commentary, tool invocations with sub-actions, and interactive prompts (permissions, questions).
- Projecting complex provider execution into messages caused UI race conditions, fragile streaming state, and tight coupling to third-party chat libraries (`@assistant-ui/react`).
- Different providers have distinct interaction protocols: Claude Code operates headlessly and requires an external bridge for questions; Codex operates via native `stdio` JSON-RPC with built-in user input requests; Antigravity runs headlessly without interactive question support in its current transport.
- A first-class, unversioned canonical Turn and Work model was needed to provide a single, consistent source of truth across server persistence, SSE streaming, and browser rendering.

## Decision

### 1. Canonical Turn model

The specification dashboard adopts a canonical Turn model as the primary lifecycle abstraction:
- Every turn is represented by a `CanonicalTurn` structure containing an immutable `id`, composite session identity (`provider`, `providerSessionId`), execution `mode` (`ask`, `edit`, `agent`), discriminated-union `status` (`active`, `waiting`, `requiresAttention`, `cancelling`, `terminal`, `unknown`), ordered `work` items, `activityCount`, `finalAnswer`, and optional `terminalOutcome`.
- The user prompt and assistant response form a logical Turn boundary. A plain composer prompt becomes `userMessage.text`, while enriched prompts carry execution context to the provider without polluting the user-visible transcript text.
- Terminal turns are immutable: once a turn transitions to a terminal state (`completed`, `failed`, `cancelled`, `interrupted`), it cannot transition back or accept new work items.

### 2. Three-level Work hierarchy

Execution activity within a Turn is organized into a strict three-level hierarchy:
- **Level 1 (Turn)**: The top-level execution boundary for a user prompt.
- **Level 2 (Work item)**: Monotonically sequenced, strongly typed items (`commentary`, `reasoning`, `tool`, `interaction`). Items maintain immutable sequence numbers (`seq`) and cannot change type.
- **Level 3 (ToolAction)**: Nested actions within a `tool` Work item representing compound operations (e.g. read, edit, execute). Adding nested actions does not artificially inflate the top-level turn `activityCount`.

### 3. Server-owned projection and readiness

The server owns all semantic projections:
- `workSummary`: Evaluates turn phase, status, activity count, currently active item (`currentActivity`), and whether user attention is required (`attention`).
- `readiness`: Computes session readiness (`ready`, `busy`, `requiresAttention`, `unavailable`) directly from persistence and active runtime state.
- `GET /api/agent-sessions/:provider/:providerSessionId/chat`: The single canonical HTTP endpoint for session chat snapshots, returning turns, work summaries, and readiness.
- The legacy `/messages` endpoint and V1 projection (`projectChatV1`) are completely removed.

### 4. Bespoke React transcript and chat surface

The `@assistant-ui/react` dependency and V1 compatibility scaffolding are eliminated in favor of purpose-built React components:
- `AgentSessionChatSurface`: Root chat component coordinating transcript layout, scroll following, and composer interaction.
- `AgentSessionTranscript`: Renders canonical turns using `TurnCard`, `TurnWorkPanel`, `ToolInvocationCard`, `ReasoningCard`, and `FinalAnswerBubble`.
- `useScrollFollow`: Unified scroll-following hook with viewport-relative tracking, threshold-based auto-following, upward scroll detachment, and a "Nowe wiadomości" unread indicator.

### 5. Provider-neutral interaction bridges

Interaction protocols are mapped cleanly behind provider adapters:
- **Claude Code**: Integrates via a server-owned Fastify Streamable HTTP Model Context Protocol (`/mcp`) endpoint running the official `@modelcontextprotocol/sdk`. Exposes a canonical `ask_user` tool correlated to the active Nevo Turn via opaque headers and scoped TLS trust (`NODE_EXTRA_CA_CERTS`). Dashboard answers unblock the MCP tool call and let Claude continue in the same logical Turn.
- **OpenAI Codex**: Uses native `app-server` JSON-RPC over `stdio` (`item/tool/requestUserInput`).
- **Antigravity**: Truthfully declares `interactiveQuestions: false` in headless mode (`--output-format stream-json`), rejecting interactive questions upfront rather than silently hanging.

## Consequences

- The dashboard codebase is simplified: no dual V1/V2 representation toggles, no legacy message projections, and no `@assistant-ui/react` runtime workarounds.
- Turn state, tool invocations, and interactive prompts persist cleanly in `.nevo-ai-local/transcripts/` and survive server restarts with deterministic orphan recovery.
- Browser/server contracts are strictly typed and unversioned (`CanonicalTurn`, `SessionReadiness`, `WorkItem`).
- The dashboard UI adapts honestly to each provider's real capabilities.
