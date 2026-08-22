# Owner decisions: OpenAI Codex provider support

## D1: Use the native Codex app-server protocol

- **Question:** Should Nevo integrate Codex through its persistent app-server protocol or emulate the per-turn Claude CLI process model?
- **Options considered:** a persistent `codex app-server` JSON-RPC client and provider adapter | per-turn Codex CLI invocations shaped like the Claude adapter | Codex SDK/non-interactive execution
- **Decision:** Use the official `codex app-server` protocol through a small persistent JSON-RPC client and a separate Codex provider adapter; do not pretend Codex behaves like Claude CLI.
- **Rationale:** The owner explicitly required preservation of Codex threads, turns, streamed items, server requests, interruption, usage, reasoning, and authoritative completion/failure semantics.
- **Consequences:** Provider-specific wire details stay in `tools/ai/codex-*.mjs`; generic runtime code receives only normalized identities, events, interactions, and capabilities.
- **Date:** 2026-08-22
- **Affected artifacts:** `overview.md`, all areas and tasks

## D2: Codex thread ID is the provider session ID

- **Question:** Which identity represents a Codex conversation in Nevo?
- **Options considered:** Codex `thread.id` directly | a Nevo-generated alias mapped to `thread.id` | Codex `thread.sessionId`
- **Decision:** Use the Codex `thread.id` directly as `providerSessionId`; do not create another Nevo-owned ID for Codex. Treat `thread.sessionId` as provider metadata, not Nevo identity.
- **Rationale:** The owner explicitly required provider-owned session identity and deterministic resume behavior. The official protocol resumes stored conversations by `thread.id`; forked threads can share a different session-tree root.
- **Consequences:** Blank-session creation must call a provider-neutral optional session-creation seam so Codex can materialize a real thread before Nevo writes a binding. `thread/resume` must use the recorded `thread.id` after process restart.
- **Date:** 2026-08-22
- **Affected artifacts:** `areas/provider-neutral-runtime.md`, `areas/codex-adapter.md`, tasks 01 and 03

## D3: Make only the provider-neutral extensions Codex proves necessary

- **Question:** How far may this change extend the shared runtime and browser contracts?
- **Options considered:** Codex-specific branches in generic code | minimal provider-neutral lifecycle/capability extensions | redesign the whole session runtime
- **Decision:** Add only neutral seams needed by a persistent bidirectional provider: provider-allocated session creation, asynchronous interaction continuation, provider cancellation while waiting for input, and adapter disposal. Per D8, add steering/plan capability flags only so support is reported honestly; do not add their operations/events or Codex wire types/request IDs to shared or browser contracts.
- **Rationale:** The owner requested Codex as a validation of the existing abstraction while forbidding a generic runtime or dashboard redesign.
- **Consequences:** Existing Claude, Antigravity, and mock behavior remains compatible; their descriptors and the first Codex adapter explicitly report unsupported steering/plan capabilities. No steering route, plan event, transcript expansion, or visual UI is part of this change.
- **Date:** 2026-08-22
- **Affected artifacts:** `areas/provider-neutral-runtime.md`, task 01

## D4: Preserve interactive behavior through safe neutral responses

- **Question:** How should richer Codex approval and question decisions map to Nevo's current normalized interactions?
- **Options considered:** expose raw Codex choices in browser payloads | add a full new approval UX | map the current allow/deny and answers contract to the safest turn-scoped Codex decisions
- **Decision:** Reuse neutral permission and question interactions. Map allow to a turn-scoped acceptance (or the requested permission subset for the current turn), deny to decline/empty grant, and question answers by stable neutral question IDs. Do not expose `acceptForSession`, raw JSON-RPC IDs, or Codex request payloads until a separate neutral UX decision explicitly supports them.
- **Rationale:** The owner required approvals and user questions but excluded dashboard UX redesign and Codex-specific dashboard contracts.
- **Consequences:** Codex remains interactive and fail-closed. Persistent grants and provider-specific decision variants are out of scope rather than silently guessed.
- **Date:** 2026-08-22
- **Affected artifacts:** `areas/codex-adapter.md`, task 03

## D5: Expose steering and plans without redesigning the chat UI

- **Question:** Should supported Codex steering and plan updates remain hidden because the current neutral contract lacks them?
- **Options considered:** omit both capabilities | encode them as unrelated text/tool events | add small neutral capability, service, event, and transport contracts
- **Decision:** Add `steerTurn` and `planUpdates` to the capability model, a provider-neutral active-turn steering operation, and a normalized `plan.updated` event. Transport and persist the normalized data, but do not add a new visual component or change composer behavior in this change.
- **Rationale:** The owner explicitly asked the spec to validate capabilities such as steering and plan updates and to avoid fabricating provider events.
- **Consequences:** Codex may declare both capabilities true after tests prove the mappings; existing providers declare them false. A later UX change can consume the neutral contracts without changing Codex integration.
- **Date:** 2026-08-22
- **Affected artifacts:** `areas/provider-neutral-runtime.md`, tasks 01 and 03
- **Supersession:** Kept for the audit trail; D8 is authoritative for initial implementation scope.

## D6: Validate against generated Codex schemas without vendoring the full protocol

- **Question:** How should Nevo keep its narrow app-server contract aligned with the installed Codex version?
- **Options considered:** maintain a large handwritten protocol copy | commit the entire generated schema bundle | keep a narrow client plus a small generated compatibility baseline and verifier
- **Decision:** Implement only the methods and notifications consumed by the adapter, keep compact protocol fixtures, and add a verifier that generates the current JSON Schema bundle into an OS temporary directory and checks the consumed contract. Commit only a small compatibility baseline (Codex version plus consumed method/type inventory), not the full generated bundle.
- **Rationale:** The owner explicitly preferred deriving or validating contracts against the official protocol and avoiding a large handwritten copy.
- **Consequences:** Normal tests remain offline and deterministic. Schema verification reports an explicit skip when Codex is unavailable and supports a strict mode for implementation/release verification. No new npm dependency is introduced.
- **Date:** 2026-08-22
- **Affected artifacts:** `areas/app-server-client.md`, task 02

## D7: One lazily started app-server process per adapter instance

- **Question:** Who owns the persistent Codex process and how is it cleaned up?
- **Options considered:** one process per turn | one process per session | one multiplexed process per Codex adapter/dashboard service instance
- **Decision:** The Codex adapter owns one lazily started, initialized app-server client per adapter instance. The client multiplexes threads, turns, requests, notifications, and server requests by explicit IDs. Runtime/service shutdown disposes it once and fails all active work closed.
- **Rationale:** This matches the official persistent protocol while keeping process state provider-private and bounded by the dashboard service lifecycle.
- **Consequences:** Request correlation may never depend on array position or arrival order. Unexpected exit, malformed messages, unknown response IDs, failed initialization, and disposal with active work reject pending operations and must never produce Nevo success.
- **Date:** 2026-08-22
- **Affected artifacts:** `areas/app-server-client.md`, `areas/codex-adapter.md`, tasks 02 and 03

## D8: Defer steering and plan-update implementation from the first adapter

- **Question:** Must the first Codex provider implement `turn/steer` and plan updates, or may it ship the required persistent provider lifecycle first?
- **Options considered:** implement steering plus normalized plan events end to end now | omit both capabilities entirely | add honest capability flags now, report both false, and defer their operations/events as an explicit follow-up
- **Decision:** Add `steerTurn` and `planUpdates` to the neutral capability descriptor only, with false defaults. The first Codex adapter declares both false and does not implement `turn/steer`, plan events, related HTTP controls, transcript projection, or frontend behavior. Record the missing optional capabilities as a non-blocking follow-up.
- **Rationale:** Current-code inspection found that steering crosses registry, runtime, service, HTTP, and transcript behavior, while plan updates add a new validated/replayed event through runtime, transcript, server, and frontend contracts. Those are useful but not required to host Codex correctly. The two descriptor flags themselves are a small, honest discovery surface and avoid claiming support that the adapter does not provide.
- **Consequences:** Provider-created identity, persistent interaction continuation, waiting cancellation, disposal, thread/turn execution, approvals/questions, normalized messages/tools/reasoning/usage, and completion/failure remain mandatory. `turn/steer` and plan notifications are outside the consumed protocol inventory for the first adapter; well-formed occurrences are ignored. Follow-up FU-001 owns future neutral design and implementation.
- **Date:** 2026-08-22
- **Affected artifacts:** `overview.md`, `areas/provider-neutral-runtime.md`, `areas/app-server-client.md`, `areas/codex-adapter.md`, tasks 01-03, `follow-ups.yaml`
