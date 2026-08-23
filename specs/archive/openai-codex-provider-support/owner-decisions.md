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

## D5: Superseded steering and plan-update proposal

- **Question:** Should supported Codex steering and plan updates remain hidden because the current neutral contract lacks them?
- **Options considered:** omit both capabilities | encode them as unrelated text/tool events | add small neutral capability, service, event, and transport contracts
- **Decision:** Superseded by D8. The initial integration adds only the `steerTurn` and `planUpdates` discovery flags, reports both as false, and does not add steering execution or normalized plan-update events.
- **Rationale:** Post-research scoping showed that either operation crosses substantially more neutral runtime, transport, transcript, and frontend surface than the persistent Codex lifecycle requires.
- **Consequences:** No steering route/operation or `plan.updated` event belongs to this change. FU-001 owns any later provider-neutral design and implementation.
- **Date:** 2026-08-22
- **Affected artifacts:** `areas/provider-neutral-runtime.md`, tasks 01 and 03
- **Supersession:** Kept only as the audit trail for the option considered before D8; its original implementation direction is not current scope.

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

## D9: Distinguish restart-resumable interactions from live-operation interactions

- **Question:** How should the neutral runtime persist and reconcile interactions when some providers can reconstruct a continuation after restart while a persistent connection provider cannot reconstruct an outstanding server request?
- **Options considered:** treat every pending interaction as restart-resumable | add provider-specific restart branches | add one neutral interaction resume policy
- **Decision:** Every normalized interaction carries `resumePolicy: restart | live-operation`. `restart` is the compatibility default for deferred providers whose continuation can be reconstructed by a fresh invocation. `live-operation` requires the original in-memory provider operation and connection.
- **Rationale:** Codex server requests are correlated to a single live app-server request/response function. Persisting the normalized prompt is useful for browser reconnects, but neither `thread/resume` nor a fresh adapter reconstructs that outstanding request.
- **Consequences:** Codex approvals/questions use `live-operation`. Browser reconnects within the owning process continue to work. Boot reconciliation and graceful shutdown terminalize stale live-operation turns and remove their pending interaction before the adapter disappears; restart-resumable deferred interactions retain their existing reconstruction path. No Codex request ID or wire payload enters neutral persistence or browser contracts.
- **Date:** 2026-08-23
- **Affected artifacts:** `areas/provider-neutral-runtime.md`, `areas/codex-adapter.md`, tasks 01 and 03, `docs/development/ai-sessions.md`, `docs/decisions/ADR-0007-provider-neutral-ai-sessions.md`

## D10: Preserve final-answer, commentary, and reasoning semantics

- **Question:** How should Codex assistant output phases map into Nevo without presenting execution narration or reasoning as the final chat response?
- **Options considered:** flatten every `agentMessage` into assistant text | treat commentary as reasoning | add one neutral progress event while preserving the existing final-text and reasoning channels
- **Decision:** `agentMessage.phase=final_answer` maps to `message.started` plus `text.delta`; `phase=commentary` maps to the additive provider-neutral `progress.delta`; reasoning items remain `reasoning.delta`. No commentary or reasoning text is concatenated into final assistant text.
- **Rationale:** The Codex 0.149.0 generated contract and official app-server protocol expose optional `agentMessage.phase` values `commentary` and `final_answer`, while agent-message delta notifications carry only `itemId` and `delta`. The adapter must therefore retain phase on the private item correlation and route each delta through the matching neutral channel.
- **Consequences:** When phase is absent, the adapter buffers that message until classification is safe. A completed unphased message superseded by later consumed work becomes progress; if no explicit final answer exists, the last remaining completed unphased message becomes the legacy final-answer fallback. An unsupported non-null phase or conflicting started/completed phases fails closed. `progress.delta` is ordered neutral turn activity and is deliberately not projected into the main assistant transcript. The schema verifier locks the optional phase enum without vendoring the generated bundle. Reasoning effort remains provider/model configuration and is not lowered by this mapping.
- **Date:** 2026-08-23
- **Affected artifacts:** `overview.md`, `areas/provider-neutral-runtime.md`, `areas/codex-adapter.md`, tasks 01 and 03, `docs/development/ai-sessions.md`, `tools/ai/codex-protocol-baseline.json`

## D11: Keep AGENT workspace-sandboxed but escalation-capable

- **Question:** How should the initial Codex AGENT mode run repository implementation workflows when Windows workspace sandboxing blocks required host tools or Git metadata?
- **Options considered:** keep `workspace-write` with `approvalPolicy: never` | default AGENT to unrestricted access without prompts | keep `workspace-write` and allow native approval requests on escalation
- **Decision:** AGENT uses the generated 0.149.0 policy fields `approvalPolicy: on-request` at thread/resume and turn level, legacy thread `sandbox: workspace-write`, and turn `sandboxPolicy.type: workspaceWrite`. ASK remains read-only/never; EDIT remains workspace-write/on-request.
- **Rationale:** `never` prevents Codex from emitting the approval request needed when the Windows sandbox blocks host-installed Node/npm/Codex binaries or protected `.git` metadata. Default unrestricted access would remove the human security gate. The selected policy preserves normal autonomous workspace work and exposes only blocked operations through the existing live permission interaction.
- **Consequences:** Command, file-change, and permission-subset approval requests retain private app-server correlation and `resumePolicy: live-operation`. Allow/deny answers go to the original request and the same turn continues according to Codex behavior. Current explicitly requested Git add/commit/push workflows are not categorically rejected; they may proceed after native approval. FU-002 owns a later provider-neutral separation of execution mode from permission policy and remembered/session approval rules.
- **Date:** 2026-08-23
- **Affected artifacts:** `overview.md`, `areas/codex-adapter.md`, task 03, `follow-ups.yaml`, `docs/development/ai-sessions.md`
