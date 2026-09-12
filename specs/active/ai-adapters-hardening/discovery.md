---
id: spec.ai-adapters-hardening.discovery
type: discovery
title: "AI adapters hardening discovery"
status: draft
change: ai-adapters-hardening
---

# AI adapters hardening discovery

## Executive summary

This discovery grounds the architectural specification for `ai-adapters-hardening`. It inspects the current repository state across:
- Provider implementations (`ClaudeAgentProvider`, `CodexAgentProvider`, `AntigravityAgentProvider`, `MockAgentProvider`)
- Model hierarchy and turn contracts (`CanonicalTurn`, `WorkItem`, `ToolAction`, `FinalAnswer`, `TurnStatus`)
- Turn coordination and runtime (`TurnLifecycleCoordinator`, `AgentTurnRuntime`, `TurnEventStream`, `turn-recovery`)
- Storage and persistence (`AgentSessionBindingService`, `TranscriptCacheService`, `.nevo-ai-local/`)
- Diagnostics and tracing (`LifecycleTraceSink`, `RawCaptureRecorder`)
- UI feature layers (`agent-sessions` types, runtime reducer, timeline projections)
- CLI installations and execution behaviors probed on the host system (`claude`, `codex`, `agy`)

While the preceding change (`ai-session-issues-and-diagnostics` / `ADR-0008`) established a robust canonical Turn and Work hierarchy, the underlying provider adapters still exhibit significant transport, protocol, and lifecycle disparities:
1. **Session allocation asymmetry**: Claude accepts client-assigned UUIDs (`--session-id`); Codex creates authoritative IDs on an active daemon (`thread/start`); Antigravity allocates unpredictable internal IDs during headless streaming, requiring an isolated JSON alias file (`antigravity-sessions.json`) that duplicates binding responsibilities.
2. **Interaction disparity**: Codex provides rich native bidirectional approvals and questions over stdio JSON-RPC; Claude requires an external Fastify HTTP MCP bridge (`/mcp` + `NODE_EXTRA_CA_CERTS`); Antigravity operates in a fire-and-forget headless stream where questions are auto-skipped by the CLI.
3. **Process ownership heterogeneity**: Claude and Antigravity spawn a new CLI child process per turn, whereas Codex communicates over JSON-RPC with a single shared persistent daemon process. Process termination relies on Node's `child.kill('SIGINT'/'SIGKILL')`, which does not reliably terminate child process trees on Windows.
4. **Complete absence of model catalog**: Neither the provider descriptors, the registry, nor the UI have any concept of available AI models, model capabilities, or dynamic model discovery, even though `agy` possesses a native `agy models` CLI command and Codex accepts model overrides in `thread/start`.
5. **Error taxonomy collapse**: Authentication failures, rate limits, quota exhaustion, process crashes, and transport disconnects collapse into coarse `AI_PROVIDER_ERROR` or `AI_PROVIDER_EXIT_ERROR` (HTTP 502), preventing deterministic retry, fallback, or handover orchestration.

---

## Provider comparison matrix

The following matrix documents the current factual behavior across Claude Code, OpenAI Codex, Google Antigravity, and Mock implementations in the Nevo codebase as of September 2026.

| Dimension | Claude Code (`claude`) | OpenAI Codex (`codex`) | Google Antigravity (`agy`) | Mock Provider (`mock`) |
|---|---|---|---|---|
| **1. Session creation** | Client generates placeholder UUID (`established: false`). On first turn, passed via `--session-id <uuid>`. Materialized on first event. | Explicit `createSession()` calling `thread/start` on app-server. Server generates `thread.id` (`established: true`). | Client generates placeholder UUID (`established: false`). First turn launched without session flag; `agy` allocates internal ID on first event. | Returns `mock-<uuid>` (`established: true`). |
| **2. Session resume** | Spawns with `--resume <sessionId>`. If Claude CLI reports session not found, retries with `--session-id` to heal unmaterialized sessions. | Calls `thread/resume` on app-server daemon on first turn of session. Subsequent turns know thread is loaded (`#loadedThreads`). | Passes `--conversation <targetConversationId>`. Resolves ID via `#sessionAliases` or `#materializedSessions`. | In-memory resume; matches on `providerSessionId`. |
| **3. Cancellation** | Aborts signal, unregisters MCP turn, terminates child process via `terminateChildProcess` (SIGINT -> 5s -> SIGKILL -> 2s). | Sends `turn/interrupt` JSON-RPC request to persistent app-server. Cancels all pending interaction requests. Process stays alive. | Clears post-result timer, terminates child process via `terminateChildProcess` (SIGINT -> 5s -> SIGKILL -> 2s). | Clears timers and aborts in-memory mock generation promise. |
| **4. Process ownership** | 1:1 per turn. Child process spawned on `startTurn`, exits at end of turn. | 1:N persistent daemon. Single long-lived `codex app-server` process managed by `CodexAppServerClient` for server lifetime. | 1:1 per turn. Child process spawned on `startTurn`, runs until terminal event or process close. | In-process (no external child process). |
| **5. Turn continuation** | In-flight turns remain paused waiting for MCP HTTP tool responses. Resumed turns spawn a new process with `--resume`. | Continuous live operation over stdio. Tool approvals and questions pause and resume inside the same turn over JSON-RPC. | No mid-turn pause/continuation in current headless transport. Executes to completion and exits. | In-memory timers pause and resume upon method call. |
| **6. Text / final answer** | Text before tool calls is buffered in `pendingCommentary`. If no tools run, buffered text flushes to `finalAnswerDelta`. Also reads `result.result`. | `agentMessage` items carry optional `phase`. `phase: 'final_answer'` emits `finalAnswerDelta`. Legacy unphased messages route through candidate correlation. | Text buffered in `pendingAssistantText`. At terminal `result`/`done`, `extractFinalResponse()` extracts final text and emits `finalAnswerDelta`. | Emits preconfigured final answer text at end of simulated scenario. |
| **7. Commentary / progress** | Text emitted during or after tool calls emits `emitCommentaryDelta` (`progress.delta` event type). | `agentMessage` with `phase: 'commentary'` emits `emitCommentaryDelta`. | Text buffered before tool starts is flushed as commentary block (`commentary-${turnId}-${n}`). | Emits simulated progress steps. |
| **8. Reasoning** | `thinking` content blocks and `thinking_delta` stream through `emitReasoningDelta`. | `item/reasoning/textDelta` and `item/reasoning/summaryTextDelta` stream through `emitReasoningDelta`. | `step_update.thought`/`thinking` and `thought`/`reasoning` events stream through `emitReasoningDelta`. | Emits simulated reasoning blocks. |
| **9. Tools** | `tool_use` mapped via `mapClaudeTool` (Bash, Read, Edit, Write, Glob, Grep, WebFetch, ask_user). Dangling tools closed on result. | `commandExecution`, `fileChange`, `mcpToolCall`, `dynamicToolCall`. Maps nested `actions` on commands (`mapCodexCommandActions`). | `step_update.step_type: 'tool'` mapped via `mapAntigravityTool` (`run_command`, `view_file`, `write_to_file`, etc.). | Simulates read/edit/command tool calls with delays. |
| **10. Usage** | `event.usage` (`input_tokens`, `output_tokens`) on assistant, delta, or result emitted via `emitUsageUpdated`. No cost. | `thread/tokenUsage/updated` notifications emit `tokensIn`, `tokensOut`. No cost. | `payload.usage` (`input_tokens`, `output_tokens`, `cost`) emitted via `emitUsageUpdated`. | Simulates token counts. |
| **11. Questions / ask-user** | `interactiveQuestions: true` (via server MCP `/mcp` endpoint and `ask_user` tool). If MCP disabled, `false`. | `interactiveQuestions: true` (native `item/tool/requestUserInput` server request over stdio JSON-RPC). | `interactiveQuestions: false` (in headless stream mode, `ask_question` tool is auto-skipped by CLI as "User Skipped"). | `interactiveQuestions: true` (triggers on prompt containing `'question'`). |
| **12. Permissions** | `interactivePermissions: false`. Maps execution mode to `--permission-mode` (`plan`, `acceptEdits`, `bypassPermissions`). | `interactivePermissions: true`. App-server requests approvals (`item/commandExecution/requestApproval`, `fileChange`, `permissions`). | `interactivePermissions: false`. Maps mode to `--mode=plan`, `--mode=accept-edits`, or `--dangerously-skip-permissions`. | `interactivePermissions: true` (triggers on prompt containing `'permission'`). |
| **13. Confirmations** | `interactiveConfirmations: false`. (Contract exists, but provider does not emit confirmations). | `interactiveConfirmations: false`. (Uses permission or question requests instead). | `interactiveConfirmations: false`. (Capability declared false). | `interactiveConfirmations: false`. |
| **14. Model selection** | Not supported in adapter. CLI supports `--model <model>`, but provider descriptor and `startTurn` omit model parameters. | Not supported in adapter. CLI and app-server accept `model` parameter, but provider passes no model field. | Not supported in adapter. CLI supports `--model <model>`, but provider passes no model field. | Fixed mock models. |
| **15. Model discovery** | No CLI model listing command (`claude models` does not exist). Requires static catalog or Anthropic API query. | No app-server RPC or CLI listing command (`codex models` does not exist). Requires static catalog or config reflection. | Supported in CLI! `agy models` outputs full table of model IDs and display names. Adapter does not call it. | Static descriptor. |
| **16. Provider availability** | `isAvailable()` probes `where.exe claude` / `which claude` (cached 30s). Returns `available` + `unavailableReason`. | `isAvailable()` executes `codex --version` via `defaultProbeCodexExecutable` (cached 30s). | `isAvailable()` probes `LOCALAPPDATA\agy\bin\agy.exe` or `where.exe agy` (cached 30s). | Always `available: true`. |
| **17. Auth failure** | Non-zero CLI exit or stderr notice. Mapped to generic `AI_PROVIDER_EXIT_ERROR` (HTTP 502). | App-server initialization or request JSON-RPC error. Mapped to `AI_PROVIDER_ERROR` (HTTP 502). | Non-zero CLI exit or stderr notice. Mapped to generic `AI_PROVIDER_EXIT_ERROR` or `AI_PROVIDER_ERROR`. | Never fails auth. |
| **18. Quota / rate-limit** | CLI exit or `error` event. Mapped to generic `AI_PROVIDER_ERROR`. | `error` notification. Mapped to generic `AI_PROVIDER_ERROR`. | Emits `status: "ERROR"` with quota notice. If substantive response exists, treated as advisory; else `AI_PROVIDER_ERROR`. | Simulates on specific triggers. |
| **19. Timeout** | Governed exclusively by Nevo `TurnLifecycleCoordinator` protocol-silence watchdog (5 min). | Governed by Nevo protocol-silence watchdog and request-level timeouts. | Two timeouts: 1) Provider transport `--print-timeout` (default 24h, exit code 124); 2) Nevo silence watchdog (5 min). | In-memory timeout. |
| **20. User cancellation** | Coordinator requests cancellation; calls adapter `cancelTurn()`; terminates child process. Coordinator arbitrates outcome. | Coordinator requests cancellation; calls adapter `cancelTurn()`; sends `turn/interrupt`. Coordinator arbitrates outcome. | Coordinator requests cancellation; calls adapter `cancelTurn()`; terminates child process. Coordinator arbitrates outcome. | Cancels in-memory promise. |
| **21. Process interruption** | Child process crash/exit yields `AI_PROVIDER_EXIT_ERROR` or `AI_PROVIDER_PROCESS_ERROR`. | Daemon process death caught by `failureWatch`; rejects all active thread turns with `AI_PROVIDER_DISPOSED`. | Child process crash yields `AI_PROVIDER_EXIT_ERROR` or `AI_PROVIDER_PROCESS_ERROR`. | N/A (in-process). |
| **22. Restart / shutdown** | `dispose()` flushes raw capture. Boot reconciliation marks orphaned turns `AI_TURN_INTERRUPTED`. | `dispose()` terminates app-server process. Boot reconciliation marks orphaned turns `AI_TURN_INTERRUPTED`. | `dispose()` terminates children and flushes raw capture. Boot reconciliation marks orphaned turns `AI_TURN_INTERRUPTED`. | In-memory reset. |
| **23. Protocol error** | Malformed JSON stdout lines ignored. Unexpected errors reject with `AI_PROVIDER_ERROR`. | Strict schema verifier (`verify-schema.mjs`). Mismatched envelopes throw `AI_PROVIDER_PROTOCOL_ERROR`. | Malformed JSON lines fall back to raw text streaming (`bufferAssistantText`). | Deterministic. |
| **24. Lost operation** | Opaque `childProcess` handle. No detached polling or process re-attachment. | Opaque `{ codexTurnId, readyPromise, ... }` handle. No detached polling or process re-attachment. | Opaque `child` handle. No detached polling or process re-attachment. | In-memory. |
| **25. Late terminal events** | Events after process exit are impossible. Late events arriving after turn settlement recorded in trace as `ignored`. | Notifications arriving after `settled: true` are ignored. Coordinator marks late events as `ignored`. | Events after `isResolved` are ignored. Residual buffer flushed on process close. | N/A. |
| **26. Diagnostics / raw data** | Optional `RawCaptureRecorder` writing stdout/stderr to `.nevo-ai-local/claude_raw/<session>/raw.ndjson`. | Optional `RawCaptureRecorder` writing stdout/stderr to `.nevo-ai-local/codex_raw/<session>/raw.ndjson`. | Built-in `RawCaptureRecorder` writing to `.nevo-ai-local/antigravity_raw/`. Provisional session rewrite logic. | In-memory trace only. |

---

## Factual observations (Code, Tests, CLI Probes)

### Session and identity lifecycle
1. **Fact**: `AgentSessionBindingService` persists bindings in `.nevo-ai-local/sessions/<specId>.json` using composite key `(provider, providerSessionId)`.
2. **Fact**: `AntigravityAgentProvider` independently maintains `.nevo-ai-local/antigravity-sessions.json` to map placeholder IDs to real conversation IDs allocated by `agy`.
3. **Fact**: Claude Code materializes session identity when the first stdout event containing `session_id` matches `effectiveSessionId`. If `--resume` fails with "No conversation found", it automatically retries with `--session-id`.
4. **Fact**: Codex creates sessions upfront via `thread/start` and returns `thread.id` synchronously. Resume is executed once per app-server lifecycle via `thread/resume`.

### Interaction mechanics
5. **Fact**: Claude Code supports interactive questions through a server-side Fastify MCP endpoint (`/mcp`) running `@modelcontextprotocol/sdk`. The turn passes `--mcp-config` with an ephemeral token header and injects an append-system-prompt instruction to call `ask_user`.
6. **Fact**: Claude's `PreToolUse` hook script (`hook.mjs`) and continuation store (`continuation-store.mjs`) remain in the codebase as legacy deferral mechanisms.
7. **Fact**: Codex natively supports interactive questions via `item/tool/requestUserInput` and permissions via `item/commandExecution/requestApproval`, `fileChange/requestApproval`, and `permissions/requestApproval`.
8. **Fact**: Antigravity declares `interactiveQuestions: false` and `interactivePermissions: false`. In headless streaming mode, `agy` does not pause for input; calling `respondInteraction()` unconditionally throws `CapabilityNotSupportedError`.

### Output and phase semantics
9. **Fact**: Codex has explicit protocol support for message phases: `agentMessage.phase` can be `commentary` or `final_answer`.
10. **Fact**: Claude Code has no native phase tag: text emitted before tool calls is tentatively held as commentary; if no tools execute, it becomes the final answer; if tools execute, it is emitted as commentary and the final answer is taken from `result.result` or subsequent text.
11. **Fact**: Antigravity has no native phase tag: all text is buffered; if tools execute, buffered text flushes as commentary; at turn end, `extractFinalResponse()` extracts the response payload.
12. **Fact**: The canonical turn model (`CanonicalTurn`) strictly enforces three levels: Level 1 Turn, Level 2 WorkItem (`commentary`, `reasoning`, `tool`, `interaction`), Level 3 `ToolAction`. `FinalAnswer` is held in an orthogonal property on `CanonicalTurn`, not as a `WorkItem`.

### Model exposure and discovery
13. **Fact**: Currently, `validateProviderDescriptor` accepts only `id`, `label`, `enabled`, `available`, `unavailableReason`, `capabilities`, `supportedModes`, and `defaultMode`. It does not accept any model catalog or model configuration.
14. **Fact**: Host CLI verification proves that `agy models` outputs a table of available models (e.g. `gemini-3.8-flash-high`, `gemini-3.1-pro-high`, `claude-sonnet-4-6`, `gpt-oss-120b-medium`).
15. **Fact**: Host CLI verification proves that `claude` accepts `--model <model>`, but has no CLI command to discover or list models.
16. **Fact**: Host CLI verification proves that `codex` accepts `-m, --model <MODEL>`, but has no CLI command or app-server RPC to list models.

### Error taxonomy and timeouts
17. **Fact**: When a CLI command fails or exits non-zero, providers throw `AiError('AI_PROVIDER_EXIT_ERROR')` or `AiError('AI_PROVIDER_ERROR')` with HTTP status 502.
18. **Fact**: `TurnLifecycleCoordinator` implements a deterministic terminal arbitrator: if `timeoutRequested` is true, the turn settles as `outcome: 'failed'` with `cause: 'timeout/protocol-silence'`; if `cancellationRequested` is true, it settles as `outcome: 'cancelled'` with `cause: 'user_cancelled'`, regardless of whether the provider process subsequently exits cleanly or errors.
19. **Fact**: Antigravity CLI enforces a mandatory `--print-timeout` (defaults in Nevo to 86,400s / 24h). If fired, it yields exit code 124 or a timeout error string, which the adapter maps to `AI_PROVIDER_TIMEOUT` with `source: 'antigravity_cli'`.

---

## Inferences

1. **Inference (Process Tree Leakage)**: Node's `child.kill('SIGINT')` and `child.kill('SIGKILL')` only target the immediate child process. When Claude or Antigravity spawns build tools, bash scripts, or compilers on Windows, terminating the direct CLI process can leave orphaned worker subprocesses consuming CPU and memory.
2. **Inference (Dual Alias Fragility)**: Maintaining `antigravity-sessions.json` inside the Antigravity provider adapter while `AgentSessionBindingService` manages `sessions/<specId>.json` introduces a split-brain risk: if the alias file is corrupted, moved, or out of sync with durable bindings, session resumption fails.
3. **Inference (Orchestration Blocking)**: Because all failures (auth, quota, network, syntax, timeout) collapse into `AI_PROVIDER_ERROR`, any future automated orchestration (such as retrying transient rate limits or falling back to an alternate provider on quota exhaustion) is impossible without brittle regex parsing of provider error strings.
4. **Inference (Model Configuration Feasibility)**: Because all three CLIs support passing a target model (`claude --model`, `agy --model`, `codex -m` / `thread/start`), adding model selection to Nevo requires only normalized catalog metadata and flag propagation; it does not require redesigning the execution transports.

---

## Inconsistencies

1. **Inconsistency (Question Support vs Capability Truthfulness)**: Claude supports interactive questions via an in-process MCP HTTP bridge; Codex supports them via native stdio JSON-RPC; Antigravity rejects them outright with `CapabilityNotSupportedError`. The UI must disable question prompts when Antigravity is active, yet the session creation dialog does not warn operators that Antigravity cannot ask questions.
2. **Inconsistency (Permission Support)**: Codex supports interactive mid-turn permissions; Claude and Antigravity map permissions strictly to process startup flags (`--permission-mode` and `--mode=accept-edits`). The capability `interactivePermissions` is therefore true only for Codex.
3. **Inconsistency (Session Identity Timing)**: Codex allocates session IDs synchronously before turn execution (`createSession()`); Claude allocates upon first turn start using client UUID; Antigravity allocates asynchronously during turn execution from stdout streaming.
4. **Inconsistency (Raw Capture Durability)**: Antigravity has complex provisional-to-canonical directory rewrite and JSON metadata migration logic; Claude and Codex use a simpler `RawCaptureRecorder` without provisional migration because their session IDs are known before raw files are created.

---

## Open questions for owner decision

1. **Model Catalog Strategy**: Should Nevo discover models dynamically where supported (`agy models`), accept operator configuration (`ai-providers.yaml`), supply baseline metadata for known models, omit model overrides for provider defaults, and allow unlisted models to pass through without false validation rejections?
2. **Model Selection Scope**: Should model selection be bound exclusively to session creation (matching Codex protocol and Claude context invariants), or should turn-level model overrides be permitted where an adapter declares native support?
3. **Interaction Contract & Headless Fallback**: Should Antigravity remain strictly non-interactive (`interactiveQuestions: false`) while establishing a canonical composer fallback for terminal textual questions, rather than fabricating synthetic interactions via regex?
4. **Capability Ownership & Decoupling**: Should provider transport capabilities (e.g. `reasoningEvents`, `toolCalls`, `usage`) be decoupled from model inference traits (`supportsReasoning`, `supportsReasoningEffort`, `supportsVision`), with effective turn capabilities derived by the runtime?
5. **Output & Event Vocabulary Layers**: Should Nevo explicitly structure a four-layer event pipeline (Provider Protocol -> Internal Runtime Semantic -> Public AgentEvent -> CanonicalTurn Projection) with semantic rendering targets?
6. **Error Taxonomy vs Terminal Outcomes**: Should terminal lifecycle outcomes (`completed`, `failed`, `cancelled`, `interrupted`) be decoupled from failure reason codes, and simplistic boolean `retryable` replaced by structured neutral recovery hints (`none`, `retry-after-delay`, `new-turn`, `new-session`, `operator-action`, `alternate-provider`)?
7. **Lost / Unknown Operation Semantics**: How should lost operations interact with `turn.status: 'unknown'` to preserve epistemic truth without falsely claiming `failed` while background processes may still run?
8. **Session Alias Convergence**: Should the Antigravity session alias store (`antigravity-sessions.json`) be deprecated and migrated directly into `AgentSessionBindingService` as a first-class alias mechanism?
9. **Process Tree Termination on Windows**: Should Nevo adopt platform-native process tree termination (`taskkill.exe /F /T /PID` or Job Objects on Windows) to prevent orphaned subprocesses from surviving CLI cancellation?
10. **Provider Availability vs Health Decoupling**: Should stable configuration facts (`enabled`, `installed`, `version`) be separated from transient observations (`authenticated`, `status`), ensuring per-turn rate limits never mark a provider globally unavailable?

