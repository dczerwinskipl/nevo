---
id: event-sourcing-api-hardening.event-sourcing-registration-options
status: draft
change: event-sourcing-api-hardening
depends_on:
  - primary-fallback-handler-roles
semantic_references:
  decisions: [D4, D32]
  dependency_contracts: [primary-fallback-handler-roles]
context:
  required:
    - specs/active/event-sourcing-api-hardening/areas/handler-registration-and-options.md
    - specs/active/event-sourcing-api-hardening/owner-decisions.md
    - src/NEvo.Ddd.EventSourcing/ServiceCollectionExtensions.cs
    - src/NEvo.Messaging.Cqrs/Commands/ServiceCollectionExtensions.cs
  optional: []
allowed_paths:
  - src/NEvo.Ddd.EventSourcing/**
  - tests/NEvo.Ddd.EventSourcing.Tests/**
forbidden_paths:
  - src/NEvo.Messaging/**
  - src/NEvo.Messaging.Cqrs/Commands/**
  - examples/**
---

# Task: Event Sourcing registration options

## Goal

Add an additive `AddEventSourcing(Action<EventSourcingOptions> configure, params Type[]
aggregateTypes)` overload exposing a clearly named toggle for the aggregate-method
convention fallback (enabled by default), while keeping the existing
`AddEventSourcing(params Type[] aggregateTypes)` overload available with its current
developer-facing behavior and unchanged call sites (D32, superseding D4's accepted-
breaking-change framing for this signature specifically), and fix the non-idempotent
`AddSingleton` registration found in discovery (D4).

## Dependencies

- `primary-fallback-handler-roles` (task 05) — the toggle this task adds controls
  whether the Fallback route (task 05) gets registered at all.

## Implementation constraints

- Add `services.AddEventSourcing(Action<EventSourcingOptions> configure, params Type[]
  aggregateTypes)` with a flat `EventSourcingOptions` carrying one toggle for the one
  configurable behavior that currently exists — e.g. `UseAggregateMethodFallback`
  (`bool` property or method-style toggle, consistent with existing NEvo options-pattern
  naming; exact naming is this task's judgment call) — enabled by default. Do not
  introduce a nested `CommandHandlingOptions`-style hierarchy for a single boolean (D32)
  — extend to a richer shape only when a second independent configuration group actually
  exists. Disabling the toggle must leave the explicit Level 2 handler (task 04) and
  ordinary `ICommandHandler<T>` fully usable. Public terminology describes
  developer-facing behavior ("aggregate method convention/fallback"), not an internal
  implementation name.
- `services.AddEventSourcing(params Type[] aggregateTypes)` remains available, unchanged
  for existing callers, and delegates to the new overload with default options (D32) —
  do not require `AddEventSourcing(null, ...)` or any nullable-configure-callback call
  pattern to reach the old behavior.
- Preserve the existing `aggregateTypes` registration need (today's
  `params Type[] aggregateTypes` populates `AggregateExtractorConfiguration
  .AggregateTypes`) — fold it into the new options shape rather than dropping the
  capability.
- Fix `DeciderCommandHandlerProvider`'s registration
  (`services.AddSingleton<IMessageHandlerProvider, DeciderCommandHandlerProvider>()`,
  currently plain `Add`) to `TryAdd`-based idempotent registration, matching
  `AddCommands`/`AddEvents`/`AddQueries`'s precedent from the archived query-support
  change.

## Acceptance criteria

1. `services.AddEventSourcing(options => options.UseAggregateMethodFallback = false)`
   (or the task's finalized naming) via the new additive overload registers/withholds
   the convention Fallback route (automated).
2. `services.AddEventSourcing(typeof(SomeAggregate))` (the existing overload, unchanged
   call site) continues to compile and behave exactly as before — convention fallback
   enabled, `aggregateTypes` registered (automated).
3. Convention fallback disabled at registration time means a command with only a
   convention-eligible aggregate method has no registered handler
   (`NoHandlerFoundException`), while an explicit Level 2 handler or ordinary command
   handler for a different command remains usable (automated).
4. Each overload of `AddEventSourcing` called twice does not throw and does not
   duplicate registered services, proven by an idempotency test matching the pattern
   established for `AddCommands`/`AddEvents`/`AddQueries` (automated).
5. `AggregateExtractorConfiguration.AggregateTypes` is still populated correctly through
   both overloads (automated).

## Verification

```
dotnet build
dotnet test tests/NEvo.Ddd.EventSourcing.Tests
```

## Documentation impact

None in this task — covered by tasks 11 (user-facing) and 12 (internal).

## Out of scope

- Any change to `AddCommands`/`AddEvents`/`AddQueries` themselves (already idempotent
  from the archived query-support change).
- Handler role resolution logic itself (task 05, already done).
