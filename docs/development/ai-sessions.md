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

## Verify Part 1

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

The mock walkthrough should cover list, create, open, normal streaming, permission,
question, reload/reconnect, and read-only completed sessions at desktop and phone
widths.
