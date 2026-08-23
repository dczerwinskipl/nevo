---
id: openai-codex-provider-support.codex-app-server-client
status: draft
change: openai-codex-provider-support
context:
  required:
    - specs/active/openai-codex-provider-support/overview.md
    - specs/active/openai-codex-provider-support/owner-decisions.md
    - specs/active/openai-codex-provider-support/areas/app-server-client.md
    - docs/development/ai-sessions.md
    - docs/development/codex-app-server-research.md
    - docs/development/testing-strategy.md
    - tools/ai/contracts.mjs
    - tools/ai/process-termination.mjs
    - tools/ai/claude-adapter.mjs
    - tools/ai/antigravity-adapter.mjs
    - tools/tests/claude-adapter.test.mjs
    - tools/tests/antigravity-adapter.test.mjs
  optional: []
semantic_references:
  decisions: [D1, D6, D7, D8]
  constraints: [C1, C2, C5, C6, C7, C8, C9, C11, C12]
allowed_paths:
  - tools/ai/codex-app-server-client.mjs
  - tools/ai/codex-protocol-baseline.json
  - tools/ai/verify-codex-schema.mjs
  - tools/tests/codex-app-server-client.test.mjs
  - tools/tests/codex-schema-compat.test.mjs
  - tools/tests/fixtures/codex-app-server/**
forbidden_paths:
  - tools/ai/contracts.mjs
  - tools/ai/registry.mjs
  - tools/ai/service.mjs
  - tools/ai/turn-runtime.mjs
  - tools/ai/claude-adapter.mjs
  - tools/ai/antigravity-adapter.mjs
  - tools/dashboard/**
  - src/**
  - tests/NEvo.*/**
---

# Task: Narrow Codex app-server client and schema compatibility boundary

## Goal

Build a provider-private, persistent stdio JSONL client for the exact app-server
contract consumed by Nevo, with generated-schema verification and exhaustive fake
process tests. Do not implement event normalization or dashboard registration here.

## Implementation constraints

- Before finalizing contract fixtures, run the implementation-time Codex executable's
  `app-server generate-json-schema` command and record its version plus the consumed
  method/type inventory in `codex-protocol-baseline.json`. If the generated schema
  materially contradicts `overview.md`, stop for owner direction rather than adapting
  requirements silently.
- Spawn `codex app-server --listen stdio://` lazily with `shell: false`, piped
  stdin/stdout, and bounded stderr retained only for safe diagnostics.
- Model wire envelopes narrowly: request `{method, params, id}`, response with exactly
  one of `result`/`error`, and notification `{method, params}`. Do not require or send a
  `jsonrpc` member because official app-server omits it on the wire. Do not reject an
  otherwise well-formed incoming envelope solely because it includes the harmless
  `jsonrpc: "2.0"` member accepted by Codex CLI `0.149.0`, unless the selected generated
  schema explicitly requires rejection.
- Perform one `initialize` request with stable Nevo client metadata and only the required
  client capabilities, then send `initialized`. Gate all other requests on successful
  initialization; repeated concurrent starts share the same promise/process.
- Use explicit generated request IDs and a map. Responses may arrive out of order;
  duplicate/unknown IDs are protocol corruption, never an ignorable warning.
- Parse arbitrary stdout chunk boundaries and multiple lines per chunk. Classify
  response, notification, and server request without positional assumptions. Keep raw
  envelopes inside this module.
- Accept well-formed provider-global notifications without active thread/turn
  correlation and ignore them when outside the consumed inventory. Fixtures include
  the version-observed remote-control, MCP-startup, and skills notifications without
  promoting their payload shapes into stable contracts.
- Provide subscription/dispatch seams for the adapter's consumed notifications and
  server requests, plus a single-use response object/function that cannot answer one
  server request twice.
- On malformed JSON/envelope, initialization error, child `error`/unexpected `exit`,
  unknown correlation, handler failure, or disposal, reject all pending request and
  active-waiter promises with safe `AiError` codes. Do not resolve any request as
  success after the failure boundary trips.
- Disposal is idempotent and bounded. It rejects new sends, closes stdin, removes
  listeners, and uses the existing process-termination helper if graceful close does
  not finish.
- The verifier generates schemas only under an OS temporary directory, removes them,
  uses no network/new package, reports exact checked Codex version, and supports both
  explicit skip (default when Codex is absent) and strict failure mode.

## Acceptance criteria

1. Initialization is emitted once and before any thread/turn request, with
   `initialized` sent only after a successful response.
   `automated: node --test tools/tests/codex-app-server-client.test.mjs`
2. Requests with out-of-order responses resolve to their own IDs, and concurrent
   callers never correlate by position.
   `automated: node --test tools/tests/codex-app-server-client.test.mjs`
3. Fixture tests cover partial JSONL chunks, multiple messages per chunk, successful
   responses, JSON-RPC errors, notifications, server requests, one-response-only
   enforcement, optional incoming `jsonrpc`, and ignored unknown/provider-global
   well-formed notifications outside active turns.
   `automated: node --test tools/tests/codex-app-server-client.test.mjs`
4. Malformed JSON/envelopes, duplicate/unknown response IDs, initialization failure,
   process error/exit, and disposal reject every pending operation and cannot later
   produce success.
   `automated: node --test tools/tests/codex-app-server-client.test.mjs`
5. Disposal is idempotent, bounded, removes listeners, and leaves no pending map entries
   or live fake process.
   `automated: node --test tools/tests/codex-app-server-client.test.mjs`
6. The compact compatibility baseline and verifier prove that every consumed
   thread/turn/item/approval/user-input/usage/reasoning method or type exists in the
   generated schema, without committing the full bundle.
   `automated: node --test tools/tests/codex-schema-compat.test.mjs`
7. With Codex installed, strict schema verification passes and reports the checked
   version; without Codex, the default command reports a clear skip.
   `inspection: run node tools/ai/verify-codex-schema.mjs --strict in a Codex-enabled implementation environment and retain the result in the task self-check/handoff`

## Verification

```text
node --test tools/tests/codex-app-server-client.test.mjs tools/tests/codex-schema-compat.test.mjs
node tools/ai/verify-codex-schema.mjs
node tools/specs.mjs check
```

## Out of scope

WebSocket/Unix transports, automatic process restart, adapter event normalization,
provider registration, account/auth methods, `turn/steer`/plan-update consumption, and
a general app-server SDK.
