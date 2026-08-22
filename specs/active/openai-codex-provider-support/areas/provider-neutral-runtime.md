# Area: Provider-neutral persistent-turn contracts

## Responsibility

Extend the current AI contracts only where a persistent bidirectional provider proves a
gap, while preserving ADR-0007 and existing provider behavior.

## Current state

`AiSessionService#createSession` preallocates a UUID; `AiTurnRuntime` assumes a finite
post-interaction continuation, does not call the adapter when cancelling a waiting
turn, and has no steering/plan/disposal path. Capability and frontend drift tests lock
the current eight keys and twelve event types.

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
- Add neutral `steerTurn` and `planUpdates` capability flags, a correlated active-turn
  steering operation, and validated `plan.updated` events with ordered entries.
- Update transcript/server/frontend transport contracts and exact-key drift tests, but
  add no new visual behavior.

## Interfaces and boundaries

Generic code sees only Nevo turn IDs, session identity, normalized plan entries, and
capabilities. Provider turn/request identifiers remain inside adapter private operation
state. Existing adapters explicitly normalize new capability flags to false.

## Area-specific acceptance criteria

- Provider-created sessions bind only after the provider returns a valid ID, and failure
  leaves no speculative binding.
- A continued interaction cannot synthesize `turn.completed`; real adapter completion
  remains authoritative.
- Cancelling a waiting turn with a live provider operation invokes `cancelTurn` exactly
  once and clears the pending interaction.
- Steering rejects terminal, wrong-session, unsupported, and mismatched turns before
  invoking the provider; accepted steering records the user input deterministically.
- Plan events validate, replay, and persist without provider-private fields.
- Shutdown calls each optional adapter disposal once and does not regress existing
  runtime shutdown tests.

## Out of scope

Provider-specific request shapes, plan rendering, steering UI, and changing the meaning
of existing Claude/Antigravity execution modes.
