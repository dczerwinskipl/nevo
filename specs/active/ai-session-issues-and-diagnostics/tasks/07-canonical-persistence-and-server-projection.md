---
id: ai-session-issues-and-diagnostics.canonical-persistence-and-server-projection
status: draft
change: ai-session-issues-and-diagnostics
context:
  required:
    - specs/active/ai-session-issues-and-diagnostics/overview.md
    - specs/active/ai-session-issues-and-diagnostics/owner-decisions.md
    - specs/active/ai-session-issues-and-diagnostics/areas/canonical-turn-work-model.md
    - specs/active/ai-session-issues-and-diagnostics/areas/persistence-and-server-projection.md
    - docs/development/node-tooling-guidelines.md
    - tools/dashboard/server/ai/sessions/transcript-cache.mjs
    - tools/dashboard/server/ai/sessions/service.mjs
    - tools/dashboard/server/ai/sessions/routes.mjs
  optional:
    - tools/dashboard/server/ai/sessions/events/routes.mjs
allowed_paths:
  - tools/dashboard/server/ai/contracts.mjs
  - tools/dashboard/server/ai/model/**
  - tools/dashboard/server/ai/diagnostics/**
  - tools/dashboard/server/ai/sessions/**
  - tools/dashboard/tests/ai-server.test.mjs
  - tools/dashboard/tests/ai-contracts.test.mjs
  - tools/dashboard/tests/session-states-integration.test.mjs
  - tools/dashboard/tests/session-readiness.test.mjs
  - tools/dashboard/tests/transcript-projection.test.mjs
  - tools/dashboard/tests/fixtures/ai-neutral/**
forbidden_paths:
  - tools/dashboard/server/ai/providers/**
  - tools/dashboard/ui/**
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D1, D2, D3, D4, D5, D7, D8, D11]
  constraints: [C1, C2, C3, C4, C7, C8, C9, C12, C15, C16, C17]
  dependency_contracts: [lifecycle-coordinator-and-timeouts]
---

# Task: Implement canonical persistence and semantic server projection

## Goal

Carry the canonical Turn aggregate through persistence, reload, HTTP/SSE, session readiness, and a
temporary V1/V2 chat projection boundary without introducing a second runtime or persistence owner.

## Requirements

- Replace projection-only transcript persistence with canonical durable Turn records and semantic
  Work/FinalAnswer state. No historical transcript migration is required.
- Preserve exact Work and nested-action order/status/timestamps/cause across reload.
- Reconcile shutdown/restart into structured interrupted/unknown state rather than deleting active
  ownership and projecting ready.
- Surface persistence corruption/read/flush/reconciliation failure as unavailable/unknown health.
- Implement semantic session readiness and V2 chat projection, including server-owned workSummary,
  current/latest activity, attention, allowed interaction actions, and transient wait presentation.
- Define idempotent snapshot/SSE event/replay behavior over the canonical model.
- Add the temporary chat representation discriminator and V1 compatibility projection at this
  boundary only. Both read the same canonical state once the new store is active.
- Keep provider-private and diagnostic-only fields out of API/SSE.

## Acceptance criteria

1. Live application and fresh reload produce semantically equal Turn status, ordered Work,
   ToolAction hierarchy, Interaction, and FinalAnswer. `automated: node --test tools/dashboard/tests/ai-server.test.mjs`
2. Commentary/tool/commentary/tool/final ordering and compound invocation grouping survive
   persistence and SSE replay exactly. `automated: node --experimental-strip-types --test tools/dashboard/tests/transcript-projection.test.mjs`
3. Server workSummary supplies activity count/current activity/wait/attention; tests need no provider
   identity or command parsing. `automated: node --test tools/dashboard/tests/ai-server.test.mjs`
4. Corrupt/unreadable/reconciliation-failed state does not become empty ready/idle.
   `automated: node --experimental-strip-types --test tools/dashboard/tests/session-readiness.test.mjs`
5. V1 and V2 can project the same session and switching representation has no lifecycle write or
   provider effect. `automated: node --test tools/dashboard/tests/ai-server.test.mjs`
6. API/SSE serialization contains no provider-private IDs/raw payloads/diagnostic content.
   `automated: node --test tools/dashboard/tests/ai-contracts.test.mjs`

## Verification

```text
node --experimental-strip-types --test tools/dashboard/tests/ai-server.test.mjs tools/dashboard/tests/session-states-integration.test.mjs tools/dashboard/tests/session-readiness.test.mjs tools/dashboard/tests/transcript-projection.test.mjs
```
