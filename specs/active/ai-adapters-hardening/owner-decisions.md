# Owner decisions: AI adapters hardening

This document records the official owner architectural decisions for `ai-adapters-hardening` in accordance with `docs/ai/specification-workflow.md` § "Solution option analysis" and ADR-0003.

Decisions D1, D2, D4, D5, D6, D7, D8, D9, and D10 have been reviewed with the repository owner and are **APPROVED** as the authoritative foundation for the target architecture and implementation task decomposition.

Decision D3 is **APPROVED** for OpenAI Codex (native stdio JSON-RPC) and Claude Code (in-process Fastify HTTP MCP bridge). The structured Ask capability for Google Antigravity is recorded with verified runtime and lifecycle findings and marked as an **OWNER BLOCKER REQUIRING CLARIFICATION**.

---

## D1: Model discovery and model catalog

### Verified facts
- **OpenAI Codex**: Codex app-server v2 protocol natively exposes `model/list` (returning `Model[]` with `id`, `displayName`, `description`, `isDefault`, `hidden`, `inputModalities`, `supportedReasoningEfforts`, `defaultReasoningEffort`, `serviceTiers`). Discovery is live and authoritative over stdio JSON-RPC.
- **Google Antigravity**: `agy` natively supports dynamic CLI discovery via `agy models`, returning a structured tabular list of available models and display names.
- **Claude Code**: `claude` CLI accepts `--model <model>`, but has no CLI discovery subcommand or RPC listing method (`claude models` is interpreted as an interactive prompt).
- **Core neutral invariant**: Unknown or newly released models must not be rejected merely because Nevo core does not know them.

### Owner decision
1. **Adapter-owned discovery**: Model discovery is strictly owned by each provider adapter. Nevo core exposes and consumes a neutral model catalog contract (`AgentModelDescriptor[]`), but Nevo core must **NOT** own a global hardcoded catalog of provider models.
2. **Best available source**: Each adapter obtains its model catalog from the best authoritative provider-specific source available:
   - Codex: Native `model/list` JSON-RPC query on `CodexAppServerClient`.
   - Antigravity: Dynamic CLI execution of `agy models` (cached with 5-minute TTL).
   - Claude: Curated baseline metadata + operator configuration in `ai-providers.yaml`, with open passthrough (unlisted models passed to `--model` without validation error).
3. **Permissive passthrough**: The catalog is non-restrictive. If a user or workflow requests a model identifier not in the local catalog, the adapter emits a trace warning but passes the identifier through to the provider CLI/daemon. The provider remains the sole authoritative arbiter of model availability.
4. **Model traits evidence rule**: Distinguish authoritatively discovered vs configured/advisory vs unknown traits. Global CLI flags (such as `agy --effort` or `claude --model`) are evidence of CLI invocation syntax, NOT per-model capability evidence. Model traits such as `supportedReasoningEfforts` must be left `undefined` (unknown) unless authoritatively reported per-model (e.g. Codex `model/list`) or configured by the operator in `ai-providers.yaml`.

*Status: APPROVED BY OWNER.*

---

## D2: Model selection and switching

### Verified facts
- **OpenAI Codex**: In protocol v2, `ThreadStartParams.model` sets the initial thread model. In addition, `TurnStartParams.model` explicitly supports: `"Override the model for this turn and subsequent turns."` and `TurnStartParams.effort` supports: `"Override the reasoning effort for this turn and subsequent turns."`. Codex app-server natively supports both session-level and mid-session turn-level model overrides.
- **Google Antigravity**: Accepts `--model <model>` on initial turns and when resuming an existing conversation via `--conversation <id>`. Antigravity natively supports turn-level model overrides.
- **Claude Code**: Accepts `--model <model>` on initial sessions and on resumed sessions (`--resume <uuid> --model <model>`).

### Owner decision
1. **Session-level persistence**: A session persists the current / last selected model in its binding metadata (`sessionBinding.model`).
2. **Capability-driven switching**: Nevo must **NOT** impose a global "session-only" or "turn-only" restriction. Instead, mid-session model switching is governed by an adapter capability: `canOverrideTurnModel: boolean`.
3. **Native support exposed**: If the provider integration supports changing the model inside an existing session (as verified for Codex, Antigravity, and Claude), expose that capability and allow it. If a provider does not support it, do not expose or emulate it.

*Status: APPROVED BY OWNER.*

---

## D3: User interactions and Ask contract

### Verified facts
- **OpenAI Codex**: Natively supports structured questions (`item/tool/requestUserInput`) and approvals (`item/commandExecution/requestApproval`, `fileChange/requestApproval`, `permissions/requestApproval`) over bidirectional stdio JSON-RPC.
- **Claude Code**: Supports structured questions via an in-process Fastify HTTP MCP bridge (`/mcp` + `ask_user` tool) configured via `--mcp-config`. Mid-turn permissions are not supported over MCP.
- **Google Antigravity**:
  - Live probe verification confirms that in headless print mode (`agy --print <prompt> --output-format stream-json`), `agy` *does* attempt to connect to registered MCP servers and invoke MCP tools.
  - However, `agy` CLI has **no** `--mcp-config` or `--mcp-server` command-line flag for ephemeral or per-invocation configuration.
  - MCP configuration is strictly machine-global, persisted in `~/.gemini/config/mcp_config.json` via `agy mcp add`.
  - `agy` provides no command-line flag or execution-time filter to restrict or select MCP servers per invocation. Every MCP server registered in `mcp_config.json` is contacted by every `agy` invocation across all projects and terminal sessions.
  - Global registration mutates the developer's permanent workstation configuration, causes port allocation and collision hazards across concurrent sessions, and risks leaving orphaned dead server entries in `mcp_config.json` if Nevo crashes or is terminated forcefully.
  - In headless print mode without MCP, `agy` auto-skips interactive prompts.

### Owner decision principles
1. **Neutral interaction model**: Nevo UI and runtime maintain one neutral structured interaction model (`question`, `permission`, `confirmation`).
2. **Transport selection hierarchy**:
   - Prefer native provider interaction mechanisms when one exists and maps cleanly (Codex stdio JSON-RPC).
   - Where native interaction is absent but the provider supports MCP safely and deterministically, provide a Nevo-owned MCP bridge (Claude Fastify MCP bridge).
   - Composer fallback is a fallback, not an automatic target: used when structured interaction cannot be safely provided.
3. **No text heuristics**: Do not use regular expressions or text scraping to pretend arbitrary final text is a structured interaction work item.

### Current status and owner clarification blocker
- **Codex stdio JSON-RPC**: APPROVED.
- **Claude Fastify MCP bridge**: APPROVED.
- **Antigravity structured Ask**: **BLOCKED: OWNER CLARIFICATION REQUIRED**.
  Because safe, isolated, ephemeral MCP configuration is not supported by the current `agy` CLI, three architectural options are presented for owner resolution:
  - **Option 1 (Composer fallback — Recommended)**: Declare `interactiveQuestions: false` for Antigravity. When a model outputs a conversational question at the end of a turn, it settles cleanly as `completed` with `finalAnswer`, allowing the user to reply via the composer in the subsequent turn. This avoids all machine-global configuration mutations, port collisions, and cleanup failure modes.
  - **Option 2 (Nevo-managed MCP with global registration hooks)**: Implement a Nevo-managed local MCP server registered via `agy mcp add` on adapter startup and removed on shutdown, with startup/shutdown synchronization and ungraceful exit recovery in `~/.gemini/config/mcp_config.json`. This introduces workstation-wide configuration mutation and cleanup fragility if Nevo is killed ungracefully.
  - **Option 3 (Await upstream ephemeral CLI flag)**: Defer Antigravity structured Ask support until upstream `agy` CLI introduces an ephemeral per-process flag (e.g. `--mcp-config <file>`). Until then, `interactiveQuestions` remains false.

*Status: Codex and Claude APPROVED; Antigravity Ask BLOCKED on owner clarification.*

---

## D4: Provider capabilities vs model capabilities

### Verified facts
- `contracts.mjs` currently defines a flat list of 10 booleans (`AGENT_CAPABILITIES`).
- Transport capabilities (e.g. streaming reasoning events, tool execution, session resume) are invariants of the adapter/CLI integration.
- Model traits (e.g. reasoning effort options, input modalities, context window) vary per model and must be grounded in per-model evidence. Codex app-server natively reports them per model via `model/list`. Antigravity CLI `agy models` reports only model ID and label; the presence of a global `--effort` CLI option is transport capability, not per-model trait evidence.

### Owner decision
1. **Adapter as normalization boundary**: The adapter normalizes both provider-level capabilities and model-level metadata into neutral contracts.
2. **Two distinct categories**:
   - **Provider / Integration Capabilities** (`ProviderCapabilities` on `AgentProviderDescriptor`):
     - `resumeSession: boolean`
     - `cancelTurn: boolean`
     - `canOverrideTurnModel: boolean`
     - `interactiveQuestions: boolean`
     - `interactivePermissions: boolean`
     - `interactiveConfirmations: boolean`
     - `toolCalls: boolean` (sole authoritative flag for tool calling transport; redundant `toolCalling` on model eliminated)
     - `reasoningEvents: boolean` (transport ability to capture and stream `reasoning.delta`)
     - `usage: boolean`
     - `steerTurn: boolean`
     - `planUpdates: boolean`
   - **Model-Specific Traits / Metadata** (`ModelTraits` on `AgentModelDescriptor`):
     - `supportsReasoning?: boolean`
     - `supportedReasoningEfforts?: string[]` (e.g. `['low', 'medium', 'high']`)
     - `defaultReasoningEffort?: string`
     - `inputModalities?: string[]` (e.g. `['text', 'image', 'audio']`)
     - `supportsVision?: boolean`
     - `maxContextTokens?: number`
3. **Runtime evidence precedence & trait evidence rules**:
   - Model traits are advisory metadata used for **pre-turn UI affordances** (such as offering a reasoning-effort selector).
   - Every field on `AgentModelTraits` is either authoritatively discovered for that specific model, configured/advisory from operator config (`ai-providers.yaml`), or unknown (`undefined`).
   - If a provider does not expose per-model supported reasoning efforts (e.g. `agy models` only outputs ID and label), `supportedReasoningEfforts` must be left `undefined` rather than manufactured from global CLI flags.
   - Absence of a trait means **UNKNOWN**, not false.
   - Runtime evidence **always** wins over advisory metadata: if a provider emits a valid normalized reasoning event, Nevo accepts and streams it regardless of whether model metadata says true, false, or unknown. Catalog metadata must never discard evidenced provider output.

*Status: APPROVED BY OWNER.*

---

## D5: Event architecture and layered transformation pipeline

### Verified facts
- The public `AgentEvent` contract in `contracts.mjs` defines:
  `turn.started`, `turn.updated`, `message.started`, `text.delta`, `progress.delta`, `reasoning.delta`, `tool.started`, `tool.updated`, `tool.completed`, `interaction.requested`, `interaction.resolved`, `usage.updated`, `turn.completed`, `turn.failed`.
- The runtime uses internal semantic names: `final_answer.delta`, `commentary.delta`.
- The browser consumes public events over Server-Sent Events (SSE).

### Owner decision
Adopt the four-layer transformation pipeline:
```text
Provider Protocol
    ->
Provider-Specific Adapter Mapping
    ->
Neutral Internal Semantic Events (final_answer.delta, commentary.delta, reasoning.delta, tool, interaction)
    ->
Public AgentEvent Stream over SSE (text.delta, progress.delta, reasoning.delta, tool.*, interaction.*, etc.)
    ->
CanonicalTurn / Projections (finalAnswer, work: WorkItem[], status, terminalOutcome)
```
- Do not flatten provider protocol directly into UI semantics where meaning would be lost.
- Keep semantic distinctions (final answer vs commentary/progress vs provider-exposed reasoning vs tools vs interactions) in the appropriate internal layer.

*Status: APPROVED BY OWNER.*

---

## D6: Terminal outcome, failure reason, and recovery

### Verified facts
- `CanonicalTurn` defines four immutable terminal outcomes: `completed`, `failed`, `cancelled`, `interrupted`.
- Turn status also defines a non-terminal state: `status: 'unknown'`.
- Cancellation and server restart are lifecycle events, not request errors.

### Owner decision
Decouple the three concepts into separate fields:
1. **Lifecycle / Terminal Outcome**:
   - `completed`: Normal successful completion.
   - `failed`: Terminal failure caused by an error.
   - `cancelled`: Turn aborted by explicit user or system intent.
   - `interrupted`: Turn interrupted by server shutdown, process restart, or recovery cleanup.
2. **Normalized Failure / Reason Code** (`code: string`):
   - Identity & Security: `AI_AUTH_FAILED` (401), `AI_POLICY_DENIED` (403)
   - Capacity: `AI_RATE_LIMITED` (429), `AI_QUOTA_EXHAUSTED` (429)
   - Availability & Transport: `AI_PROVIDER_UNAVAILABLE` (503), `AI_TRANSPORT_ERROR` (502)
   - Timeouts: `AI_PROVIDER_TIMEOUT` (504), `AI_RUNTIME_TIMEOUT` (504)
   - Protocol & Execution: `AI_PROTOCOL_ERROR` (502), `AI_UNSUPPORTED_OPERATION` (409), `AI_PROVIDER_EXECUTION_ERROR` (502)
   - Lost State: `AI_OPERATION_LOST` (500)
3. **Structured Recovery Hint** (`recoveryHint: string`):
   - `'none'`: Permanent or deliberate; do not retry.
   - `'retry-after-delay'`: Transient capacity/transport error; retry after backoff (uses `suggestedDelayMs`).
   - `'new-turn'`: Previous turn failed cleanly; caller may submit a new turn in the same session.
   - `'new-session'`: Session state corrupted; must create a fresh session.
   - `'operator-action'`: Requires human intervention (e.g. CLI login, config update).
   - `'alternate-provider'`: Quota or model unavailable; failover to another provider.

*Status: APPROVED BY OWNER.*

---

## D7: Lost / unknown operations

### Verified facts
- Browser disconnect (SSE drop) is a client transport event, not provider operation loss. The backend owns operation execution.
- If the backend loses contact with the provider child process or daemon during an active turn, the execution state cannot be proven without authoritative evidence.
- A confirmed process exit proves that the process is no longer running (liveness has ended); it does NOT by itself prove the semantic provider result (whether the turn completed, failed, or produced an answer).

### Owner decision
1. **Backend ownership**: Provider operation ownership belongs strictly to the backend. Reconnecting browsers or clients from other devices reconstruct and continue the turn from backend state.
2. **Transient reconciliation state**: If the backend loses authoritative connection to a provider operation, transition the turn status to `status: 'unknown'` with diagnostic code `AI_OPERATION_LOST`. Do **NOT** make `unknown` a permanent blocking state requiring physical workstation access.
3. **Block concurrent execution**: While in `unknown` state, block new turn execution for that session to prevent conflicting file edits or out-of-order execution.
4. **Authoritative reconciliation**:
   - Confirmed PID termination proves only that process liveness has ended; it does not prove provider semantic outcome.
   - Provider semantic outcome (`completed` or `failed`) can only be proven by authoritative provider evidence:
     - Provider terminal protocol event (e.g. late completion frame with turn correlation).
     - Provider-supported status query.
5. **Remote recovery / forced cleanup**:
   - The user/operator can remotely trigger a recovery/abort action through the backend API.
   - When Nevo performs forced cleanup and verifies that the process tree is terminated, Nevo seals its own lifecycle outcome as `terminal (outcome: 'interrupted', cause: 'forced_cleanup')`, without fabricating an unobserved provider result.

*Status: APPROVED BY OWNER.*

---

## D8: Session identity and persistence

### Verified facts
- `AgentSessionBindingService` durably persists workflow session bindings (`(specId, taskId)` -> `(provider, providerSessionId, mode, established)`) in `.nevo-ai-local/sessions/<specId>.json`.
- `AntigravityAgentProvider` independently maintains `.nevo-ai-local/antigravity-sessions.json` to map provisional client UUIDs to Antigravity internal conversation IDs (`c_...`).
- Verification confirms: this mechanism **already works and survives Nevo server restarts**. It serves a genuine, necessary purpose (bridging provisional client UUIDs allocated before execution to asynchronous conversation IDs allocated by `agy` on the first streamed line).

### Owner decision
1. **Durable source of truth**: Session bindings and provider session identity must survive Nevo server restart.
2. **Preserve working persistence**: Do **NOT** perform a disruptive migration or consolidation of `antigravity-sessions.json` into `AgentSessionBindingService`. The alias file has a real purpose and works reliably.
3. **Adapter encapsulation**: Keep the alias store encapsulated strictly behind the Antigravity adapter boundary as an adapter implementation detail. Ensure atomic file writes (`tempFile` + `rename`) to protect against corruption during crashes.

*Status: APPROVED BY OWNER.*

---

## D9: Child process lifecycle and process-tree termination

### Verified facts
- Claude Code and Antigravity spawn CLI processes that invoke compound tool subprocesses (compilers, `git`, `bash`, `npm test`).
- Codex app-server client spawns the `codex app-server` daemon process.
- On Windows, standard Node.js `child.kill()` terminates only the immediate root child PID; descendant processes survive orphaned.
- On POSIX, terminating a process tree via `process.kill(-pid, signal)` requires that the child process was spawned as a process group leader (`detached: true`). If spawned without `detached: true`, `process.kill(-pid)` signals the parent process group or fails.

### Owner decision
1. **Complete process tree lifecycle**: The process lifecycle contract in `process-termination.mjs` must cover both:
   - **Spawn-side process group establishment**: On POSIX, child processes must be spawned with `detached: true` (or via a shared spawn options helper) so the child becomes a process group leader. On Windows, `detached` is omitted to avoid unwanted console allocation.
   - **Kill-side process tree termination**:
     - Windows: `taskkill.exe /PID <pid> /T /F` or Windows Job Objects with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`.
     - POSIX: `process.kill(-pid, signal)` targeting the process group.
     - Post-termination verification confirms the target PID is no longer alive before resolving.
2. **All child spawns covered**: Claude CLI, Antigravity CLI, and Codex app-server daemon all spawn child processes and must all adopt the shared spawn configuration and tree termination helper.
3. **Encapsulated behind runtime**: Implementation details remain hidden behind `tools/dashboard/server/ai/providers/process-termination.mjs`.

*Status: APPROVED BY OWNER.*

---

## D10: Provider availability and health metadata

### Verified facts
- Currently, `AgentProviderDescriptor` has `enabled: boolean` and `available: boolean`.
- Deriving global provider health from a single failed turn causes false-negatives (e.g. rate limit on one turn marks provider unavailable in the UI).

### Owner decision
1. **Separation of stable facts from transient health**:
   - **Stable Facts**: `enabled: boolean` (operator allow-list in `ai-providers.yaml`), `installed: boolean` (binary discovered), `version?: string`.
   - **Transient Health**: `status: 'healthy' | 'degraded' | 'unavailable'`, `authenticated?: boolean` (only where reliably checkable without network blocking/side-effects), `unavailableReason?: string`.
2. **Isolation invariant**: A per-turn, per-model, or per-account rate limit (HTTP 429) or transient error must **NEVER** globally mark a provider descriptor as unavailable or uninstalled.
3. **Scope boundary**: Provider/account quota/limit telemetry is NOT required as part of this change; noted as a future orchestration extension.

*Status: APPROVED BY OWNER.*
