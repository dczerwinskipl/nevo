# Area: Codex provider adapter

## Responsibility

Translate Codex threads, turns, items, server requests, and failures into the existing
provider-neutral session/runtime contracts, then register the provider in the default
dashboard service.

## Requirements

- Declare provider id `codex`, honest availability, supported execution modes, and
  capabilities proven by tests, including resumable sessions, cancellation, interactive
  questions/permissions, tools, reasoning, and usage. Declare `steerTurn` and
  `planUpdates` false for the first implementation.
- Use `thread/start` for new sessions and `thread/resume` for recorded IDs not already
  loaded in the current client; use returned `thread.id` as the sole provider session ID.
- Start turns only after the thread is ready, retain the private Codex turn ID, and
  correlate every consumed notification by explicit thread/turn/item/request fields;
  ignore well-formed unrelated provider-global notifications outside active turns.
- Treat user-message item start/completion as input lifecycle only, never assistant/tool
  output or terminal completion.
- Map assistant, reasoning, command/file/tool, usage, completion, interruption,
  error, and cancellation signals as specified in `overview.md`. Treat final items and
  `turn/completed` as authoritative and avoid duplicate text/tool terminals.
- Normalize command execution, file change, permission-subset, and user-input server
  requests. Maintain private JSON-RPC-request-to-neutral-interaction correlation and
  continue the original turn after responses.
- Map Nevo modes to current generated-schema fields while preserving ask/edit/agent
  semantics; stop for owner input if current Codex cannot express them safely.
- On dispose or app-server failure, fail active turns and pending interactions closed.
- Register the provider alongside Claude, Antigravity, and mock, and update maintainer
  documentation.

## Area-specific acceptance criteria

- Focused fake-client/process tests cover initialization, create, resume, multi-turn,
  normal streaming, deltas, authoritative completion, approvals, user input,
  cancellation while running/waiting, usage, reasoning, the input user-message item,
  provider-global notifications, failure, correlation, and cleanup.
- No event/browser payload includes raw Codex JSON-RPC IDs or payload objects.
- Existing provider and dashboard integration tests remain unchanged in behavior except
  for the additive Codex descriptor/capability/event contracts.

## Out of scope

Codex-specific UI, session-scoped approval persistence, thread management beyond
start/resume, steering/plan-update implementation, and authenticated live calls in the
default test suite.
