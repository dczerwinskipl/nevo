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
  stable task IDs rather than paths, titles, or task order.
- Providers own authoritative message history and provider session identity. Neutral
  adapters expose normalized sessions, messages, capabilities, turns, events, and
  permission/question interactions.
- Provider-private request/event identifiers and raw payloads stay behind the adapter.
  The neutral runtime assigns stable interaction and question IDs used for all browser
  responses.
- The browser uses HTTP for reads and controls and Server-Sent Events for ordered,
  replayable live-turn events. A snapshot makes pending interactions recoverable after
  a browser disconnect.
- The runtime enforces one active non-terminal turn per provider/session pair, with
  idempotent retry correlation, bounded replay/turn retention, explicit cancellation,
  and provider-safe public failures.
- Part 1 runtime state is in process. A server restart interrupts live turns and clears
  created mock sessions; no repository file is conversation storage.
- Local correlation/discovery evidence introduced after Part 1 belongs under
  `/.nevo-ai-local/`. It is operator-local registry state, ignored by Git, and remains
  distinct from provider-owned history.
- Local dashboard access currently uses trusted-network mode. Loopback or the
  operator's VPN is the trust boundary, not identity authentication. The policy is a
  replaceable server seam and is reported to clients.

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

- The mock provider can verify the complete Part 1 experience without any real
  provider installation or credentials.
- Browser/server tests can lock neutral field and event names while adapters evolve
  independently.
- Stable spec/task correlation survives file moves and display-name changes.
- A dashboard restart loses live in-memory state by design; the UI must reconnect only
  to state still retained by the running process.
- Trusted-network deployments must treat every VPN member as authorized until an
  identity-aware policy replaces the current seam.
- Real-provider discovery and setup remain separate work and cannot revise these
  neutral contracts without a new architectural decision.
