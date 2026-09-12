---
id: development.ai-sessions
type: development
title: Local AI sessions
status: current
read_when:
  - working on dashboard AI sessions
  - verifying the provider-neutral AI runtime
  - adding an AI provider
summary: >
  Provider-neutral dashboard AI sessions, mock-mode setup, runtime boundaries,
  trusted-network access, and Part 1 verification.
related:
  - development.local-setup
  - development.architecture-overview
  - development.codex-app-server-research
  - adr.0007-provider-neutral-ai-sessions
  - adr.0008-canonical-ai-session-chat-and-turn-model
---

# Local AI sessions

The specification dashboard includes a provider-neutral AI session surface. Part 1
ships an in-process mock provider so the complete experience can be exercised from a
clean checkout. Claude, another provider installation, credentials, and local AI
configuration are not required.

## Run mock mode

Install the dashboard dependencies and start development mode:

```bash
npm --prefix tools/dashboard install
npm run dashboard:dev
```

Open the printed dashboard URL (normally `http://127.0.0.1:4317`), select an active
specification, and use its **AI sessions** entry. A session can be filtered by task,
created for one or more stable task IDs, opened full-screen, and sent messages. In
mock mode, a message containing `permission` pauses for an allow/deny interaction;
one containing `question` pauses for correlated single- and multi-select answers.
Reloading while an interaction is pending reconnects to its turn snapshot and event
stream.

The browser uses provider-neutral HTTP endpoints under `/api/agent-providers` and
`/api/agent-sessions` for providers, sessions, canonical chat snapshots (`GET .../chat`),
turns, interaction responses, and cancellation. Live turn output uses Server-Sent Events.
The browser never receives provider-private request IDs or raw provider payloads.

## Trust boundary

Dashboard AI reads and controls currently use trusted-network mode. The loopback host
or the operator's VPN is the trust boundary; this is **not identity authentication**.
Only bind the dashboard to a VPN address when every network member is trusted to read
sessions, send messages, answer interactions, and cancel turns. The server reports
this mode to the UI and keeps the access decision behind a replaceable policy seam.

## Lifecycle and ownership

- Providers own authoritative conversation history and provider session identity.
- The neutral layer owns stable specification/task correlation, validation, and safe
  browser payloads.
- The canonical turn model (`CanonicalTurn`) organizes execution into a three-level
  hierarchy:
  1. **Level 1 (Turn)**: Top-level lifecycle boundary for a user prompt with immutable
     terminal outcomes (`completed`, `failed`, `cancelled`, `interrupted`).
  2. **Level 2 (Work item)**: Strongly typed, monotonically sequenced items (`commentary`,
     `reasoning`, `tool`, `interaction`).
  3. **Level 3 (ToolAction)**: Nested actions within a tool item representing compound
     operations without inflating the turn's top-level `activityCount`.
- The server computes semantic `workSummary` (`status`, `phase`, `activityCount`,
  `currentActivity`, `attention`) and session `readiness` (`ready`, `busy`,
  `requiresAttention`, `unavailable`), eliminating client-side heuristics.
- Transcripts and turn histories persist under `.nevo-ai-local/transcripts/`.
  Boot reconciliation and graceful shutdown interrupt orphaned turns with
  `AI_TURN_INTERRUPTED`, while restart-resumable interactions remain answerable.
- Only one non-terminal turn may be active for a provider/session pair. Retried starts
  with the same idempotency key return that turn; other starts conflict.

## Agent providers
 
### Claude Code integration

Claude Code is integrated through non-interactive process invocations (`claude -p --resume <providerSessionId>`). Interactive turns that require user questions use Nevo's server-owned Streamable HTTP Model Context Protocol (`/mcp`) endpoint:
- Nevo registers an ephemeral MCP server configuration via `--mcp-config` with a scoped, opaque correlation token header.
- The MCP server exposes a canonical `ask_user` tool implemented with the official `@modelcontextprotocol/sdk`.
- When Claude invokes `ask_user`, the server creates a canonical `interaction.requested` (`kind: 'question'`) in the turn's Work hierarchy.
- The user responds in the dashboard UI, resolving the interaction and unblocking the MCP tool call. Claude continues execution in the same logical Turn.
- Transport security uses scoped certificate trust (`NODE_EXTRA_CA_CERTS`) rather than disabling TLS verification.

### Antigravity / Gemini CLI integration

The Antigravity provider spawns `agy` in headless streaming mode (`--output-format stream-json`). Turns are resumed using `--resume <providerSessionId>`. Capabilities are declared honestly:
- `interactiveQuestions: true`: Supported via Nevo's machine-global durable MCP integration (`agy mcp add nevo http://127.0.0.1:<port>/mcp`). When Antigravity models call `ask_question`, Nevo's MCP bridge correlates the tool invocation to the active turn, creating a canonical `interaction.requested` (`kind: 'question'`) in the turn's Work hierarchy. When the user responds in the dashboard, the tool unblocks and Antigravity continues in the same logical Turn.
- `interactivePermissions: false`: Antigravity relies on its autonomous CLI execution policy.
- `canOverrideTurnModel: true`: Allows selecting or overriding the model dynamically for new turns.
- `diagnostic raw capture`: Exact raw stdout and stderr lines can be recorded before any provider processing for protocol analysis.


### Local AI provider configuration

AI provider enablement is workstation-local. Configure the providers that the dashboard may
register in the ignored `.nevo-ai-local/ai-providers.yaml` file:

  ```yaml
  version: 1
  providers:
    claude:
      enabled: true
    antigravity:
      enabled: true
      transport:
        print_timeout_seconds: 86400
      diagnostics:
        raw_responses:
          enabled: true
          directory: .nevo-ai-local/antigravity_raw
    codex:
      enabled: true
    mock:
      enabled: false
  ```

The file is the complete local allow-list: only entries present with `enabled: true` are
registered, in file order. If the file is missing, empty, or contains no enabled entries, no AI
provider is registered. The dashboard's session-creation surfaces explain where to enable a
provider, while a previously recorded session whose provider is no longer enabled remains
visible but cannot start another turn. The configuration is read when the dashboard AI service
starts, so restart the dashboard after editing it.

Antigravity CLI 1.1.23 requires a finite `--print-timeout` in print mode and does not document a
supported disable value. NEvo therefore treats this as an explicit provider-transport constraint,
passes it in Go duration form on every invocation, and defaults it to 86,400 seconds (24 hours).
Configure `providers.antigravity.transport.print_timeout_seconds` with a positive integer when a
different transport ceiling is required. This deadline is not the neutral protocol-silence timeout:
protocol silence remains owned by the Turn lifecycle coordinator and is suppressed during evidenced
tool/user waits. It is also not the neutral maximum-Turn policy, which remains disabled by default.
If the CLI deadline fires, the provider reports `AI_PROVIDER_TIMEOUT` with
`source=antigravity_cli` and `timeoutKind=provider_transport`; the coordinator still owns the one
terminal Turn transition and its arbitration against cancellation or late provider evidence.

Antigravity raw capture is independently opt-in and defaults to disabled. Its directory must
be relative to and remain inside the repository. Each canonical provider session gets its own
`<directory>/<providerSessionId>/raw.ndjson` and `session.json`; every turn-scoped envelope
carries both the canonical `providerSessionId` and the Nevo `turnId`. Provisional records are
migrated and rewritten when Antigravity allocates the canonical conversation ID. File write
failures remain isolated from turn execution, while terminal/disposal boundaries flush queued
writes on a bounded best-effort basis. Raw diagnostics can contain prompts, provider output,
tool inputs, paths, and errors; treat the configured directory as sensitive local operator
data. To clear the default recordings, remove `.nevo-ai-local/antigravity_raw`.

### OpenAI Codex integration

The Codex provider uses one lazily started, persistent
`codex app-server --listen stdio://` process per dashboard AI service. A narrow JSONL
client owns initialization, request correlation, server requests, failure fan-out, and
bounded disposal. The Codex provider keeps Codex thread, turn, item, and protocol
request IDs private and exposes only the existing provider-neutral runtime contracts.

Codex `thread.id` is the sole `providerSessionId`. New sessions call `thread/start`;
recorded sessions are loaded once per app-server process with `thread/resume`, and a
failed resume never creates replacement history. The provider supports resumable
sessions, cancellation, interactive command/file/permission requests, user questions,
tool lifecycle, readable reasoning, and token usage. `steerTurn` and `planUpdates` are
reported as `false` in the first implementation and have no hidden HTTP or transcript
behavior.

Codex output retains its protocol meaning. An `agentMessage` with
`phase: final_answer` becomes normal assistant transcript text; `phase: commentary`
becomes the neutral ordered `progress.delta` activity event and is not projected into
the conversation; reasoning items remain the separate `reasoning.delta`/reasoning view.
Agent-message deltas carry no phase, so the provider routes them through private item
correlation. Phase is optional: a later authoritative completed item may supply it;
otherwise superseded completed messages become progress and the final remaining
unphased message is the legacy final answer only when no explicit final answer exists.
Unknown non-null or conflicting phases fail closed. This mapping does not alter Codex
reasoning-effort configuration.

Codex terminal notifications are status-first. An authoritative `interrupted` turn maps
to cancellation/interruption and a `failed` turn maps to provider failure even when the
app-server omits `item/completed` for activity that was still active. Any unfinished
normalized tool is closed as failed so it cannot remain running in the UI. For an
authoritative successful turn, unfinished tool/action outcomes and the final assistant
answer remain protocol errors; unfinished reasoning, input, or commentary activity alone
does not invalidate the successful turn. Legacy unphased agent messages keep the
deterministic rule above: the last candidate must complete authoritatively before it can
be used as the final answer.

Execution modes use schema-verified Codex fields:

- `ask` uses a read-only sandbox with no approval prompts, preserving non-mutating
  analysis.
- `edit` uses workspace-write with interactive safeguards.
- `agent` uses workspace-write with `on-request` approval at thread/resume and turn
  level. Normal repository work stays sandboxed; operations blocked by the Windows
  sandbox, including host tool access or protected Git metadata, can request explicit
  user approval and then continue the same live turn. The restricted network default
  remains unchanged.

Execution mode and permission policy remain partially coupled in this first provider.
FU-002 records the later provider-neutral split between ASK/EDIT/AGENT intent and
read-only/workspace-with-escalation/full-access policy, including possible allow-once
versus remembered session rules. No remembered approval rule is implemented here.

The client opts into the experimental API so it can receive the required
`item/tool/requestUserInput` interaction; the provider consumes no unrelated
experimental methods. Approval grants are turn-scoped; Nevo does not expose or select
Codex session-scoped grants. Provider-global notifications are accepted outside turns
and ignored unless the provider consumes them. Codex approvals and questions use
`resumePolicy: live-operation` because their private app-server request correlation
cannot be reconstructed after the owning process or connection disappears.

The compact compatibility inventory is stored in
`tools/dashboard/server/ai/providers/codex/protocol-baseline.json`; the full generated
schema is never committed. Refresh the inventory only after inspecting a selected Codex
version, then verify it:

```bash
node tools/dashboard/server/ai/providers/codex/verify-schema.mjs --strict
```

The verifier generates schemas under the OS temporary directory, compares every
consumed method/type plus the optional `agentMessage.phase` enum, removes the bundle,
and reports the exact Codex version. Without
Codex installed, the non-strict command reports a clear skip. Version-specific runtime
evidence and the distinction between observation and contract remain in
[Codex app-server protocol research](codex-app-server-research.md).

## Four-layer event normalization pipeline

The AI runtime enforces a strict four-layer architecture for streaming deltas, work items, and public events:

1. **Layer 1: Provider-Private Representations**:
   Raw stdio bytes, process handles, JSON-RPC envelopes, and provider-specific frames (e.g. Codex app-server JSONL, Claude hook stdout/stderr, Antigravity streaming JSON). These never escape the provider adapter boundary.
2. **Layer 2: Internal Semantic Events**:
   Internal events emitted by adapters into `TurnLifecycleCoordinator`:
   - `final_answer.delta`: Assistant final answer text deltas.
   - `commentary.delta`: Ephemeral operational narration.
   - `reasoning.delta`: Internal reasoning/thinking tokens.
   - `tool.started`, `tool.updated`, `tool.completed`: Structured tool calls.
   - `interaction.requested`, `interaction.resolved`: Human-in-the-loop interactions.
   - Channel separation: `commentary` narration is strictly separated from `finalAnswer` text and is never promoted into assistant final answers.
3. **Layer 3: Server-Canonical Events**:
   Normalized, sanitized events emitted on `TurnEventStream` and dispatched over SSE:
   - `final_answer.delta` maps to `text.delta` (with canonical `messageId`).
   - `commentary.delta` maps to `progress.delta` (with canonical `progressId`).
   - Strict sanitization: all provider-private fields (`providerRequestId`, `rawPayload`, `rawBytes`, `rpcEnvelope`, `providerEventId`, `childPid`) are stripped before emission.
   - Authoritative Tool Closure: on turn completion or failure, any lingering active/queued tools are authoritatively finalized with `status: 'failed'` and an explicit `closureReason` (`turn_completed`, `turn_failed`), preventing dangling tool spinners in clients.
4. **Layer 4: Browser Presentation**:
   Projections consumed by React and Redux UI stores.

## Model catalogs, trait representation, and permissive overrides

- **Provider-Owned Discovery**:
  Each provider adapter implements `listModels()`:
  - Claude Code exposes curated models (`CLAUDE_CURATED_MODELS`) supplemented by user configuration.
  - Codex discovers models dynamically from the running app-server via `model/list`.
  - Antigravity discovers models dynamically via the `agy models` CLI command.
- **Permissive Model Passthrough**:
  Providers declaring `canOverrideTurnModel: true` allow operators to pass arbitrary custom model identifiers without framework rejection. Validations fail open rather than enforcing rigid enums.
- **Advisory Model Traits**:
  Models declare optional, evidence-based traits (`validateAgentModelTraits`):
  - `supportsReasoning`: Boolean indicating whether reasoning tokens or thinking is supported.
  - `supportedReasoningEfforts`: List of valid reasoning effort tiers (e.g. `['low', 'medium', 'high']`).
  - `defaultReasoningEffort`: Default reasoning tier.
  - `inputModalities`: Supported inputs (e.g. `['text', 'image']`).
  - `supportsVision`: Boolean indicating image/vision input capability.
  - `maxContextTokens`: Maximum context window size.

## Canonical error taxonomy and neutral recovery hints

Failures across all adapters are categorized into canonical `AI_FAILURE_CODES` with deterministic HTTP statuses and neutral recovery hints:

| Failure Code | HTTP Status | Neutral Recovery Hint | Description |
|---|---|---|---|
| `AI_AUTH_FAILED` | 401 | `operator-action` | Missing or expired credentials / API keys. |
| `AI_POLICY_DENIED` | 403 | `operator-action` | Operation forbidden by provider safety policy or permissions. |
| `AI_RATE_LIMITED` | 429 | `retry-after-delay` | Rate limit (TPM/RPM) exceeded. Per-turn failure isolated from provider descriptor health. |
| `AI_QUOTA_EXHAUSTED` | 429 | `alternate-provider` | Account quota depleted. |
| `AI_PROVIDER_UNAVAILABLE`| 503 | `retry-after-delay` | Provider service unavailable or down. |
| `AI_TRANSPORT_ERROR` | 502 | `retry-after-delay` | Network connection drop or HTTP proxy error. |
| `AI_PROVIDER_TIMEOUT` | 504 | `none` | Provider-side execution or print timeout exceeded. |
| `AI_RUNTIME_TIMEOUT` | 504 | `new-turn` | Turn idle watchdog timeout (inactivity with no tools/user pending). |
| `AI_PROTOCOL_ERROR` | 502 | `new-session` | Malformed JSON-RPC or protocol frame violation. |
| `AI_UNSUPPORTED_OPERATION`| 409 | `none` | Capability not supported by provider. |
| `AI_OPERATION_LOST` | 500 | `none` | Communication handle or process dropped without terminal protocol frame. |
| `AI_PROVIDER_EXECUTION_ERROR`| 502 | `new-turn` | General process exit failure or crash. |

**Error Isolation**: Per-turn failures (such as a 429 rate limit or unexpected process exit) never mutate provider descriptor health (`installed: false` or `enabled: false`). Descriptor availability reflects installation and authentication facts only.

## Process lifecycle, tree termination, and turn recovery

- **Cross-Platform Process Tree Termination**:
  When a turn is cancelled, timed out, or force-cleaned, `terminateChildProcess` terminates the entire process tree:
  - **Windows**: Uses `taskkill /pid <pid> /T /F` to reliably tear down parent and descendant processes (e.g. `cmd.exe`, `powershell.exe`, compiler subprocesses) without leaving zombie processes holding filesystem locks.
  - **POSIX**: Sends `SIGTERM` to the negative process group ID (`-pid`), escalating to `SIGKILL` after a configurable grace timeout (`forceGraceMs`).
- **Epistemic Truth & Operation Lost**:
  If a provider process exits or communication drops without an authoritative terminal frame, the turn enters `status: 'unknown'` with code `AI_OPERATION_LOST`. The runtime never fabricates `outcome: 'failed'` or `outcome: 'completed'` without protocol evidence.
- **Remote Turn Recovery**:
  While a turn is in `status: 'unknown'`, session turn queues reject new turns (`409 Conflict`). Remote clients can invoke the recovery API:
  - `POST /api/agent-sessions/:provider/:providerSessionId/turns/:turnId/recover`
  - Or `POST .../turns/:turnId/cancel` with `{ action: 'force_cleanup' }`.
  Recovery terminates any residual process trees, settles the canonical turn as `outcome: 'interrupted'` with `cause: 'forced_cleanup'`, and releases the session turn lock (`#activeBySession`), allowing remote clients to resume work without physical machine access.

## Verify the integration

Run the tooling, server/browser contract, production build, generated-index, and
ignore-rule checks:

```bash
node --test tools/tests/*.test.mjs
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
node tools/dashboard/server/ai/providers/codex/verify-schema.mjs
node tools/specs.mjs check
node tools/docs.mjs check
git check-ignore .nevo-ai-local/probe
```
