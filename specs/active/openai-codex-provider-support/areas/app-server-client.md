# Area: Codex app-server client

## Responsibility

Own the Codex process and narrow bidirectional protocol boundary: initialization,
request/response correlation, notifications, server requests, schema compatibility,
failure fan-out, and disposal.

## Requirements

- Lazily spawn one `codex app-server --listen stdio://` process per client/adapter
  instance with piped stdin/stdout and captured bounded stderr diagnostics.
- Send one `initialize` request with Nevo client metadata, validate its response, then
  send `initialized` before allowing other requests.
- Generate unique explicit request IDs and correlate responses through a map; concurrent
  requests may resolve in any order.
- Parse newline-delimited JSON incrementally across chunk boundaries. Reject malformed
  messages, responses with neither result nor error, duplicate/unknown response IDs,
  and invalid consumed notification/server-request shapes.
- Route notifications and server requests to subscribers without exposing raw messages
  above the Codex adapter boundary. Provide exactly one response path for every handled
  server request.
- Reject all pending requests and active-turn waiters on initialization failure,
  unexpected process error/exit, protocol corruption, or disposal.
- Make disposal idempotent and bounded; stop new requests, close stdin, terminate when
  needed, and leave no unresolved promises/listeners.
- Add a small version/method/type compatibility baseline and a Node-built-in verifier
  around `codex app-server generate-json-schema --out <temporary-directory>`.

## Protocol scope

The narrow client needs only initialization plus the thread/turn methods, event
notifications, approval/user-input server requests, usage/reasoning/plan/item lifecycle,
and errors enumerated in `overview.md`. Unknown well-formed notifications outside this
inventory may be ignored for forward compatibility; an unknown server request affecting
active work receives a protocol error and fails that work closed.

## Area-specific acceptance criteria

- Fixture tests cover split/multiple JSONL chunks, out-of-order request responses,
  JSON-RPC errors, notifications, server requests and replies, initialization ordering,
  process error/exit, malformed JSON, unknown correlation, and idempotent disposal.
- Tests prove no positional correlation and no success resolution after a client-level
  failure.
- Schema verification checks the exact implementation-time Codex version and consumed
  names/shapes without committing the full generated schema bundle.

## Out of scope

WebSocket/Unix transports, automatic restart/retry of failed app-server processes,
account/auth flows, and general-purpose exposure of the full app-server API.
