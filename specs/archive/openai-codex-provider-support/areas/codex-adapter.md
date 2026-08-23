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
- Map `agentMessage.phase=final_answer` to normal assistant text, commentary to neutral
  `progress.delta`, and reasoning items to `reasoning.delta`. Correlate deltas through
  their item because the delta notification has no phase. Apply D10's deterministic
  missing-phase fallback; never concatenate commentary or reasoning into final text.
  Treat final items and `turn/completed` as authoritative and avoid duplicate text/tool
  terminals.
- Normalize command execution, file change, permission-subset, and user-input server
  requests. Maintain private JSON-RPC-request-to-neutral-interaction correlation and
  continue the original turn after responses. Mark these interactions `live-operation`;
  they are reconnectable within the current runtime but not reconstructable after its
  app-server request correlation is lost.
- Map Nevo modes to current generated-schema fields while preserving ask/edit/agent
  semantics. AGENT remains `workspace-write` but uses `on-request` at thread/resume and
  turn level so blocked host tools or Git metadata operations can enter the existing
  approval roundtrip; ASK remains read-only. Stop for owner input if current Codex
  cannot express these safely.
- On dispose or app-server failure, fail active turns and pending interactions closed.
- Register the provider alongside Claude, Antigravity, and mock, and update maintainer
  documentation.

## Area-specific acceptance criteria

- Focused fake-client/process tests cover initialization, create, resume, multi-turn,
  normal streaming, final/commentary/reasoning separation, missing-phase fallback,
  deltas, authoritative completion, approvals, user input, cancellation while
  running/waiting, usage, the input user-message item,
  provider-global notifications, failure, correlation, and cleanup.
- Integration-style fake app-server tests prove AGENT sends on-request policy, exposes
  live permission interactions for host tooling and Git workflows, answers the original
  request for allow/deny, and continues the same turn.
- No event/browser payload includes raw Codex JSON-RPC IDs or payload objects.
- Existing provider and dashboard integration tests remain unchanged in behavior except
  for the additive Codex descriptor/capability/event contracts.

## Out of scope

Codex-specific UI, session-scoped approval persistence, thread management beyond
start/resume, steering/plan-update implementation, and authenticated live calls in the
default test suite.
