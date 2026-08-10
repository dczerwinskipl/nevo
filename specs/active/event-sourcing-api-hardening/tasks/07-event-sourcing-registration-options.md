---
id: event-sourcing-api-hardening.event-sourcing-registration-options
status: draft
change: event-sourcing-api-hardening
depends_on:
  - primary-fallback-handler-roles
semantic_references:
  decisions: [D4]
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

Replace `AddEventSourcing(params Type[] aggregateTypes)`'s unconditional wiring with
`AddEventSourcing(options => {...})`, exposing a clearly named toggle for the
aggregate-method convention fallback (enabled by default), and fix the non-idempotent
`AddSingleton` registration found in discovery (D4).

## Dependencies

- `primary-fallback-handler-roles` (task 06) — the toggle this task adds controls
  whether the Fallback route (task 06) gets registered at all.

## Implementation constraints

- `services.AddEventSourcing(options => {...})` with a toggle such as
  `options.CommandHandling.UseAggregateMethodsAsFallback()` — exact property/method
  names are this task's judgment call, grounded in existing NEvo options-pattern naming
  (check `NEvo.Messaging.Cqrs`/`NEvo.Messaging.Authorization` for precedent). Convention
  fallback is enabled by default. Disabling it must leave the explicit Level 2 handler
  (task 05) and ordinary `ICommandHandler<T>` fully usable. Public terminology
  describes developer-facing behavior ("aggregate method convention/fallback"), not an
  internal implementation name.
- Preserve the existing `aggregateTypes` registration need (today's
  `params Type[] aggregateTypes` populates `AggregateExtractorConfiguration
  .AggregateTypes`) — fold it into the new options shape rather than dropping the
  capability.
- Fix `DeciderCommandHandlerProvider`'s registration
  (`services.AddSingleton<IMessageHandlerProvider, DeciderCommandHandlerProvider>()`,
  currently plain `Add`) to `TryAdd`-based idempotent registration, matching
  `AddCommands`/`AddEvents`/`AddQueries`'s precedent from the archived query-support
  change.
- This changes `AddEventSourcing`'s public signature — acceptable per D4 (package is
  `status: experimental`, unreleased). Do not add a backward-compatible overload unless
  doing so is trivial; if it adds real complexity, drop the old signature outright and
  say so in this task's diff.

## Acceptance criteria

1. `services.AddEventSourcing(options => options.CommandHandling
   .UseAggregateMethodsAsFallback())` (or the task's finalized naming) registers the
   convention Fallback route (automated).
2. Convention fallback disabled at registration time means a command with only a
   convention-eligible aggregate method has no registered handler
   (`NoHandlerFoundException`), while an explicit Level 2 handler or ordinary command
   handler for a different command remains usable (automated).
3. `AddEventSourcing()` called twice does not throw and does not duplicate registered
   services, proven by an idempotency test matching the pattern established for
   `AddCommands`/`AddEvents`/`AddQueries` (automated).
4. `AggregateExtractorConfiguration.AggregateTypes` is still populated correctly through
   the new options shape (automated).

## Verification

```
dotnet build
dotnet test tests/NEvo.Ddd.EventSourcing.Tests
```

## Documentation impact

None in this task — covered by task 12.

## Out of scope

- Any change to `AddCommands`/`AddEvents`/`AddQueries` themselves (already idempotent
  from the archived query-support change).
- Handler role resolution logic itself (task 06, already done).
