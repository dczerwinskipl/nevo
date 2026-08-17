---
id: ai-sessions-live-chat-integration.provider-neutral-ai-contracts
status: draft
change: ai-sessions-live-chat-integration
depends_on: [stable-spec-identity-and-backfill]
context:
  required:
    - specs/active/ai-sessions-live-chat-integration/overview.md
    - specs/active/ai-sessions-live-chat-integration/areas/provider-neutral-ai-runtime.md
    - specs/active/ai-sessions-live-chat-integration/owner-decisions.md
    - tools/dashboard/server/providers/service.mjs
    - tools/dashboard/server/providers/github.mjs
  optional:
    - tools/dashboard/src/lib/types.ts
allowed_paths:
  - tools/ai/**
  - tools/tests/ai-contracts.test.mjs
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/src/**
semantic_references:
  decisions: [D1, D3, D4]
  constraints: [C4, C5, C6, C7, C8, C18]
  dependency_contracts: [stable-spec-identity-and-backfill]
---

# Task: Provider-neutral AI contracts

## Goal

Create the shared internal session, message, event, provider capability, adapter registry, and error contracts that both mock and Claude implementations must satisfy.

## Dependencies

Depends on stable `specId` projection and lookup semantics from task 01.

## Implementation constraints

- Keep the boundary in internal Node tooling (`tools/ai/**`), not in `src/NEvo.*`.
- Model session identity as provider plus opaque session ID and relation as one `specId` plus `taskIds[]`.
- Use exactly the four statuses from C5 and define timestamp normalization/sorting.
- Represent unsupported operations through explicit capabilities and typed errors.
- Keep normalized messages transient and text-first while allowing later event variants without exposing provider payloads.
- Define logical adapter operations for listing, metadata, messages, creation, starting/streaming/resuming turns, resolving interactions, and cancellation.
- Avoid speculative abstractions for billing, models, attachments, orchestration, or durable tools.

## Acceptance criteria

1. Runtime validation accepts a complete normalized session and rejects missing/invalid `specId`, provider, session ID, task collection, status, or timestamps. `automated: node --test tools/tests/ai-contracts.test.mjs`
2. Session sorting uses `lastActivityAt DESC` with deterministic tie handling and no `isActive`. `automated: node --test tools/tests/ai-contracts.test.mjs`
3. Provider descriptors expose capabilities and unsupported operations return a normalized error without invoking an adapter method. `automated: node --test tools/tests/ai-contracts.test.mjs`
4. Required turn and interaction event variants validate without accepting provider request IDs in the public payload. `automated: node --test tools/tests/ai-contracts.test.mjs`
5. Two fake adapters can be registered and selected through the same registry without provider-specific branching in the service. `automated: node --test tools/tests/ai-contracts.test.mjs`

## Verification

```text
node --test tools/tests/ai-contracts.test.mjs
node tools/specs.mjs validate
```

## Out of scope

- HTTP routes, UI, local persistence, or real provider code.
