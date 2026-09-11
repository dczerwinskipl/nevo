# Owner decisions: AI adapters hardening

This document presents architectural decision option analyses for `ai-adapters-hardening` in accordance with `docs/ai/specification-workflow.md` § "Solution option analysis" and ADR-0003.

Per repository policy, the agent analyzes options, trade-offs, risks, and recommendations; the repository owner makes the final decision before implementation tasks are started.

---

## Decision 1: Provider Model Catalog Strategy

### Context
Nevo currently has zero model catalog exposure. Provider descriptors contain only top-level booleans and execution modes (`ask`, `edit`, `agent`). However:
- `agy` natively supports dynamic discovery via `agy models`, outputting local IDs (e.g., `gemini-3.8-flash-high`) and display labels.
- `claude` accepts `--model <model>`, but has no CLI command to discover models.
- `codex` accepts `-m, --model <MODEL>` on CLI and `model` on app-server `thread/start`, but has no CLI or RPC discovery endpoint.

Future work (provider/model selection, fallback, quota management) requires knowing what models exist without hardcoding a global Nevo model list.

### Options

#### Option A: Static provider-declared model catalog
Each provider adapter hardcodes a static list of supported models in its descriptor or reads them from local provider configuration (`ai-providers.yaml`).
- **Implementation cost**: S (Low). Simple array of model objects in provider descriptor.
- **Reliability**: High (never fails due to CLI probe timeout or parsing error).
- **Compatibility risk**: Low (no external commands invoked).
- **Stale-data risk**: Very High. As models are released or deprecated by Anthropic, OpenAI, or Google, code or config must be updated manually.
- **Extensibility**: Poor. Cannot adapt to user accounts with custom or fine-tuned model access.
- **Unlocks**: Immediate UI model picker with predictable labels.
- **Forecloses**: Dynamic model discovery for providers like Antigravity that natively support it.

#### Option B: Dynamic provider discovery
The provider adapter queries the underlying provider CLI or daemon at runtime (e.g. executing `agy models` or querying local provider config) to discover available models.
- **Implementation cost**: M (Moderate). Requires spawning probe processes, caching results with TTL, handling probe timeouts, and parsing CLI stdout formats.
- **Reliability**: Medium (probes can fail, time out, or hang on slow networks or missing auth).
- **Compatibility risk**: High for providers without a discovery command (Claude and Codex do not have `models` subcommands; attempting to run `claude models` fails).
- **Stale-data risk**: Very Low (always reflects the CLI's latest capabilities).
- **Extensibility**: High for discovery-capable CLIs.
- **Unlocks**: Zero-configuration model updates for providers supporting dynamic queries.
- **Forecloses**: Uniform offline operation; cannot discover models for Claude or Codex without introducing direct external API calls (which violates local CLI encapsulation).

#### Option C: Hybrid static metadata + dynamic runtime discovery (Recommended)
Define a normalized model descriptor contract (`AgentModelDescriptor`). Each provider supplies a baseline static catalog of well-known models (guaranteeing immediate, offline-safe availability for Claude and Codex), while providers with discovery capabilities (like Antigravity) dynamically enrich, validate, and refresh their catalog at runtime with a configurable TTL cache.
- **Implementation cost**: M (Moderate). Static baseline plus an optional `discoverModels()` hook on `AgentProvider`.
- **Reliability**: High (static fallback guarantees models are always available even if probe times out).
- **Compatibility risk**: Low (adapter uses dynamic discovery only when supported by the provider transport).
- **Stale-data risk**: Low to Moderate (Antigravity stays fully fresh; Claude/Codex rely on baseline + config overrides).
- **Extensibility**: Excellent (supports custom model overrides in `ai-providers.yaml`).
- **Unlocks**: Robust foundation for future model-picker UI, quota tracking, and model-level capability checks.
- **Forecloses**: Nothing. Allows each provider to use its native discovery mechanism without forcing a false uniformity.

### Recommendation
**Adopt Option C (Hybrid)**. It respects reality: Antigravity can discover models dynamically from `agy models`, whereas Claude and Codex cannot do so from their CLIs alone. Baseline descriptors guarantee reliability, while dynamic hooks unlock freshness where supported.

---

## Decision 2: Interaction Transport & Capability Architecture

### Context
Turn interactions allow an agent to ask questions or request permissions:
- Codex natively supports both questions (`item/tool/requestUserInput`) and approvals (`requestApproval`) over stdio JSON-RPC.
- Claude supports questions via an in-process Fastify HTTP MCP bridge (`/mcp` + `ask_user`), but does not support mid-turn permissions.
- Antigravity currently operates headlessly (`--output-format stream-json --print <message>`) and does not support mid-turn pauses; questions are auto-skipped by the CLI.

### Options

#### Option A: Strict fail-closed capability boundary (Minimal)
Keep current capabilities honest: `interactiveQuestions` is true only for Claude (with MCP) and Codex; `interactivePermissions` is true only for Codex; Antigravity remains `false` for both. Any interaction requested for an unsupported provider fails fast with `CapabilityNotSupportedError`.
- **Implementation cost**: XS. Already largely in place.
- **Reliability**: Very High. Honest declaration; no fragile bridging hacks.
- **Compatibility risk**: None.
- **Stale-data risk**: None.
- **Extensibility**: Limited for Antigravity until CLI supports interactive streaming.
- **Unlocks**: Deterministic runtime behavior; no hung turns.
- **Forecloses**: Interactive question workflows in the UI when using Antigravity.

#### Option B: Unified MCP bridge across all CLI-based providers
Standardize all CLI agent interactions onto Model Context Protocol (MCP). In addition to Claude, configure Antigravity to load an MCP server exposing `ask_user`.
- **Implementation cost**: L. Requires configuring `agy mcp` or passing MCP settings to Antigravity, verifying whether `agy` supports MCP tools in print/stream-json mode.
- **Reliability**: Medium. Depends on undocumented Antigravity CLI MCP behavior in headless mode.
- **Compatibility risk**: High. Antigravity CLI 1.1.23 print mode may not support blocking on MCP tools during non-interactive execution.
- **Extensibility**: High long-term.
- **Unlocks**: Uniform interaction transport across all providers.
- **Forecloses**: Simple isolated process model for Antigravity.

#### Option C: Canonical interaction contract with degraded textual fallback (Recommended for Specification)
Maintain strict capability honesty (Option A) at the adapter level (`interactiveQuestions: false` on Antigravity), but establish a normalized turn continuation contract at the runtime level: if a model outputs a question at the end of its turn without a structured interaction, it settles as a normal completed turn with `finalAnswer`, allowing the user to answer via the composer. For providers supporting live interaction (Codex, Claude MCP), the turn pauses in `requiresAttention` without terminating.
- **Implementation cost**: S. Clarifies the invariant already verified in `cross-provider-conformance.test.mjs` (AC8).
- **Reliability**: High.
- **Compatibility risk**: None.
- **Extensibility**: Prepares the runtime to accept an Antigravity MCP bridge if/when verified in the future.
- **Unlocks**: Clean separation between structured mid-turn interactions and turn-ending textual questions.
- **Forecloses**: Text-scraping heuristics to invent fake interactions.

### Recommendation
**Adopt Option C**. Retain honest boolean capabilities on the provider descriptor, keep interaction contracts strictly structured, and forbid text heuristics from inventing fake interaction work items.

---

## Decision 3: Error & Terminal Taxonomy Normalization

### Context
Today, diverse failures (invalid credentials, rate limiting, quota exhaustion, network drops, CLI exit 1, and process crashes) collapse into `AI_PROVIDER_ERROR` or `AI_PROVIDER_EXIT_ERROR` (HTTP 502). Downstream layers cannot distinguish transient failures (retryable) from permanent authorization or quota failures (non-retryable, requiring handover or operator intervention).

### Options

#### Option A: Coarse error codes with freeform string details
Retain existing codes (`AI_PROVIDER_ERROR`, `AI_PROVIDER_EXIT_ERROR`, `AI_PROVIDER_TIMEOUT`) and rely on `details.message` or stderr snippets.
- **Implementation cost**: XS.
- **Reliability**: Poor for automation (requires regex over unstructured English strings).
- **Compatibility risk**: None.
- **Unlocks**: Minimal implementation diff.
- **Forecloses**: Deterministic automated retries, fallback routing, and quota-aware alerting.

#### Option B: Discriminated neutral failure taxonomy with structured metadata (Recommended)
Define a formal, provider-neutral taxonomy of error codes and structured details:
- **Identity & Access**: `AI_AUTH_FAILED` (401), `AI_POLICY_DENIED` (403).
- **Capacity & Quota**: `AI_RATE_LIMITED` (429), `AI_QUOTA_EXHAUSTED` (429/402).
- **Availability & Transport**: `AI_PROVIDER_UNAVAILABLE` (503), `AI_TRANSPORT_ERROR` (502).
- **Timeouts**: `AI_PROVIDER_TIMEOUT` (504, provider-reported deadline), `AI_RUNTIME_TIMEOUT` (504, Nevo silence watchdog).
- **Lifecycle**: `AI_TURN_CANCELLED` (409), `AI_TURN_INTERRUPTED` (409, server restart/shutdown).
- **Protocol & Execution**: `AI_PROTOCOL_ERROR` (502), `AI_UNSUPPORTED_OPERATION` (409), `AI_OPERATION_LOST` (500), `AI_PROVIDER_EXECUTION_ERROR` (502).

Each error includes structured metadata:
- `retryable`: boolean
- `suggestedDelayMs`: optional integer
- `source`: `'provider_cli' | 'app_server' | 'nevo_runtime' | 'nevo_coordinator'`
- `details`: bounded normalized object (no raw provider dumps)

- **Implementation cost**: M. Updates error normalization in Claude, Codex, and Antigravity adapters and `contracts.mjs`.
- **Reliability**: Very High.
- **Compatibility risk**: Low (existing UI renders error code and message; existing tests check error codes).
- **Extensibility**: Excellent.
- **Unlocks**: Deterministic automated retry/fallback orchestration, accurate UI status banners, and quota alerting.
- **Forecloses**: Ambiguous 502 failures.

### Recommendation
**Adopt Option B**. A structured taxonomy is the single most critical deliverable of this hardening specification, unlocking reliable downstream orchestration.

---

## Decision 4: Antigravity Session Identity & Alias Store Convergence

### Context
`AntigravityAgentProvider` allocates a provisional session UUID when a turn begins, but `agy` allocates its own internal conversation ID (e.g. `c_...`) upon launch. To handle resumption, Antigravity maintains its own `.nevo-ai-local/antigravity-sessions.json` alias file. Concurrently, `AgentSessionBindingService` maintains `.nevo-ai-local/sessions/<specId>.json`.

### Options

#### Option A: Retain separate `antigravity-sessions.json` file in adapter
Keep the Antigravity alias map private inside `AntigravityAgentProvider`.
- **Implementation cost**: None.
- **Reliability**: Low. Risk of desynchronization between binding service and alias store. Two different files must be backed up or cleaned up.
- **Compatibility risk**: None.
- **Unlocks**: Local encapsulation inside adapter.
- **Forecloses**: First-class alias queries across providers; unified session migration.

#### Option B: Converge session aliasing into `AgentSessionBindingService` (Recommended)
Add first-class alias support to `AgentSessionBindingService` (`recordSessionAlias(provider, fromSessionId, toSessionId)`). When `setProviderSessionId(allocatedId)` is called by runtime, the binding service atomically updates the durable binding and registers the alias in `.nevo-ai-local/sessions/`. Deprecate `antigravity-sessions.json` and migrate existing entries on startup.
- **Implementation cost**: S.
- **Reliability**: High. Single source of truth for session identity; atomic writes via temporary files.
- **Compatibility risk**: Low (startup migration cleans up old file).
- **Unlocks**: Clean architectural boundary; Antigravity adapter no longer manages filesystem JSON persistence.
- **Forecloses**: Provider-specific alias file sprawl.

### Recommendation
**Adopt Option B**. Persistent identity mapping belongs in `AgentSessionBindingService`, not inside a provider adapter.

---

## Decision 5: Child Process Lifecycle & Windows Process Tree Termination

### Context
Claude and Antigravity spawn CLI child processes. When a turn is cancelled or times out, `process-termination.mjs` sends `child.kill('SIGINT')` and escalates to `child.kill('SIGKILL')`.
On Windows:
- `child.kill()` calls `TerminateProcess` directly on the spawned process PID only.
- Any child processes spawned by the CLI (e.g. compilers, git, bash, tests, subagents) are NOT terminated and continue running as orphaned background processes.

### Options

#### Option A: Standard Node.js `child.kill` signals (Status quo)
Keep current `terminateChildProcess` implementation.
- **Implementation cost**: None.
- **Reliability**: Poor on Windows during command execution.
- **Compatibility risk**: None.
- **Unlocks**: No platform-specific native dependencies.
- **Forecloses**: Clean cancellation guarantees for compound tools.

#### Option B: OS-aware process tree termination (Recommended)
Harden `process-termination.mjs`:
- On Windows: Use `taskkill.exe /PID <pid> /T /F` or Windows Job Objects to guarantee full process tree termination.
- On POSIX: Use process groups (`detached: true` + `process.kill(-pid, signal)`).
- Provide bounded timeout and exit verification.
- **Implementation cost**: S.
- **Reliability**: Very High. Guarantees that neither `claude`, `agy`, nor any tool they spawned survives cancellation.
- **Compatibility risk**: Low. Standard practice for Node.js process managers on Windows.
- **Unlocks**: Elimination of runaway orphaned build processes.
- **Forecloses**: Process leaks.

### Recommendation
**Adopt Option B**. Orphaned processes on Windows directly degrade workstation performance and create file lock conflicts in Git repositories.

---

## Decision 6: Provider Availability vs Enablement Model

### Context
Currently, `AgentProviderDescriptor` has `enabled: boolean` and `available: boolean`.
- `enabled` indicates whether the operator configured the provider in `.nevo-ai-local/ai-providers.yaml`.
- `available` indicates whether the CLI executable is currently found in PATH.
This conflates configuration, installation, authentication, and transient rate-limiting into a single boolean `available`.

### Options

#### Option A: Keep binary booleans with `unavailableReason` string (Status quo)
Maintain `enabled: boolean` and `available: boolean`.
- **Implementation cost**: None.
- **Reliability**: Moderate.
- **Unlocks**: Minimal changes.
- **Forecloses**: Nuanced UI status (e.g. distinguishing "CLI not installed" from "CLI installed but not logged in" from "Rate limit backoff").

#### Option B: Structured provider health descriptor (Recommended)
Extend descriptor to cleanly separate operational states:
```typescript
interface AgentProviderDescriptor {
  id: string;
  label: string;
  enabled: boolean;        // Operator configuration allow-list
  installed: boolean;      // Binary executable discovered
  authenticated?: boolean; // Credentials verified if probed
  health: 'healthy' | 'degraded' | 'unavailable';
  unavailableReason?: string;
  capabilities: AgentCapabilities;
  models: AgentModelDescriptor[];
  supportedModes: AgentExecutionMode[];
  defaultMode: AgentExecutionMode;
}
```
- **Implementation cost**: S.
- **Reliability**: High.
- **Compatibility risk**: Low (additive fields; `available` can be computed as `health !== 'unavailable'`).
- **Unlocks**: Rich UI diagnostics, informative banners, and intelligent provider routing.
- **Forecloses**: Conflation of operator intent with runtime health.

### Recommendation
**Adopt Option B**. Provides clean separation of concerns without breaking existing consumers.
