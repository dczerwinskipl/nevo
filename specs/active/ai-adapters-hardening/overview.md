---
id: spec.ai-adapters-hardening
type: change
title: "AI adapters hardening"
status: draft
change: ai-adapters-hardening
---

# AI adapters hardening

## Status

Problem statement only. This draft deliberately contains no selected solution, contract
shape, acceptance criteria, or implementation tasks.

## Goal

Harden NEvo's AI adapter contracts, behaviours, and edge cases so provider-specific process
and protocol states have explicit, consistent meanings throughout the adapter, neutral
runtime, persistence, API, and UI layers.

## Problem

The current provider-neutral contract compresses materially different situations into a small
set of terminal outcomes. A tool may have failed, still be running in a detached provider
process, have an unknown result because its handle was lost, or be closed only because its
owning turn ended. Provider errors, cancellation, runtime timeouts, process termination, and
successful completion can therefore produce similar projections even though their recovery
and UX implications differ.

Provider adapters also vary in how they own child processes, preserve resumable operation
handles, correlate provider and local session identities, persist diagnostic raw events, flush
queued writes, normalize partial output, and close active tools at terminal boundaries. These
differences are currently implemented as provider-local edge cases rather than one audited set
of behaviours.

The Antigravity incidents that motivated this draft include active `run_command` events with no
terminal tool event, provider errors hidden by earlier progress text, missing operation handles,
ambiguous process ownership after timeouts, alias entries in both local-to-provider and identity
forms, and raw diagnostics whose durability and session correlation need explicit lifecycle
rules. Other adapters must be reviewed against the same questions rather than assuming the
Antigravity fix generalizes.

## Discovery questions

- Which process/operation states must be distinct in the provider-neutral contract and UI?
- Which provider operation handles can be safely exposed to the neutral runtime while staying
  private from the browser, and which providers support resumable polling at all?
- Who owns cancellation, timeout, direct-child/process-tree termination, and late terminal
  events at each lifecycle boundary?
- What constitutes authoritative tool completion versus inferred closure at turn end?
- When and where must raw provider events be persisted, flushed, retained, redacted, and
  correlated to canonical provider session and Nevo turn IDs?
- Is the Antigravity alias store still required alongside durable session bindings; which
  identity aliases are intentional, and what atomicity/corruption guarantees are required?
- Which compatibility behaviours are provider quirks that must remain local, and which should
  become cross-provider invariants and regression suites?

## Evidence to preserve for discovery

- The two diagnosed Nevo/Antigravity session pairs and their raw event timelines.
- Existing adapter, turn-runtime, transcript-cache, process-termination, binding-service, API,
  projection, and UI tests for every provider.
- Provider protocol documentation and reproducible fixtures for partial output, late events,
  cancellation, quota/provider failure, lost handles, restart, and shutdown.

## Out of scope for this draft

- Selecting a new public status vocabulary or compatibility policy.
- Implementing detached polling, operation-handle persistence, process-tree management, or
  alias-store migration.
- Treating raw provider payloads as browser-visible or authoritative conversation history.
