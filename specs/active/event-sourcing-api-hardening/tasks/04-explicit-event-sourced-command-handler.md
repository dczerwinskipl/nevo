---
id: event-sourcing-api-hardening.explicit-event-sourced-command-handler
status: draft
change: event-sourcing-api-hardening
depends_on:
  - es-command-executor-and-ambiguity-resolution
semantic_references:
  decisions: [D1]
  dependency_contracts: [es-command-executor-and-ambiguity-resolution]
context:
  required:
    - specs/active/event-sourcing-api-hardening/areas/shared-es-execution-and-explicit-handler.md
    - specs/active/event-sourcing-api-hardening/owner-decisions.md
    - src/NEvo.Ddd.EventSourcing/Handling/DeciderCommandHandler.cs
    - src/NEvo.Ddd.EventSourcing/Deciding/AggregateDecider.cs
  optional: []
allowed_paths:
  - src/NEvo.Ddd.EventSourcing/**
  - tests/NEvo.Ddd.EventSourcing.Tests/**
forbidden_paths:
  - src/NEvo.Messaging/**
  - src/NEvo.Messaging.Cqrs/**
  - examples/**
---

# Task: Explicit Event Sourced command handler (Level 2)

## Goal

Add a first-class explicit Event Sourced handler abstraction (conceptually
`IEventSourcedCommandHandler<TCommand, TAggregate, TId>`) for commands that need
orchestration but should still use the framework-managed ES lifecycle — routed through
task 03's shared executor, able to delegate to Level 1's own decision-method discovery
rather than duplicating the aggregate's transition logic (D1).

## Dependencies

- `es-command-executor-and-ambiguity-resolution` (task 03) — this handler routes through
  that executor for load/authorize/append/publish; it does not reimplement any of it.

## Implementation constraints

- The handler receives the already-rehydrated aggregate/current state and the command
  (the executor performs load/rehydration before invoking it) and may use injected
  dependencies for orchestration/I-O before delegating to a domain decision. It must not
  require the user to write repository/replay/version/append plumbing.
- Provide a way for an explicit handler to delegate to the same decision-method
  discovery Level 1 uses (task 03's resolution algorithm) — e.g. a helper the handler
  can call with the rehydrated state and command, returning the same
  `Either<Exception, IEnumerable<TEvent>>` shape a convention decider method would
  produce — so the transition logic itself is written once, not duplicated between
  Level 1 and Level 2 for the same aggregate.
- The exact public interface/type name may differ from
  `IEventSourcedCommandHandler<TCommand, TAggregate, TId>` if grounding this task's
  implementation against current NEvo naming conventions (e.g. existing `I*Handler<T>`
  shapes in `NEvo.Messaging.Cqrs`) suggests a cleaner name — propose it in this task's
  own diff/PR description; this is not an owner-gate stop, per the input specification's
  own framing ("exact public type name may be refined by the spec").

## Acceptance criteria

1. An explicit Level 2 handler for a command routes through task 03's executor for
   load/append/publish — proven by an integration test asserting identical
   load/append/publish ordering to a Level 1 convention command (automated).
2. An example explicit handler in this task's own tests delegates to Level 1's decision-
   method discovery instead of duplicating a transition, proven by a test showing the
   same aggregate transition produces identical resulting events whether triggered via
   Level 1 directly or via this Level 2 handler delegating to it (automated).
3. The handler can use a constructor-injected dependency for orchestration before
   delegating to the decision, proven by a test with a fake injected dependency
   (automated).

## Verification

```
dotnet build
dotnet test tests/NEvo.Ddd.EventSourcing.Tests
```

## Documentation impact

None in this task — covered by tasks 11 (user-facing) and 12 (internal).

## Out of scope

- Handler registration/Primary role assignment (task 05).
- Any change to task 03's executor itself beyond what's needed to invoke it from this
  new handler type.
