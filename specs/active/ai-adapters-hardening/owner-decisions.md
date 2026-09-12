# Owner decisions: AI adapters hardening

This document presents architectural decision option analyses for `ai-adapters-hardening` in accordance with `docs/ai/specification-workflow.md` § "Solution option analysis" and ADR-0003.

Per repository policy, the agent analyzes options, trade-offs, risks, and recommendations; the repository owner makes the final decision before implementation tasks are started. **None of the proposed target options are established architecture until explicitly approved by the repository owner.**

---

## Decision 1: Provider Model Catalog Strategy

### Current fact
- Nevo currently has zero model catalog exposure. Provider descriptors contain only top-level booleans and execution modes (`ask`, `edit`, `agent`).
- `agy` natively supports authoritative dynamic discovery via `agy models`, outputting local IDs (e.g., `gemini-3.8-flash-high`) and display labels.
- `claude` accepts `--model <model>`, but has no CLI command to discover or enumerate models.
- `codex` accepts `-m, --model <MODEL>` on CLI and `model` on app-server `thread/start`, but has no CLI or RPC discovery endpoint.
- Neither Claude nor Codex integration can authoritatively enumerate all models available to the current user/account.

### Distinction of model classifications
To avoid treating a static list as authoritative availability or breaking when new models appear, the contract distinguishes:
1. **Authoritative discovered models**: Dynamically queried directly from the provider CLI at runtime (supported by Antigravity via `agy models`).
2. **Configured / operator models**: Explicitly declared by the workstation operator in `.nevo-ai-local/ai-providers.yaml`.
3. **Known / recommended model metadata**: Curated advisory metadata (display labels, known traits) shipped with Nevo documentation or provider baselines.
4. **Provider default (omitted override)**: Omitting the model flag / parameter entirely to let the provider CLI or daemon select its native default, rather than hardcoding a named model as Nevo's default without authoritative evidence.

### Validation behavior for incomplete catalogs
- A stale static baseline must **NOT** cause a valid provider model to be rejected merely because Nevo does not know it.
- A statically known model must **NOT** imply that it is actually available to the current account (e.g. tier restrictions, fine-tunes).
- Validation must be open and permissive: unknown model identifiers pass through to the provider CLI with a warning rather than failing fast with an error.

### Options

#### Option A: Closed static catalog (Strict validation)
Each provider adapter hardcodes a static list of supported models. If a requested model is not in the list, turn validation rejects it.
- **Implementation cost**: S (Low).
- **Reliability**: High for known models, zero probe overhead.
- **Compatibility risk**: High when providers release new models; rejects valid models until Nevo code is updated.
- **Stale-data risk**: Very High.
- **Unlocks**: Immediate UI model picker with fixed labels.
- **Forecloses**: Using newly released models without code updates; ignores native discovery on Antigravity.

#### Option B: Dynamic-only discovery
Provider adapters query the underlying CLI at runtime to discover available models.
- **Implementation cost**: M (Moderate).
- **Reliability**: Poor for Claude and Codex where discovery subcommands do not exist.
- **Compatibility risk**: Very High (would require making direct external Anthropic/OpenAI API calls, violating local CLI encapsulation).
- **Stale-data risk**: Very Low for Antigravity.
- **Unlocks**: Live account-accurate model lists where CLIs support it.
- **Forecloses**: Offline or discovery-less provider usage.

#### Option C: Open hybrid model catalog with passthrough validation (Proposed Target)
Define a normalized model descriptor contract (`AgentModelDescriptor`).
- Antigravity dynamically queries `agy models` (cached with 5-minute TTL).
- Claude and Codex supply curated baseline metadata for well-known models plus operator additions in `ai-providers.yaml`.
- If no model is specified, Nevo **omits the model override**, letting the provider use its native default.
- If a requested model is not in the known catalog, Nevo passes it through to the CLI rather than rejecting it, allowing user-specified flags to work immediately.
- **Implementation cost**: M (Moderate).
- **Reliability**: High (static fallback guarantees models are available; probe timeout does not break turn execution).
- **Compatibility risk**: Low (respects each CLI's actual transport capabilities).
- **Stale-data risk**: Low (Antigravity is dynamic; Claude/Codex accept operator config and unlisted passthrough).
- **Unlocks**: UI model picker, custom fine-tune support, zero false-rejections on new model releases.
- **Forecloses**: Nothing.

### Recommendation
**Adopt Option C (Open Hybrid)**.
*Status: OWNER DECISION REQUIRED.*

---

## Decision 2: Model Selection Scope

### Current fact
- **Codex app-server**: Protocol v2 accepts `model` and `modelProvider` in `v2/ThreadStartParams.json` (`thread/start`). Resuming an existing thread via `v2/ThreadResumeParams.json` (`thread/resume`) restores the thread and returns its established `{ model, modelProvider }`. The turn execution endpoint `v2/TurnStartParams.json` (`turn/start`) accepts only `{ input, threadId }` — it does **NOT** accept a model parameter. Codex binds the model to the thread/session lifetime.
- **Claude Code CLI**: `claude -p` accepts `--model <model>`. When resuming an existing session with `--resume <uuid>`, passing `--model <model>` on the command line is technically accepted by the CLI parser, but Claude documentation notes that session context is preserved from earlier turns and mid-session model switching can cause context fragmentation or tokenizer mismatch.
- **Antigravity CLI**: `agy` accepts `--model <model>`. When resuming via `--conversation <id>`, `--model <model>` can be passed on each invocation.

### Options

#### Option A: Session-scoped model selection
The model is selected at session creation time (`createSession({ model })`) and stored in session metadata. All subsequent turns in that session execute with that model. Individual turns cannot override the model.
- **Implementation cost**: S (Low).
- **Protocol alignment**: 100% compliant with Codex app-server `ThreadStartParams` and Claude session invariants.
- **Reliability**: High. Session history and token context remain consistent.
- **Unlocks**: Predictable multi-turn conversations without mid-session capability mismatches.
- **Forecloses**: Switching to a cheaper or faster model for an individual turn within the same session.

#### Option B: Turn-scoped model selection with session default
Every turn request can optionally specify a `model`. If omitted, it falls back to the session model.
- **Implementation cost**: M (Moderate).
- **Protocol alignment**: Incompatible with Codex app-server v2 protocol without tearing down and recreating the thread or creating a child thread.
- **Reliability**: Fragile for Codex. Mid-session model switches could corrupt Claude context.
- **Unlocks**: Turn-by-turn flexibility where provider CLI supports it.
- **Forecloses**: Clean provider-neutral contract across all three providers.

#### Option C: Capability-governed model selection scope (Proposed Target)
The neutral session contract binds the default model at session creation. An adapter capability (`canOverrideTurnModel: boolean`) indicates whether individual turns may switch models. For Codex, `canOverrideTurnModel` is `false`; for Antigravity, it is `true`. If a caller attempts a turn override on a provider with `canOverrideTurnModel: false`, the runtime rejects the turn with `CapabilityNotSupportedError`.
- **Implementation cost**: S-M.
- **Protocol alignment**: Respects actual provider protocol boundaries without lowest-common-denominator compromise.
- **Reliability**: High.
- **Unlocks**: Session-level stability for Codex while allowing turn-level flexibility where natively supported.
- **Forecloses**: Uniform turn-level overrides across all providers.

### Recommendation
**Adopt Option A as base, or Option C if turn-level overrides are required for Antigravity**.
*Status: OWNER DECISION REQUIRED.*

---

## Decision 3: Interaction Contract & Headless Adapter Policy

### Current fact
- Codex supports bidirectional interactive questions (`item/tool/requestUserInput`) and tool approvals over stdio JSON-RPC.
- Claude supports interactive questions via an in-process Fastify HTTP MCP bridge (`/mcp` + `ask_user`), but does not support mid-turn interactive permissions.
- Antigravity operates headlessly (`--output-format stream-json --print <message>`) and auto-skips questions in print mode; `respondInteraction()` unconditionally throws `CapabilityNotSupportedError`.
- The current contract defines `resumePolicy: 'restart' | 'live-operation'`:
  - `'live-operation'`: Interaction is tied to an in-memory live process or connection (e.g. Codex JSON-RPC or live MCP). If the server restarts ungracefully, the live connection is lost; boot reconciliation marks the interaction and turn `interrupted`.
  - `'restart'`: Interaction can be answered across server restarts by re-launching the provider with saved continuation state.

### Options

#### Option A: Strict fail-closed capability boundary
Maintain honest capabilities on provider descriptors: `interactiveQuestions: true` only for Codex and Claude (with MCP); `interactivePermissions: true` only for Codex; Antigravity is `false` for both. If a model asks a question on Antigravity, it is not captured as an interaction.
- **Implementation cost**: XS.
- **Reliability**: Very High.
- **Unlocks**: Deterministic execution; no hung turns.
- **Forecloses**: Handling questions gracefully when models ask them in plain text on Antigravity.

#### Option B: Unified MCP bridge across all CLI providers
Configure Antigravity to load an MCP server exposing `ask_user`, mirroring Claude.
- **Implementation cost**: L. Requires configuring `agy mcp` and verifying whether `agy` print mode supports blocking on MCP tools.
- **Reliability**: Low/Unverified. Antigravity print mode currently auto-skips or times out on blocking tools.
- **Compatibility risk**: High.
- **Unlocks**: Uniform interaction transport.
- **Forecloses**: Simple isolated process execution for Antigravity.

#### Option C: Canonical structured contract with composer fallback for terminal textual questions (Proposed Target)
Retain honest capabilities (`interactiveQuestions: false` on Antigravity). Keep interaction contracts (`question`, `permission`, `confirmation`) strictly structured with `resumePolicy: 'restart' | 'live-operation'`.
If a model outputs a conversational question at the end of a turn without an evidenced structured interaction, it settles as a normal completed turn with `finalAnswer`. The user answers by typing into the composer, initiating a new Turn. The runtime and UI must NEVER fabricate synthetic interaction work items via regex or text scraping.
- **Implementation cost**: S.
- **Reliability**: High.
- **Unlocks**: Consistent user experience across interactive and headless providers without fragile text heuristics.
- **Forecloses**: Synthetic mid-turn pause on headless providers.

### Recommendation
**Adopt Option C**.
*Status: OWNER DECISION REQUIRED.*

---

## Decision 4: Capability Ownership & Decoupling

### Current fact
- `AGENT_CAPABILITIES` in `contracts.mjs` is a flat list of 10 booleans:
  `interactivePermissions`, `interactiveQuestions`, `interactiveConfirmations`, `resumeSession`, `cancelTurn`, `toolCalls`, `reasoning`, `usage`, `steerTurn`, `planUpdates`.
- This mixes transport/integration capabilities (what Nevo's adapter can stream and control) with model traits (what model weights support).
- There is confusion between provider `toolCalls` and model `toolCalling`, and moving `reasoning` directly from provider to model breaks existing transport checks.

### Conceptual separation
1. **Transport / integration capabilities** (Provider level):
   - Can stream reasoning events (`reasoning.delta`)
   - Can emit structured tool invocations (`tool.*`)
   - Can report token usage and cost (`usage.updated`)
   - Can perform structured mid-turn interactions (`interactiveQuestions`, `interactivePermissions`, `interactiveConfirmations`)
   - Can resume sessions (`resumeSession`)
   - Can cancel active turns (`cancelTurn`)
2. **Model traits** (Model descriptor level):
   - Supports extended reasoning / chain-of-thought
   - Supports configurable reasoning effort (`low`, `medium`, `high`)
   - Supports multimodal vision input
   - Maximum input context token limits
3. **Effective turn behavior**:
   - The runtime derives effective capabilities from the combination of both: reasoning events are emitted only if the provider transport can stream them **AND** the active model supports reasoning.
   - The provider `toolCalls` capability remains the sole canonical flag for tool calling support; redundant flags like `toolCalling` on the model are eliminated unless defined as an explicit model trait distinct from transport.

### Options

#### Option A: Monolithic provider capabilities (Status quo)
Keep all capabilities on `AgentProviderDescriptor.capabilities`. Do not add model-level capabilities.
- **Implementation cost**: None.
- **Reliability**: Moderate. Cannot express that Claude 3.7 supports reasoning effort while Claude 3.5 does not.
- **Forecloses**: Model-specific UI controls (e.g. reasoning effort picker).

#### Option B: Move inference capabilities entirely to model descriptor
Remove `reasoning` from provider capabilities; put it exclusively on `AgentModelDescriptor`.
- **Implementation cost**: M.
- **Reliability**: Low. If an adapter cannot stream reasoning events from the CLI transport, declaring that a model supports reasoning does not allow Nevo to display it.
- **Forecloses**: Checking whether the transport actually supports reasoning.

#### Option C: Decoupled two-tier capability model (Proposed Target)
Retain transport capabilities on `AgentProviderDescriptor.capabilities` (including `reasoningEvents: boolean`, `toolCalls: boolean`, `usage: boolean`). Define semantic model traits on `AgentModelDescriptor.traits` (including `supportsReasoning?: boolean`, `supportsReasoningEffort?: boolean`, `supportsVision?: boolean`, `contextTokens?: number`).
The effective turn capability is evaluated by the runtime as `transport.reasoningEvents && model.supportsReasoning`.
- **Implementation cost**: S-M.
- **Reliability**: High. Preserves transport truth while unlocking model-specific UI controls.
- **Unlocks**: Reasoning effort picker for Claude 3.7 and Gemini 2.0 Flash Thinking, without breaking Claude 3.5.
- **Forecloses**: Ambiguous duplicate flags.

### Recommendation
**Adopt Option C**.
*Status: OWNER DECISION REQUIRED.*

---

## Decision 5: Public vs Internal Event Vocabulary & Output Semantics

### Current fact
- The public `AgentEvent` contract in `contracts.mjs` defines:
  `turn.started`, `turn.updated`, `message.started`, `text.delta`, `progress.delta`, `reasoning.delta`, `tool.started`, `tool.updated`, `tool.completed`, `interaction.requested`, `interaction.resolved`, `usage.updated`, `turn.completed`, `turn.failed`.
- The runtime uses internal semantic names: `final_answer.delta`, `commentary.delta`.
- Provider protocols emit their own private events (Codex `agentMessage` with `phase: commentary | final_answer`; Claude `content_block_delta`; Antigravity `step_update.thought` / `assistant`).
- Conflating these layers creates confusion about whether `final_answer.delta` or `text.delta` is the public API.

### Four explicit event layers
1. **Provider-specific protocol events**: Private bytes, JSON-RPC, or NDJSON streamed from the CLI or daemon.
2. **Internal runtime semantic events**: Dispatched inside the adapter/runtime pipeline (`final_answer.delta`, `commentary.delta`, `tool_update`).
3. **Public `AgentEvent` events**: Sanitized, sequenced stream sent to the browser over SSE (`text.delta`, `progress.delta`, `reasoning.delta`, `tool.*`, `interaction.*`, `usage.updated`, `turn.*`).
4. **`CanonicalTurn` projection**: Durable, queryable turn state (`turn.work: WorkItem[]`, `turn.finalAnswer: FinalAnswer | null`, `turn.status: TurnStatus`, `turn.terminalOutcome`).

### UI rendering targets
UI surfaces are described semantically rather than referencing concrete component names:
- Authoritative conversational response (`text.delta` / `turn.finalAnswer`) -> Chat bubble surface.
- Execution commentary & progress (`progress.delta` / `WorkItem(type: 'commentary')`) -> Activity log / work stream card.
- Model chain-of-thought (`reasoning.delta` / `WorkItem(type: 'reasoning')`) -> Collapsible reasoning disclosure container.
- Tool lifecycle (`tool.*` / `WorkItem(type: 'tool')`) -> Tool invocation display card.
- User input requests (`interaction.*` / `WorkItem(type: 'interaction')`) -> Interactive prompt panel.

### Options

#### Option A: Flatten all layers into public `AgentEvent`
Force adapters and runtime to use only the existing public `AgentEvent` types (`text.delta`, `progress.delta`), eliminating internal semantic names.
- **Implementation cost**: S.
- **Reliability**: Moderate. Loses semantic clarity on whether a `text.delta` is conversational final answer or execution commentary.

#### Option B: Strict multi-layer pipeline (Proposed Target)
Maintain the four explicit layers: Provider Protocol -> Internal Semantic (`final_answer.delta`, `commentary.delta`) -> Public `AgentEvent` (`text.delta` for final answer, `progress.delta` for commentary) -> Canonical Turn Projection (`finalAnswer` vs `WorkItem`).
- **Implementation cost**: S. Clarifies existing code without breaking public contracts.
- **Reliability**: Very High.
- **Unlocks**: Clean separation between internal orchestration and public API contracts.
- **Forecloses**: Leaking provider-private event types to the frontend.

### Recommendation
**Adopt Option B**.
*Status: OWNER DECISION REQUIRED.*

---

## Decision 6: Error & Failure Taxonomy vs Terminal Outcomes

### Current fact
- `CanonicalTurn` defines four immutable terminal outcomes in `turn-status.mjs`:
  `completed`, `failed`, `cancelled`, `interrupted`.
- `TurnStatus` also includes a non-terminal `unknown` status (`{ status: 'unknown', reason, since, source }`).
- Currently, diverse failures (invalid credentials, rate limiting, quota exhaustion, network drops, CLI exit 1, and process crashes) collapse into generic `AI_PROVIDER_ERROR` or `AI_PROVIDER_EXIT_ERROR` (HTTP 502).
- Cancellation (`cancelled`) and server restart (`interrupted`) are not errors; treating them as errors breaks clean lifecycle semantics.

### Conceptual separation
1. **Terminal Outcome**: Lifecycle resolution (`completed`, `failed`, `cancelled`, `interrupted`).
2. **Normalized Failure / Reason Code**: Categorical diagnostic identifier:
   - Identity & Security: `AI_AUTH_FAILED` (401), `AI_POLICY_DENIED` (403)
   - Capacity: `AI_RATE_LIMITED` (429), `AI_QUOTA_EXHAUSTED` (429)
   - Availability & Transport: `AI_PROVIDER_UNAVAILABLE` (503), `AI_TRANSPORT_ERROR` (502)
   - Timeouts: `AI_PROVIDER_TIMEOUT` (504), `AI_RUNTIME_TIMEOUT` (504)
   - Protocol & Execution: `AI_PROTOCOL_ERROR` (502), `AI_UNSUPPORTED_OPERATION` (409), `AI_PROVIDER_EXECUTION_ERROR` (502)
   - Unknown State: `AI_OPERATION_LOST` (500)
3. **Structured Recovery Hint**: Replaces simplistic `retryable: boolean` with actionable hints:
   - `'none'`: Unrecoverable; do not retry.
   - `'retry-after-delay'`: Transient; retry after backoff (uses `suggestedDelayMs`).
   - `'new-turn'`: Previous turn failed cleanly; user or agent may submit a new turn in the same session.
   - `'new-session'`: Session state corrupted; must create a fresh session.
   - `'operator-action'`: Requires human intervention (e.g. login CLI, update config, grant permissions).
   - `'alternate-provider'`: Quota or model unavailable; failover to another provider.

### Options

#### Option A: Coarse status quo (Binary retryable)
Retain `AI_PROVIDER_ERROR` (502) with unstructured error strings and `retryable: boolean`.
- **Implementation cost**: None.
- **Reliability**: Poor for automation; requires fragile string regex.
- **Forecloses**: Deterministic automated retry, fallback, and quota management.

#### Option B: Fully separated outcome + discriminated taxonomy + neutral recovery hints (Proposed Target)
Decouple terminal outcome from failure code. Define the 12 normalized failure codes above. Include structured recovery metadata (`recoveryHint`, `suggestedDelayMs`, `source`). Expose deterministic facts without embedding complex orchestration policy in the adapter.
- **Implementation cost**: M.
- **Reliability**: Very High.
- **Unlocks**: Intelligent retry supervisors, accurate UI error alerts, quota-aware routing.
- **Forecloses**: Ambiguous 502 errors.

### Recommendation
**Adopt Option B**.
*Status: OWNER DECISION REQUIRED.*

---

## Decision 7: Lost / Unknown Operation Semantics

### Current fact
- A provider operation may reach a state where its outcome cannot be authoritatively proven:
  - The provider child process disappeared without an exit event or error.
  - The stdio pipe closed unexpectedly.
  - Codex app-server JSON-RPC connection dropped during an in-flight turn.
- In this state, the operation may have failed, completed without flushing, or may **still be running in the background**.
- The canonical turn model in `turn-status.mjs` already contains a dedicated status: `status: 'unknown'`.
- Currently, adapters often collapse this state into `terminal (outcome: 'failed')` with `AI_PROVIDER_ERROR`.

### Epistemic truth invariant
The contract must preserve epistemic truth: **unknown means unknown**.
Nevo must never claim `failed`, `cancelled`, or `completed` unless authoritative evidence exists.

### Options

#### Option A: Pessimistic failure (Collapse unknown to failed)
When an operation handle is lost or unproven, transition the turn immediately to `status: 'terminal' (outcome: 'failed')` with code `AI_OPERATION_LOST`.
- **Implementation cost**: S.
- **Reliability**: Epistemically false. If the process is still mutating the workspace or completes in the background, Nevo reports a false failure.
- **Forecloses**: Reconciling or recovering the turn.

#### Option B: Epistemic truth preservation (Status 'unknown') (Proposed Target)
When an operation handle is lost and the provider cannot prove completion or exit:
1. Transition turn status to `status: 'unknown'` with `reason: 'operation_lost'` and diagnostic code `AI_OPERATION_LOST`.
2. Do **NOT** set `terminalOutcome`. The turn is not terminal until reconciled.
3. The runtime schedules a bounded verification check:
   - If the process is confirmed dead with no output: settles as `terminal (outcome: 'failed', cause: 'process_disappeared')`.
   - If a background write is detected or subsequent turn checks show completion: reconciles state.
   - If state remains unproven after the watchdog timeout elapses: seals as `terminal (outcome: 'interrupted', cause: 'unproven_state')`.
- **Implementation cost**: M.
- **Reliability**: High. Truthful representation in UI and logs.
- **Unlocks**: Preventing race conditions where a user resubmits a prompt while an orphaned process is still modifying files.
- **Forecloses**: Blindly overwriting session state.

### Recommendation
**Adopt Option B**.
*Status: OWNER DECISION REQUIRED.*

---

## Decision 8: Antigravity Session Identity & Alias Store Convergence

### Current fact
- `AntigravityAgentProvider` allocates a provisional session UUID when a turn begins, but `agy` allocates its own internal conversation ID (e.g. `c_...`) upon launch.
- To handle resumption, Antigravity currently maintains a private `.nevo-ai-local/antigravity-sessions.json` alias file.
- Concurrently, `AgentSessionBindingService` maintains `.nevo-ai-local/sessions/<specId>.json`.
- This creates dual-state bookkeeping and desynchronization risks.

### Options

#### Option A: Retain private adapter alias file
Keep `antigravity-sessions.json` encapsulated inside `AntigravityAgentProvider`.
- **Implementation cost**: None.
- **Reliability**: Low. Risk of split-brain between binding service and adapter alias store.
- **Forecloses**: Uniform session alias management across providers.

#### Option B: Converge session aliasing into `AgentSessionBindingService` (Proposed Target)
Add first-class alias support to `AgentSessionBindingService`:
- `recordSessionAlias(provider, fromSessionId, toSessionId)` atomically updates bindings.
- When `setProviderSessionId(allocatedId)` is called, the binding service atomically records the alias in `.nevo-ai-local/sessions/`.
- Deprecate `antigravity-sessions.json`; migrate existing entries on startup and remove the file.
- **Implementation cost**: S.
- **Reliability**: High. Single source of truth with atomic writes.
- **Unlocks**: Clean architectural boundary; Antigravity adapter becomes stateless regarding session persistence.
- **Forecloses**: Ad-hoc provider alias file sprawl.

### Recommendation
**Adopt Option B**.
*Status: OWNER DECISION REQUIRED.*

---

## Decision 9: Child Process Lifecycle & Windows Process Tree Termination

### Current fact
- Claude and Antigravity spawn CLI child processes that frequently spawn compound tool subprocesses (compilers, `git`, `bash`, tests).
- On Windows, Node.js `child.kill('SIGINT')` or `child.kill('SIGKILL')` terminates only the immediate root child PID.
- Grandchild worker processes are NOT terminated and continue running orphaned, locking files and consuming CPU.

### Options

#### Option A: Standard Node.js `child.kill` (Status quo)
Keep current `terminateChildProcess` implementation.
- **Implementation cost**: None.
- **Reliability**: Poor on Windows during command execution.
- **Forecloses**: Clean cancellation guarantees.

#### Option B: OS-aware process tree termination (Proposed Target)
Harden `process-termination.mjs`:
- On Windows: Use `taskkill.exe /PID <pid> /T /F` or assign child to a Windows Job Object configured with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`.
- On POSIX: Spawn with `detached: true` and terminate process groups via `process.kill(-pid, signal)`.
- **Implementation cost**: S.
- **Reliability**: Very High. Guarantees no orphaned subprocess survives cancellation or timeout.
- **Unlocks**: Clean cancellation without file lock conflicts in Git workspaces.
- **Forecloses**: Process leaks.

### Recommendation
**Adopt Option B**.
*Status: OWNER DECISION REQUIRED.*

---

## Decision 10: Provider Availability vs Health Metadata Decoupling

### Current fact
- `AgentProviderDescriptor` has `enabled: boolean` and `available: boolean`.
- This conflates four distinct realities: operator configuration, executable installation, credential authentication, and transient operational health.
- Deriving global provider health from a single failed turn causes catastrophic false-negatives (e.g. a rate limit on one turn makes the entire provider appear uninstalled or unavailable in the UI).

### Decoupling invariants
1. **Stable facts**:
   - `enabled`: Workstation operator configuration in `ai-providers.yaml`.
   - `installed`: Binary discovered in host PATH or standard directories.
   - `version`: Discovered CLI version string.
2. **Transient observations**:
   - `authenticated`: Optional/unknown unless safely checkable without network blocking or side-effects.
   - `status`: `'healthy' | 'degraded' | 'unavailable'`.
3. **Isolation rule**:
   - A per-turn, per-model, or per-account rate limit (429) must **NOT** mark the entire provider as globally unavailable.

### Options

#### Option A: Keep binary booleans with `unavailableReason` string (Status quo)
Maintain `enabled` and `available`.
- **Implementation cost**: None.
- **Reliability**: Moderate.
- **Forecloses**: Granular UI diagnostics and intelligent routing.

#### Option B: Decoupled provider health descriptor (Proposed Target)
Extend `AgentProviderDescriptor` to separate configuration from health:
```typescript
interface ProviderHealth {
  enabled: boolean;                 // Operator allow-list
  installed: boolean;               // Binary discovered on host
  authenticated?: boolean;          // Only present if safely checkable
  status: 'healthy' | 'degraded' | 'unavailable';
  version?: string;
  unavailableReason?: string;
}
```
Availability probes remain lightweight (filesystem / `where.exe`, cached with 30s TTL). Transient turn errors never alter global provider `installed` or `enabled` flags.
- **Implementation cost**: S.
- **Reliability**: High.
- **Unlocks**: Precise UI badges ("Installed, not logged in", "Rate limited - backoff", "CLI missing") without false-positive lockouts.
- **Forecloses**: Conflating operator intent with transient failures.

### Recommendation
**Adopt Option B**.
*Status: OWNER DECISION REQUIRED.*
