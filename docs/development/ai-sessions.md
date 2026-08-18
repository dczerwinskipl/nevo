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

## Verify the integration

Run the tooling, server/browser contract, production build, generated-index, and
ignore-rule checks:

```bash
node --test tools/tests/*.test.mjs
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
node tools/specs.mjs check
node tools/docs.mjs check
git check-ignore .nevo-ai-local/probe
```
