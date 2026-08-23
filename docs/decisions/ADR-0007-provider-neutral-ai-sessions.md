---
id: adr.0007-provider-neutral-ai-sessions
type: adr
title: Use provider-neutral local AI sessions in the specification dashboard
status: accepted
date: 2026-08-15
supersedes: ~
superseded_by: ~
---

# ADR-0007: Use provider-neutral local AI sessions in the specification dashboard

## Status

Accepted

## Context

The specification workflow needs live AI conversations linked to durable
specifications and stable tasks without making the dashboard, browser contract, or
repository metadata depend on one AI provider. Provider histories may be authoritative
outside the repository, while active turns include streaming output, permission
requests, questions, reconnects, and cancellation. The local-only dashboard also needs
an explicit access boundary and restart semantics.

## Decision

- Every specification has an immutable `spec_id`; sessions correlate to that ID and
  stable task IDs rather than paths, titles, or task order via `AgentSessionBindingService`.
- Providers own authoritative message history and provider session identity. Neutral
  adapters expose normalized sessions, messages, capabilities, turns, events, and
  permission/question interactions.
- Canonical session identity across all internal contracts, registry maps, and HTTP/SSE routes
  is strictly the composite `(provider, providerSessionId)` pair.
- Provider-private request/event identifiers and raw payloads stay behind the adapter.
  The neutral runtime assigns stable interaction and question IDs used for all browser
  responses.
- Provider commentary/progress uses the neutral ordered `progress.delta` activity
  event and is not projected into ordinary assistant transcript text. Final assistant
  text and reasoning remain distinct `text.delta` and `reasoning.delta` channels.
- The browser uses HTTP for reads and controls and Server-Sent Events for ordered,
  replayable live-turn events. A snapshot makes pending interactions recoverable after
  a browser disconnect. Each interaction declares whether a fresh provider invocation
  can reconstruct it after server restart or whether it requires the original live
  provider operation; stale live-operation interactions are interrupted during boot
  reconciliation.
- The runtime enforces one active non-terminal turn per provider/session pair, with
  idempotent retry correlation, bounded replay/turn retention, explicit cancellation,
  and provider-safe public failures.
- Part 2 integrates real CLI agents (Claude Code via `PreToolUse/defer` and Antigravity/Gemini
  via `stream-json`) alongside the mock provider, declaring honest capabilities with
  `CapabilityNotSupportedError` on unsupported operations.
- The dashboard frontend leverages `@assistant-ui/react` runtime with custom rich renderers
  for streaming Markdown (`MarkdownContent`), reasoning (`AiReasoningView`), live tools
  (`AiToolView`), and interactive prompts (`PermissionPrompt`, `QuestionPrompt`).
- Local correlation and transcript caches reside in `/.nevo-ai-local/transcripts/`.
  This is operator-local state, ignored by Git, and remains distinct from provider-owned history.
- Local dashboard access uses trusted-network mode. Loopback or the operator's VPN is the
  trust boundary, not identity authentication. The policy is a replaceable server seam and is
  reported to clients.

## Rejected options

### Wire the dashboard directly to one provider

Rejected because provider-specific request IDs, payloads, and lifecycle behavior would
become browser and persistence contracts. That would prevent the mock vertical slice
from proving the workflow independently and make later providers a UI redesign.

### Create a standalone durable AI session service for Part 1

Rejected because Part 1 is a local repository workflow and providers already own
conversation history. A database/service would add deployment, transaction, migration,
and recovery decisions before discovery proves they are needed. The in-memory runtime
keeps restart limitations explicit while preserving a future persistence seam.

### Persist provider history in specification files

Rejected because specifications are durable planning records, not chat storage.
Embedding mutable conversations or provider payloads would create noisy diffs, expose
provider-private data, and confuse correlation metadata with authoritative history.

## Consequences

- Real Claude Code and Antigravity CLI providers work out-of-the-box in the dashboard alongside
  the mock demonstration adapter.
- The mock provider verifies the complete workflow in automated tests without requiring real
  credentials or external network access.
- Browser/server tests lock neutral field and event names while adapters evolve independently.
- Stable spec/task correlation survives file moves and display-name changes.
- A dashboard restart safely recovers transcript snapshots and reconstructable pending
  interactions from the local transcript cache, while terminalizing interactions whose
  original live provider operation no longer exists.
- The UI adapts seamlessly to provider capabilities (disabling unsupported permissions or features).
- Trusted-network deployments must treat every VPN member as authorized until an
  identity-aware policy replaces the current seam.
