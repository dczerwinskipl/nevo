# Area: Provider-neutral persistent-turn contracts

## Responsibility

Extend the current AI contracts only where a persistent bidirectional provider proves a
gap, while preserving ADR-0007 and existing provider behavior.

## Current state

`AiSessionService#createSession` preallocates a UUID; `AiTurnRuntime` assumes a finite
post-interaction continuation, does not call the adapter when cancelling a waiting
turn, and has no disposal path. Capability and frontend drift tests lock the current
eight keys and twelve event types. Steering and plans have no neutral operation/event
contract; D8 keeps those implementations deferred.

## Requirements

- Allow an adapter to create/materialize its provider session and return the authoritative
  ID before `AgentSessionBindingService` writes a binding; keep the UUID fallback for
  existing adapters.
- Let `respondInteraction` signal that the original provider turn is still running so
  only its later terminal notification completes the Nevo turn.
- Retain enough private operation state to call provider cancellation in both `running`
  and `waitingForUser`; preserve the one-terminal-event invariant.
- Add optional idempotent adapter disposal and invoke it from runtime/service/server
  shutdown without requiring Claude, Antigravity, or mock to own a persistent process.
- Add neutral `steerTurn` and `planUpdates` capability flags with false defaults and
  update exact-key descriptor/type drift tests. Do not add a steering operation,
  `plan.updated` event, transcript projection, HTTP control, or visual behavior.

## Interfaces and boundaries

Generic code sees only Nevo turn IDs, session identity, normalized existing events, and
capabilities. Provider turn/request identifiers remain inside adapter private operation
state. Existing adapters and Codex explicitly normalize the new capability flags to
false.

## Area-specific acceptance criteria

- Provider-created sessions bind only after the provider returns a valid ID, and failure
  leaves no speculative binding.
- A continued interaction cannot synthesize `turn.completed`; real adapter completion
  remains authoritative.
- Cancelling a waiting turn with a live provider operation invokes `cancelTurn` exactly
  once and clears the pending interaction.
- Exact capability contracts expose `steerTurn: false` and `planUpdates: false` for
  existing providers and the first Codex adapter, with no new operation/event surface.
- Shutdown calls each optional adapter disposal once and does not regress existing
  runtime shutdown tests.

## Out of scope

Provider-specific request shapes, steering execution, normalized plan-update events,
plan rendering, steering UI, and changing the meaning of existing Claude/Antigravity
execution modes.
