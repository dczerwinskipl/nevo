---
id: openai-codex-provider-support.codex-provider-adapter-and-registration
status: draft
change: openai-codex-provider-support
depends_on:
  - provider-neutral-persistent-turn-contracts
  - codex-app-server-client
context:
  required:
    - specs/active/openai-codex-provider-support/overview.md
    - specs/active/openai-codex-provider-support/owner-decisions.md
    - specs/active/openai-codex-provider-support/areas/codex-adapter.md
    - docs/decisions/ADR-0007-provider-neutral-ai-sessions.md
    - docs/development/ai-sessions.md
    - docs/development/codex-app-server-research.md
    - tools/ai/contracts.mjs
    - tools/ai/registry.mjs
    - tools/ai/service.mjs
    - tools/ai/turn-runtime.mjs
    - tools/ai/codex-app-server-client.mjs
    - tools/ai/codex-protocol-baseline.json
    - tools/ai/claude-adapter.mjs
    - tools/ai/antigravity-adapter.mjs
    - tools/dashboard/server/ai-services.mjs
    - tools/tests/claude-adapter.test.mjs
    - tools/tests/antigravity-adapter.test.mjs
    - tools/tests/ai-turn-runtime.test.mjs
    - tools/dashboard/tests/ai-server.test.mjs
    - tools/dashboard/tests/ai-contract-drift.test.mjs
  optional:
    - docs/development/testing-strategy.md
semantic_references:
  decisions: [D1, D2, D3, D4, D6, D7, D8, D9]
  constraints: [C1, C2, C3, C4, C5, C6, C7, C8, C9, C10, C11, C12]
  dependency_contracts:
    - provider-neutral-persistent-turn-contracts
    - codex-app-server-client
allowed_paths:
  - tools/ai/codex-adapter.mjs
  - tools/lib/fs.mjs
  - tools/dashboard/server/ai-services.mjs
  - tools/tests/codex-adapter.test.mjs
  - tools/tests/fs-safety.test.mjs
  - tools/tests/fixtures/codex-adapter/**
  - tools/dashboard/tests/ai-server.test.mjs
  - tools/dashboard/tests/ai-contract-drift.test.mjs
  - docs/development/ai-sessions.md
forbidden_paths:
  - tools/ai/contracts.mjs
  - tools/ai/registry.mjs
  - tools/ai/service.mjs
  - tools/ai/turn-runtime.mjs
  - tools/ai/codex-app-server-client.mjs
  - tools/ai/claude-adapter.mjs
  - tools/ai/antigravity-adapter.mjs
  - tools/dashboard/src/components/**
  - src/**
  - tests/NEvo.*/**
---

# Task: Codex provider adapter, event mapping, and default registration

## Goal

Implement `CodexAgentProvider` on the completed neutral/runtime and app-server client
contracts, register it in the default dashboard service, and document its behavior.

## Dependencies

- `provider-neutral-persistent-turn-contracts` defines provider-owned session creation,
  continuing interactions, waiting cancellation, disposal, and honest capability flags.
- `codex-app-server-client` supplies the verified request/notification/server-request
  transport and failure boundary.

## Implementation constraints

- Provider descriptor id is `codex`, label is `OpenAI Codex`, and availability probes
  the configured `codex` executable without starting/authenticating a turn. Capabilities
  are true only for tested mappings; include resume, cancel, interactive questions and
  permissions, tools, reasoning, and usage. Declare `steerTurn: false` and
  `planUpdates: false` for the first adapter.
- Own one client instance per adapter. `createSession` calls `thread/start` and returns
  `thread.id`. Atomic `startTurn` without an ID performs the same start and publishes
  that real ID before starting the turn. Never allocate or persist a Codex alias.
- Track threads loaded in the current client. For a recorded ID not known loaded, call
  `thread/resume` once and fail the operation if it fails. Do not silently replace a
  failed resume with a new thread.
- Map modes through fields/enums proven by the generated schema. `ask` is non-mutating
  and plan-oriented, `edit` permits workspace edits with interactive safeguards, and
  `agent` preserves autonomous workspace execution with `on-request` escalation at
  thread/resume and turn level. Do not make AGENT unrestricted, weaken ASK, or prevent
  explicitly requested host-tool/Git workflows from entering native approval. If the
  installed schema cannot satisfy one safely, stop for a compatibility decision.
- After `turn/start`, correlate the returned/provider-notified Codex turn ID with the
  Nevo turn private operation. Handle notifications only when thread and turn match;
  ignore unrelated well-formed events from other concurrently loaded threads and
  provider-global notifications that carry no active-turn correlation.
- Treat `item/started` and `item/completed` for the input user message as input lifecycle
  only. They must not emit assistant text/tool events or complete the Nevo turn.
- For agent messages, retain the optional generated-schema phase by item ID.
  `final_answer` emits normal assistant text, `commentary` emits neutral progress, and
  missing phase follows D10's deterministic buffered fallback. Treat `item/completed`
  as authoritative, emit only text not already emitted, and never duplicate the final
  body. Use final item status/data for tool completion.
- Map command execution, file changes, MCP/dynamic tool items that occur in normal Codex
  turns to normalized tool lifecycle events. Unknown item types are ignored unless they
  are required to determine an active consumed item's outcome; never fabricate an event.
- Map readable reasoning summary deltas and raw reasoning only when emitted and allowed.
  Map `thread/tokenUsage/updated` fields verified by schema. Ignore well-formed
  steering/plan notifications because D8 leaves those capabilities unsupported.
- Normalize server requests with a private correlation map:
  command/file approval allow -> turn-scoped accept, deny -> decline; permission-subset
  allow -> requested subset scoped to the turn, deny -> empty/declined grant; user input
  -> normalized questions/answers. Send exactly one response to the original request.
- `respondInteraction` sends the server response and reports that the original turn
  continues. `serverRequest/resolved` may clear private correlation, but real
  `turn/completed` remains the sole terminal authority.
- `cancelTurn` uses `turn/interrupt` for running and waiting turns and tolerates the
  already-terminal race only when the final notification proves it.
- Normalize failed/interrupted/completed turn status exactly once. Provider/client
  failure, invalid consumed payload, failed resume, disposal, or a successful turn with
  an unfinished tool/final-answer item must never emit success. Provider-declared failed
  and interrupted turns remain authoritative even when informational items omit completion.
- Keep rename as the spec archive fast path, with a staged copy/remove fallback only for
  recoverable cross-device/Windows filesystem errors. Never expose the final archive while
  the active source still exists, overwrite an archive conflict, or reorder finalization.
- Register the adapter with Claude, Antigravity, and mock in `ai-services.mjs`; update
  `docs/development/ai-sessions.md`. Do not change chat visuals or existing providers.

## Acceptance criteria

1. Descriptor, availability, default registration, mode metadata, and exact capability
   keys are covered by focused and dashboard contract tests, including false
   `steerTurn` and `planUpdates` values.
   `automated: node --test tools/tests/codex-adapter.test.mjs`
2. New blank sessions and atomic first turns bind only the returned `thread.id`; existing
   sessions resume deterministically, and failed resume never starts replacement history.
   `automated: node --test tools/tests/codex-adapter.test.mjs`
3. Normal and multi-turn fixtures map final-answer, commentary/progress, reasoning,
   tools, usage, and completion in deterministic order without duplicate text or fabricated
   tool success; the preceding user-message item lifecycle and provider-global
   notifications produce no assistant/tool/terminal event.
   `automated: node --test tools/tests/codex-adapter.test.mjs`
4. Command approval, file approval, permission-subset, and user-input fixtures pause the
   same turn, expose only neutral IDs/data, answer the original server request once, and
   continue until real completion.
   `automated: node --test tools/tests/codex-adapter.test.mjs`
5. AGENT configuration uses workspace-write plus on-request approval. Integration-style
   fake app-server cases cover allow and deny for sandbox-blocked host tooling and Git
   metadata workflows, answer the exact request, and continue the same turn.
   `automated: node --test tools/tests/codex-adapter.test.mjs`
6. Cancellation while executing and waiting sends `turn/interrupt`, produces one
   cancelled/interrupted Nevo terminal event, and leaves no pending interaction/request.
   `automated: node --test tools/tests/codex-adapter.test.mjs`
7. Initialization failure, unexpected exit, malformed/invalid consumed messages,
   unknown response correlation, failed resume, provider error, interrupted turn, unsafe
   successful-turn lifecycle gaps, and disposal with active work all fail closed with the
   correct provider/runtime terminal classification.
   `automated: node --test tools/tests/codex-adapter.test.mjs tools/tests/codex-app-server-client.test.mjs`
8. Spec archival uses atomic rename normally, safely falls back for `EPERM`/`EXDEV`,
   fails closed on cleanup/conflicts/unrelated errors, and remains retryable.
   `automated: node --test tools/tests/fs-safety.test.mjs tools/tests/finalize.test.mjs`
9. The full tooling/provider/browser tests and dashboard build pass without live Codex
   calls or credentials.
   `automated: node --test tools/tests/*.test.mjs`
10. Maintainer documentation describes architecture, capabilities, schema refresh,
   process ownership, limitations, and offline/strict verification.
   `automated: node tools/docs.mjs check`

## Verification

```text
node --test tools/tests/codex-app-server-client.test.mjs tools/tests/codex-schema-compat.test.mjs tools/tests/codex-adapter.test.mjs
node --test tools/tests/fs-safety.test.mjs tools/tests/finalize.test.mjs
node --test tools/tests/*.test.mjs
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
node tools/ai/verify-codex-schema.mjs
node tools/specs.mjs check
node tools/docs.mjs check
```

## Documentation impact

Update `docs/development/ai-sessions.md` in the same implementation branch. Do not add a
new ADR unless implementation discovers a durable decision not already covered by
ADR-0007 and D1-D11; that would require owner approval first.

## Out of scope

Live paid tests by default, Codex-specific visual UX, account/model/thread management,
remote transports, session-scoped grants, steering/plan-update implementation, and edits
to shared contracts completed by task 01.
