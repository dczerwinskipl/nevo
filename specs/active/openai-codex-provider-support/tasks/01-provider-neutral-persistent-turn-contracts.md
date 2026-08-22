---
id: openai-codex-provider-support.provider-neutral-persistent-turn-contracts
status: draft
change: openai-codex-provider-support
context:
  required:
    - specs/active/openai-codex-provider-support/overview.md
    - specs/active/openai-codex-provider-support/owner-decisions.md
    - specs/active/openai-codex-provider-support/areas/provider-neutral-runtime.md
    - docs/decisions/ADR-0007-provider-neutral-ai-sessions.md
    - docs/development/ai-sessions.md
    - tools/ai/contracts.mjs
    - tools/ai/registry.mjs
    - tools/ai/service.mjs
    - tools/ai/turn-runtime.mjs
    - tools/ai/transcript-cache.mjs
    - tools/ai/mock-adapter.mjs
    - tools/dashboard/server/ai-routes.mjs
    - tools/dashboard/server/index.mjs
    - tools/dashboard/src/lib/types.ts
    - tools/dashboard/src/lib/nevo-assistant-runtime.ts
    - tools/tests/ai-contracts.test.mjs
    - tools/tests/ai-turn-runtime.test.mjs
    - tools/tests/mock-ai-adapter.test.mjs
    - tools/dashboard/tests/ai-server.test.mjs
    - tools/dashboard/tests/ai-contract-drift.test.mjs
  optional:
    - docs/development/testing-strategy.md
semantic_references:
  decisions: [D2, D3, D5, D7]
  constraints: [C2, C3, C4, C5, C6, C7, C8, C10]
allowed_paths:
  - tools/ai/contracts.mjs
  - tools/ai/registry.mjs
  - tools/ai/service.mjs
  - tools/ai/turn-runtime.mjs
  - tools/ai/transcript-cache.mjs
  - tools/ai/mock-adapter.mjs
  - tools/dashboard/server/ai-routes.mjs
  - tools/dashboard/server/index.mjs
  - tools/dashboard/src/lib/types.ts
  - tools/dashboard/src/lib/nevo-assistant-runtime.ts
  - tools/tests/ai-contracts.test.mjs
  - tools/tests/ai-turn-runtime.test.mjs
  - tools/tests/mock-ai-adapter.test.mjs
  - tools/dashboard/tests/ai-server.test.mjs
  - tools/dashboard/tests/ai-contract-drift.test.mjs
  - tools/dashboard/tests/ai-chat-helpers.test.mjs
forbidden_paths:
  - tools/ai/claude-adapter.mjs
  - tools/ai/antigravity-adapter.mjs
  - tools/ai/codex-*.mjs
  - tools/dashboard/src/components/**
  - src/**
  - tests/NEvo.*/**
---

# Task: Provider-neutral persistent-turn contracts

## Goal

Implement the smallest shared contract changes required for provider-owned session
materialization and a persistent bidirectional active turn, while keeping existing
Claude, Antigravity, mock, HTTP/SSE, transcript, and frontend behavior compatible.

## Implementation constraints

- Add an optional adapter session-creation seam. `AiSessionService#createSession` must
  use a returned provider ID before binding and retain the existing UUID fallback for
  adapters without the seam. Provider creation failure must leave no binding.
- Add `steerTurn` and `planUpdates` to the canonical capability keys/defaults/types.
  Existing adapters normalize them to false through the shared defaults; do not edit
  Claude or Antigravity in this task.
- Add a validated `plan.updated` event containing optional bounded explanation and an
  ordered, bounded non-empty plan of `{ step, status }`, with status limited to
  `pending | inProgress | completed`. Carry it through SSE, transcript projection, and
  frontend event/type contracts without adding a component or visual treatment.
- Add a service/runtime/HTTP steering operation targeting an existing active Nevo turn.
  It must require the capability, validate provider/session/turn correlation, reject
  terminal or waiting turns, call the adapter once, and record the accepted user input
  in the provider-neutral transcript only after provider acceptance.
- Extend interaction-continuation semantics so `respondInteraction` can explicitly say
  the original turn is still in progress. In that case `#runContinuation` must not emit
  `turn.completed`; the original adapter `startTurn` lifecycle owns the terminal event.
- When cancelling `waitingForUser`, call adapter cancellation if a live private
  operation exists and the provider supports it; then clear the interaction and emit
  exactly one failed/cancelled terminal event. Preserve the current no-provider-call
  path for deferred adapters with no live operation.
- Add optional idempotent adapter disposal and make runtime/service/server shutdown
  begin it exactly once after active turns are failed/aborted. Keep shutdown bounded and
  testable without a real process.
- Do not add Codex-specific fields, route names, IDs, or payloads to shared contracts.

## Acceptance criteria

1. A fake provider implementing session creation returns its authoritative ID, the
   binding uses that ID, and failed creation writes no speculative binding.
   `automated: node --test tools/tests/ai-contracts.test.mjs`
2. Exact capability drift tests include `steerTurn` and `planUpdates`; existing mock and
   fake descriptors normalize all keys deterministically.
   `automated: node --test tools/tests/ai-contracts.test.mjs tools/tests/mock-ai-adapter.test.mjs`
3. `plan.updated` accepts only the normalized bounded shape, remains ordered across
   replay/restart, and leaks no provider-private fields.
   `automated: node --test tools/tests/ai-contracts.test.mjs tools/tests/ai-turn-runtime.test.mjs`
4. Steering calls a capable adapter with correlated private operation context, records
   accepted input, and rejects unsupported, cross-session, waiting, and terminal cases
   without invoking it.
   `automated: node --test tools/tests/ai-turn-runtime.test.mjs`
5. An interaction response marked as continuing produces no synthetic terminal event;
   a later real adapter completion produces exactly one `turn.completed`.
   `automated: node --test tools/tests/ai-turn-runtime.test.mjs`
6. Cancellation while waiting invokes provider cancellation exactly once only when a
   live operation exists, clears the pending interaction, and emits exactly one
   cancelled failure.
   `automated: node --test tools/tests/ai-turn-runtime.test.mjs`
7. Shutdown invokes optional adapter disposal once, rejects/finishes active work, and
   does not regress existing shutdown and server-close behavior.
   `automated: node --test tools/tests/ai-turn-runtime.test.mjs`
8. The dashboard production TypeScript build accepts the additive neutral contracts.
   `automated: npm --prefix tools/dashboard run build`

## Verification

```text
node --test tools/tests/ai-contracts.test.mjs tools/tests/ai-turn-runtime.test.mjs tools/tests/mock-ai-adapter.test.mjs
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
node tools/specs.mjs check
```

## Out of scope

Codex protocol/client code, provider registration, plan rendering, steering composer UX,
and changes to existing provider process behavior.
