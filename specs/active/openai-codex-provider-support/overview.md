---
id: spec.openai-codex-provider-support
type: change
title: OpenAI Codex provider support
status: draft
change: openai-codex-provider-support
---

# OpenAI Codex provider support

## Context

Nevo already exposes provider-neutral local AI sessions through `AiAdapterRegistry`,
`AiSessionService`, `AiTurnRuntime`, normalized events/interactions, HTTP controls, and
SSE. Claude Code and Antigravity adapters translate provider-specific process streams
into those contracts. This change adds OpenAI Codex as another first-class provider,
using the official app-server protocol rather than reusing either CLI adapter's process
model.

The protocol baseline was checked on 2026-08-22 against the official
[Codex app-server documentation](https://developers.openai.com/codex/app-server) and a
successful manual Windows smoke test of Codex CLI `0.149.0`. The test verified stdio
JSONL, initialization, `thread/start`, `turn/start`, the returned thread/turn identities,
the initial user-message item lifecycle, and provider-global notifications. Concise
versioned evidence and its contract boundary are preserved in
[`docs/development/codex-app-server-research.md`](../../docs/development/codex-app-server-research.md).
Generated-schema verification remains an implementation gate because one successful
version does not establish every consumed field union or future compatibility rule.

## Classification

| Signal | Rating | Evidence |
|---|---|---|
| Behavioral clarity | YELLOW | The official protocol and owner requirements are clear, but exact generated field unions must be verified against the implementation-time Codex version. |
| Public surface impact | RED | Provider-allocated sessions, persistent continuations, waiting cancellation, and adapter disposal require small neutral lifecycle additions; steering/plan operations are deferred, with capability flags remaining false. |
| Package boundary impact | GREEN | Work remains inside the existing Node-based `tools/ai` and dashboard tooling boundary and introduces no new project/package or dependency direction. |
| Blast radius | RED | The change touches shared turn lifecycle, interaction cancellation, shutdown, protocol transport, provider registration, and browser/server contract tests. |
| Reversibility | GREEN | Removing the provider and its additive neutral capabilities requires no data migration; provider histories remain owned by Codex. |

Classification: **A — Architectural**, with per-change branch mode. The public-contract
and blast-radius signals require a full change directory even though the implementation
is intentionally limited to tooling.

## Current architecture and discovered gaps

- `tools/ai/contracts.mjs` defines eight fixed capabilities and normalized turn,
  message, reasoning, tool, interaction, usage, completion, and failure events. Adding
  honest false capability flags is small, but a real steering operation and plan event
  would cross registry/runtime/service/HTTP/transcript/frontend boundaries; D8 defers
  those operations from the first adapter.
- `tools/ai/registry.mjs` requires `startTurn` and `cancelTurn`; adapters may expose
  `respondInteraction`, but there is no provider session-creation or disposal seam.
- `tools/ai/service.mjs#createSession` allocates a UUID before the provider is called.
  That is incompatible with D2 because a Codex session must be the real `thread.id`.
- `tools/ai/turn-runtime.mjs` assumes an interaction response starts a finite
  continuation that completes when `respondInteraction` returns. Codex instead sends a
  JSON-RPC response on the already-running turn and continues streaming until the real
  `turn/completed` notification.
- Cancellation in `waitingForUser` currently marks the Nevo turn failed without calling
  the adapter. That is correct for Claude's exited/deferred process, but would leave an
  active Codex turn and server request alive.
- Dashboard server close calls the synchronous runtime shutdown, but no shared contract
  disposes a persistent provider process.
- Claude and Antigravity start one process per turn and reconstruct continuation with
  `--resume`/`--conversation`; their adapter-local identity workarounds must not become
  the Codex design.
- ADR-0007 already requires provider-owned history and identity, canonical
  `(provider, providerSessionId)`, provider-private request IDs, normalized
  interactions, ordered replayable events, one live turn per session, and fail-safe
  public errors. The Codex design follows rather than supersedes it.

## Problem

Nevo cannot currently host a provider whose conversation and active-turn lifecycles are
managed over one persistent bidirectional connection. Treating Codex like Claude would
lose explicit thread/turn correlation, server-request responses, interruption,
authoritative item completion, and process-wide failure behavior. Adding raw
Codex branches to the dashboard would violate ADR-0007 and prevent the integration from
validating the neutral abstraction.

## Constraints

- **C1.** Use the official `codex app-server` interface over local stdio JSONL; remote
  WebSocket/Unix transports are out of scope.
- **C2.** Keep Codex wire methods, payloads, JSON-RPC IDs, item IDs used only for
  provider correlation, and generated schema details inside the Codex client/adapter.
- **C3.** Use Codex `thread.id` directly as `providerSessionId`; never create a Codex
  binding from a speculative Nevo UUID.
- **C4.** Preserve ADR-0007 invariants: canonical composite identity, one active turn,
  ordered session event sequence, provider-private request correlation, safe public
  failures, and provider-owned history.
- **C5.** `item/completed` and `turn/completed` are authoritative. Deltas may update
  current state but must not fabricate success or duplicate final content.
- **C6.** Fail closed on app-server absence, initialization/resume failure, unexpected
  exit, malformed messages, unknown response correlation, invalid consumed payloads,
  interruption, and disposal with active work.
- **C7.** Use explicit request IDs and thread/turn/item correlation maps; never correlate
  concurrent operations by array index or arrival position.
- **C8.** Add no external package and no new project. Use Node built-ins and the schema
  generator shipped with the selected Codex executable.
- **C9.** Default automated tests use fake process/transport fixtures and require no
  credentials, paid calls, network, or installed Codex. Any real smoke test is opt-in.
- **C10.** Do not redesign dashboard visuals, deterministic workflow execution, spec
  lifecycle, Claude behavior, or Antigravity behavior.
- **C11.** Experimental app-server capability opt-in is limited to a required feature
  in this scope (currently user-input requests) and must be confirmed by the generated
  schema; unrelated experimental methods remain unused.
- **C12.** Treat the Codex CLI `0.149.0` smoke test as versioned evidence rather than a
  universal contract: persist only `thread.id`, distinguish user-message items from
  assistant/tool output, ignore unrelated well-formed provider-global notifications,
  emit the documented minimal envelope, and tolerate an otherwise harmless incoming
  `jsonrpc` member unless the selected generated schema explicitly requires rejection.

## Options and trade-offs

### Option 1: Native persistent app-server client and adapter — selected

- **Complexity:** L
- **What changes:** Add a narrow client, Codex adapter, the minimal neutral lifecycle
  seams described by D3/D7, and honest false capability flags described by D8.
- **Trade-offs:** More careful multiplexing and cleanup than a per-turn process, but the
  protocol remains authoritative and provider-specific complexity stays cohesive.
- **Boundary check:** No new package/project or external dependency. Generic modules
  depend only on neutral callbacks and capabilities; Codex modules depend inward on
  those contracts.
- **Unlocks:** Correct interactive requests, deterministic resume, native interrupt,
  accurate item lifecycle, concurrent request correlation, and future Codex features
  behind the same adapter boundary.
- **Forecloses:** Initial `turn/steer` and normalized plan-update support; both remain an
  explicit follow-up rather than expanding unrelated surfaces before the core provider
  ships. It deliberately does not make app-server payloads a shared public API.

### Option 2: Spawn app-server or Codex execution separately for every turn — rejected

- **Complexity:** M initially, L after interaction/resume edge cases
- **Trade-offs:** Smaller first diff but recreates persistent protocol state and cleanup
  around each request, duplicates Claude's continuation shape, and makes server-initiated
  requests fragile.
- **Unlocks:** Reuse of some process-termination helpers.
- **Forecloses:** Natural multiplexing, native in-flight interaction continuation, and
  faithful process-wide failure semantics.
- **Rejection reason:** It contradicts the owner's explicit architecture direction and
  hides rather than validates the abstraction gaps.

### Option 3: Use Codex SDK/non-interactive execution — rejected

- **Complexity:** M
- **Trade-offs:** Attractive for one-shot automation but does not expose the required
  rich client protocol and may introduce a new package dependency.
- **Unlocks:** Simpler batch/CI jobs.
- **Forecloses:** Required app-server approvals, questions, explicit thread/turn/item
  lifecycles, and generated app-server contract validation.
- **Rejection reason:** Official guidance positions app-server for deep product
  integration and the owner explicitly selected it.

## Owner decisions

The owner's instructions resolve the architecture and scope gates. See
`owner-decisions.md` D1-D9. No new package, external dependency, persistence owner,
transaction behavior, or .NET public API is introduced.

## Proposed architecture

```text
codex app-server process (one per adapter instance)
  -> CodexAppServerClient (stdio JSONL, handshake, request map, server requests)
  -> CodexAgentProvider (thread/turn/item/interaction normalization)
  -> AiTurnRuntime / AiSessionService (provider-neutral lifecycle and capabilities)
  -> existing HTTP/SSE and transcript contracts
```

### Narrow app-server client

The client lazily spawns `codex app-server --listen stdio://`, sends exactly one
`initialize` request followed by `initialized`, assigns monotonically unique request
IDs, and owns a pending-request map. It parses one JSON object per stdout line and
classifies each message as response, notification, or server request by shape. It
provides typed-at-the-boundary/narrowly validated access only to the methods consumed by
the adapter. Outgoing messages use the documented minimal envelope. Incoming
well-formed envelopes may carry an optional harmless `jsonrpc` member without becoming
protocol corruption solely for that reason.

Unexpected process termination or a protocol-integrity failure rejects initialization,
every pending client request, every active adapter turn, and every unanswered server
request. Disposal is idempotent, stops accepting work, interrupts/fails active work,
closes stdin, and terminates the process within a bounded path.

### Codex adapter mapping

| Nevo operation/contract | Codex mapping |
|---|---|
| create session | `thread/start`; bind returned `thread.id` |
| first atomic turn without a session | `thread/start`, publish returned identity, then `turn/start` |
| existing session after restart/unload | `thread/resume(threadId)`, then `turn/start` |
| start user turn | `turn/start` with text input and mode-derived stable settings |
| cancel running or waiting turn | `turn/interrupt`; terminal Nevo outcome is cancellation/interruption, never success |
| final assistant answer | `agentMessage.phase=final_answer` -> `message.started` / `text.delta`, reconciled with authoritative completed item |
| commentary/progress | `agentMessage.phase=commentary` -> neutral `progress.delta`; never normal assistant transcript text |
| reasoning | reasoning summary/raw deltas -> `reasoning.delta`; never normal assistant transcript text |
| tool/action | `item/started`, relevant deltas, and authoritative `item/completed` using Codex item ID privately mapped to neutral tool ID |
| usage | `thread/tokenUsage/updated` -> normalized `usage.updated` using fields verified from generated schema |
| completion/failure | `turn/completed.status`; preceding `error` details are normalized to safe `AiError` codes |
| command/file approval | server request -> neutral permission -> turn-scoped Codex response |
| user input | `item/tool/requestUserInput` (exact generated name wins) -> neutral question response on the same request |

The adapter treats `item/started`/`item/completed` for the input user message as input
lifecycle only, not assistant/tool output or terminal completion. Well-formed
provider-global notifications such as `remoteControl/status/changed`,
`mcpServer/startupStatus/updated`, and `skills/changed` may arrive without an active turn
and are ignored unless a future, explicitly supported feature consumes them.
Agent-message phase is optional in the generated protocol. The adapter uses a completed
item's phase when start omitted it; if phase remains absent, superseded messages become
progress and the final remaining completed unphased message is the compatibility final
only when no explicit final answer exists. Unknown non-null or conflicting phases fail
closed because routing them to the main conversation would be ambiguous.

Nevo execution modes retain their existing meanings. The implementation derives exact
wire enums/fields from the generated schema: `ask` must be non-mutating and
plan-oriented, `edit` allows workspace changes with interactive safeguards, and
`agent` keeps autonomous workspace execution while using on-request approval when the
workspace sandbox blocks required host-level work. If the current stable schema
cannot express one of these without a material semantic compromise, implementation
stops for an owner compatibility decision rather than silently selecting a weaker
mode.

### Shared neutral extensions

- Optional adapter `createSession` returns a provider-owned ID before binding.
- Interaction response can report that the original provider turn continues; runtime
  waits for the real terminal notification rather than synthesizing completion.
- Normalized interactions declare whether a fresh provider invocation can reconstruct
  them after restart or whether they require the original live provider operation.
  Reconciliation and graceful shutdown interrupt stale live-operation interactions.
- Waiting-turn cancellation calls provider cancellation when a live private operation
  exists.
- Registry/runtime shutdown invokes optional idempotent adapter disposal.
- Capability contracts add `steerTurn` and `planUpdates` only as honest discovery flags.
  The first Codex adapter and existing providers report both as false; no steering
  operation or plan event/HTTP/transcript/frontend behavior is added in this change.

## Areas

- `areas/provider-neutral-runtime.md` — minimal shared contracts needed by persistent,
  provider-owned sessions and active turns.
- `areas/app-server-client.md` — app-server process, handshake, correlation, schema
  verification, and failure boundary.
- `areas/codex-adapter.md` — Codex session/turn/event/interaction mapping and default
  dashboard registration.

## Change-wide acceptance criteria

1. Codex appears as an available/unavailable provider through the existing provider
   registry and declares only capabilities proven by adapter tests.
2. New and resumed Codex sessions use `thread.id` as the only provider session identity,
   and multiple turns resume deterministically.
3. Normal streamed turns preserve deterministic event order and authoritative terminal
   outcomes for final messages, commentary/progress, reasoning, tools, usage, success,
   interruption, and failure
   without leaking provider-private fields; the input user-message item lifecycle is
   not misclassified as assistant/tool output or turn completion.
4. Command/file approvals and user-input requests pause the same Nevo turn, correlate by
   neutral IDs, send a response to the original JSON-RPC server request, and continue
   until the real Codex terminal notification.
5. Cancellation works while executing and while waiting for user input, invoking
   `turn/interrupt` and producing exactly one failed/cancelled Nevo terminal event.
6. Initialization, resume, process, parsing, schema, correlation, and disposal failures
   fail closed and never become `turn.completed`.
7. Fake-process tests cover the required protocol boundary without live Codex calls; a
   generated-schema verifier checks the consumed contract when Codex is installed.
8. Existing Claude, Antigravity, mock, server/browser contract tests, dashboard build,
   spec validation, and documentation validation remain green.

## Verification strategy

```text
node --test tools/tests/ai-contracts.test.mjs tools/tests/ai-turn-runtime.test.mjs tools/tests/mock-ai-adapter.test.mjs
node --test tools/tests/codex-app-server-client.test.mjs
node --test tools/tests/codex-adapter.test.mjs
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
node tools/ai/verify-codex-schema.mjs
node tools/specs.mjs check
node tools/docs.mjs check
```

The schema verifier must support a strict flag that fails when Codex is unavailable;
ordinary offline test suites may report an explicit skip. A live authenticated smoke
test, if added, is opt-in and never part of the default verification commands.

## Documentation impact

Update `docs/development/ai-sessions.md` with Codex architecture, availability,
capabilities, process ownership, protocol/schema refresh command, and testing guidance.
ADR-0007 remains current and does not need superseding.

## Out of scope

- Codex SDK, cloud tasks, account/login management, model picker redesign, remote
  app-server transports, thread browsing/import/archive/fork/review, apps/plugins/MCP
  administration, and arbitrary app-server methods.
- Session-scoped approval grants or provider-specific approval buttons.
- A provider-neutral permission-policy abstraction separate from ASK/EDIT/AGENT, or
  remembered/session approval rules; FU-002 owns that follow-up.
- A new visual plan/TODO component or steering composer UX.
- Provider-neutral steering execution or normalized plan-update events; the first Codex
  adapter advertises both capabilities as false and `follow-ups.yaml` records the
  deferred work.
- Persisting Codex history or raw protocol payloads in Nevo.
- Redesigning generic session architecture beyond the gaps enumerated here.
- Changes to .NET packages under `src/` or `tests/NEvo.*/`.
