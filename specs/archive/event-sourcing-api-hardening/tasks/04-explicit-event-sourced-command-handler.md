---
id: event-sourcing-api-hardening.explicit-event-sourced-command-handler
status: draft
change: event-sourcing-api-hardening
depends_on:
  - es-command-executor-and-ambiguity-resolution
semantic_references:
  decisions: [D1, D24, D29, D31]
  dependency_contracts: [es-command-executor-and-ambiguity-resolution]
context:
  required:
    - specs/active/event-sourcing-api-hardening/areas/shared-es-execution-and-explicit-handler.md
    - specs/active/event-sourcing-api-hardening/owner-decisions.md
    - src/NEvo.Ddd.EventSourcing/Handling/DeciderCommandHandler.cs
    - src/NEvo.Ddd.EventSourcing/Deciding/AggregateDecider.cs
  optional:
    - docs/reference/packages/NEvo.Ddd.EventSourcing.md
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
rather than duplicating the aggregate's transition logic (D1), and explicitly
supporting both the creation and existing-aggregate paths via `Option<TAggregate>`
(D24) — this is a real public-API semantic that must be resolved here, not left for a
future task. The handler manages exactly one Event Sourced write target/stream per
command — it may read external data freely via injected dependencies, but does not gain
a multi-aggregate atomic-write capability (D31); it inherits the executor's
`NoStream`/`Exact(version)` expected-stream-state mapping (D29) without needing to
construct that value itself.

## Dependencies

- `es-command-executor-and-ambiguity-resolution` (task 03) — this handler routes through
  that executor for load/authorize/append/publish; it does not reimplement any of it.

## Implementation constraints

- **The handler receives the current state as `Option<TAggregate>` — never a bare
  `TAggregate`, never `null` (D24).** `Some` means an existing stream/aggregate was
  rehydrated; `None` means no existing aggregate/stream state exists (the creation
  path) — mirroring exactly what `DeciderCommandHandler.HandleAsync`
  (`Handling/DeciderCommandHandler.cs:14-34`) already does for Level 1 today. The
  executor performs load/rehydration before invoking the handler and passes this
  explicit Some/None result; the handler may use injected dependencies for
  orchestration/I-O before delegating to a domain decision for either case. It must
  not require the user to write repository/replay/version/append plumbing, must not
  silently assume `Some`, and must not wrap this in a second, parallel
  create-handler abstraction — `ICreateAggregateCommand<TAggregate,TId>` stays
  unwired (D16 unaffected by this task).
- Provide a way for an explicit handler to delegate to the same decision-method
  discovery Level 1 uses (task 03's resolution algorithm) — e.g. a helper the handler
  can call with the rehydrated state and command, returning the same
  `Either<Exception, IEnumerable<TEvent>>` shape a convention decider method would
  produce — so the transition logic itself is written once, not duplicated between
  Level 1 and Level 2 for the same aggregate.
- **The handler manages exactly one Event Sourced write target/stream per command
  execution (D31).** It may freely read external data via injected dependencies before
  deciding, but must not be given a second executor-managed stream to write in the same
  invocation. A use case needing coordinated writes to two or more independently-
  versioned aggregate streams belongs to Level 3 (an ordinary `ICommandHandler<T>`) or a
  future saga/process-manager capability — not this handler type, and not designed here.
- The handler does not construct or pass an expected-stream-state value itself — the
  executor performs the `NoStream`/`Exact(loaded.Version)` mapping from the
  `Option<TAggregate>` it already receives (D29); this task only consumes that mapping
  indirectly by routing through the executor.
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
4. A Level 2 handler invoked against an existing aggregate receives `Option<TAggregate>
   .Some` with the correct rehydrated state (automated, per D24).
5. A Level 2 handler invoked with no existing aggregate/stream receives `Option<
   TAggregate>.None`, and can still produce a valid creation decision by delegating to
   Level 1's existing creation decision path (automated, per D24).
6. No new create-handler hierarchy or `null`-based "missing aggregate" representation
   exists anywhere in this task's diff (inspection, per D24).
7. No handler in this task's diff writes to more than one executor-managed Event Sourced
   stream within a single command execution — inspection confirms the handler type's own
   shape offers no such capability (per D31).
8. The handler itself contains no code constructing a `NoStream`/`Exact(version)` value
   or any expected-stream-state literal — inspection confirms that mapping happens only
   in task 03's executor (per D29).

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
- Multi-aggregate/multi-stream atomic writes within one handler invocation, and any
  saga/process-manager/workflow capability (D31).
