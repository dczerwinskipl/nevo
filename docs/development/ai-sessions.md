---
id: development.ai-sessions
type: development
title: Local AI sessions
status: current
read_when:
  - working on dashboard AI sessions
  - verifying the provider-neutral AI runtime
  - adding an AI provider adapter
summary: >
  Provider-neutral dashboard AI sessions, mock-mode setup, runtime boundaries,
  trusted-network access, and Part 1 verification.
related:
  - development.local-setup
  - development.architecture-overview
  - development.codex-app-server-research
  - adr.0007-provider-neutral-ai-sessions
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

The browser uses provider-neutral HTTP endpoints under `/api/ai` for providers,
sessions, messages, turns, interaction responses, and cancellation. Live turn output
uses Server-Sent Events. The browser never receives provider-private request IDs or
raw provider payloads.

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
- The Part 1 turn runtime, mock sessions, replay buffers, and pending interactions are
  in memory. Restarting the dashboard clears created mock sessions and live turns;
  seeded demonstration sessions are recreated deterministically.
- Only one non-terminal turn may be active for a provider/session pair. Retried starts
  with the same idempotency key return that turn; other starts conflict.
- Every pending interaction declares a neutral `resumePolicy`. `restart` means a fresh
  provider invocation can reconstruct the continuation; `live-operation` means the
  interaction is answerable only while its original provider operation remains alive.
  Boot reconciliation and graceful shutdown interrupt stale `live-operation` turns and
  clear their pending interaction, while `restart` interactions remain resumable.
- A future local registry may store correlation evidence under `/.nevo-ai-local/`.
  That directory is local operator state, ignored by Git, and is not provider history.

## Provider adapters
 
### Claude Code integration
 
Claude Code (version >= 2.1.89) is integrated through non-interactive process invocations (`claude -p --resume <providerSessionId>`). Interactive turns that require user input (interactive questions via `AskUserQuestion` or permission prompts for sensitive operations like `Bash` or `WriteFile`) use the native `PreToolUse` hook deferral mechanism:
- When a tool is deferred (`permissionDecision: "defer"`), the Claude CLI process exits with `stop_reason: "tool_deferred"` and outputs the `deferred_tool_use` payload.
- NEvo maps this payload to a normalized `interaction.requested` event (`kind: 'question'` or `kind: 'permission'`).
- The user responds via the dashboard UI.
- NEvo resumes the session with the user's answers or allow/deny decision passed back to the hook as `updatedInput` / `permissionDecision`, allowing execution to continue.
- Known limitation: `PreToolUse/defer` does not support deferrals across multiple parallel tool calls in a single batch.

### Antigravity / Gemini CLI integration

The Antigravity CLI adapter spawns `agy` in headless streaming mode (`--output-format stream-json`). Turns are resumed using `--resume <providerSessionId>`. Capabilities are declared honestly:
- `interactiveQuestions: true`: single-choice and multi-choice question prompts are supported.
- `interactivePermissions: false`: Antigravity relies on autonomous execution policy; interactive permission hooks throw `CapabilityNotSupportedError` if requested directly.
- `diagnostic raw capture`: exact raw stdout and stderr lines are recorded before any adapter
  processing for protocol analysis. Configure it in the repository-root
  `ai-adapters.yaml`:

  ```yaml
  version: 1
  adapters:
    antigravity:
      diagnostics:
        raw_responses:
          enabled: true
          directory: .nevo-ai-local/antigravity_raw
  ```

  The file and both fields are optional; the defaults preserve the current behavior shown
  above (enabled, in `.nevo-ai-local/antigravity_raw`). The configuration is read when the
  dashboard AI service starts, so restart the dashboard after editing it. The directory must
  be relative to and remain inside the repository. Set `enabled: false` to disable capture. Each canonical
  provider session gets its own `<directory>/<providerSessionId>/raw.ndjson` and
  `session.json`; every turn-scoped envelope carries both the canonical
  `providerSessionId` and the Nevo `turnId`. Provisional records are migrated and rewritten
  when Antigravity allocates the canonical conversation ID. File write failures remain
  isolated from turn execution, while terminal/disposal boundaries flush queued writes on a
  bounded best-effort basis. Raw diagnostics can contain prompts, provider output, tool inputs, paths,
  and errors; treat the configured directory as sensitive local operator data. To clear the
  default recordings, remove `.nevo-ai-local/antigravity_raw`.

### OpenAI Codex integration

The Codex adapter uses one lazily started, persistent
`codex app-server --listen stdio://` process per dashboard AI service. A narrow JSONL
client owns initialization, request correlation, server requests, failure fan-out, and
bounded disposal. The provider adapter keeps Codex thread, turn, item, and protocol
request IDs private and exposes only the existing provider-neutral runtime contracts.

Codex `thread.id` is the sole `providerSessionId`. New sessions call `thread/start`;
recorded sessions are loaded once per app-server process with `thread/resume`, and a
failed resume never creates replacement history. The adapter supports resumable
sessions, cancellation, interactive command/file/permission requests, user questions,
tool lifecycle, readable reasoning, and token usage. `steerTurn` and `planUpdates` are
reported as `false` in the first implementation and have no hidden HTTP or transcript
behavior.

Codex output retains its protocol meaning. An `agentMessage` with
`phase: final_answer` becomes normal assistant transcript text; `phase: commentary`
becomes the neutral ordered `progress.delta` activity event and is not projected into
the conversation; reasoning items remain the separate `reasoning.delta`/reasoning view.
Agent-message deltas carry no phase, so the adapter routes them through private item
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

Execution mode and permission policy remain partially coupled in this first adapter.
FU-002 records the later provider-neutral split between ASK/EDIT/AGENT intent and
read-only/workspace-with-escalation/full-access policy, including possible allow-once
versus remembered session rules. No remembered approval rule is implemented here.

The client opts into the experimental API so it can receive the required
`item/tool/requestUserInput` interaction; the adapter consumes no unrelated
experimental methods. Approval grants are turn-scoped; Nevo does not expose or select
Codex session-scoped grants. Provider-global notifications are accepted outside turns
and ignored unless the adapter consumes them. Codex approvals and questions use
`resumePolicy: live-operation` because their private app-server request correlation
cannot be reconstructed after the owning process or connection disappears.

The compact compatibility inventory is stored in
`tools/ai/codex-protocol-baseline.json`; the full generated schema is never committed.
Refresh the inventory only after inspecting a selected Codex version, then verify it:

```bash
node tools/ai/verify-codex-schema.mjs --strict
```

The verifier generates schemas under the OS temporary directory, compares every
consumed method/type plus the optional `agentMessage.phase` enum, removes the bundle,
and reports the exact Codex version. Without
Codex installed, the non-strict command reports a clear skip. Version-specific runtime
evidence and the distinction between observation and contract remain in
[Codex app-server protocol research](codex-app-server-research.md).

## Verify the integration

Run the tooling, server/browser contract, production build, generated-index, and
ignore-rule checks:

```bash
node --test tools/tests/*.test.mjs
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
node tools/ai/verify-codex-schema.mjs
node tools/specs.mjs check
node tools/docs.mjs check
git check-ignore .nevo-ai-local/probe
```
