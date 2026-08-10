# Area: Handler registration and options

## Responsibility

Give the messaging registry a way to distinguish an intentional convention fallback from
a genuine duplicate-handler conflict (Primary/Fallback roles), and give
`AddEventSourcing` an options surface to enable/disable the convention route.

## Current state

`MessageHandlerDescription` (`src/NEvo.Messaging/Handling/IMessageHandler.cs:8`) is a
six-field record — `Key, HandlerType, MessageType, InterfaceType, ReturnType, Method` —
with no role/kind/priority field. `MessageHandlerExtractor.GetMessageHandlers()`
(`MessageHandlerExtractor.cs:18-28`) groups purely by `MessageType`.
`MessageHandlerRegistry` (`MessageHandlerRegistry.cs`) merges every registered
`IMessageHandlerProvider`'s output into one `Dictionary<Type, List<IMessageHandler>>`
keyed by message `Type` with no provenance distinction — `SelectMessageHandler` throws
`MoreThanOneHandlerFoundException` purely on a `Count > 1` collision
(`MessageHandlerRegistry.cs:23-26,41-44`).

`AddCommands()` (`src/NEvo.Messaging.Cqrs/Commands/ServiceCollectionExtensions.cs:11-19`)
registers `CommandHandlerAdapterFactory` via `TryAddEnumerable` — idempotent, following
the recent query-support hardening. `NEvo.Ddd.EventSourcing`'s `AddEventSourcing()`
(`ServiceCollectionExtensions.cs:39-61`) instead does
`services.AddSingleton<IMessageHandlerProvider, DeciderCommandHandlerProvider>()` — plain
`Add`, not idempotent — and registers directly as an `IMessageHandlerProvider`, bypassing
`IMessageHandlerFactory`/`MessageHandlerExtractor` entirely.
`DeciderCommandHandlerProvider.GetMessageHandlers()`
(`Handling/DeciderCommandHandlerProvider.cs:12-31`) builds descriptions with
`InterfaceType = null!` (`// interface?` comment) and `Method` left `null`.

**Confirmed today: a decider-based ES handler and a plain `ICommandHandler<TCommand>`
registered for the same command already collide and throw
`MoreThanOneHandlerFoundException`**, because `MessageHandlerRegistry` merges every
provider by `MessageType` with no way to prefer one — exactly the gap D3 closes.

`AddEventSourcing(params Type[] aggregateTypes)` wires the convention path
unconditionally with no options object (`// TODO: add provider?` at line 56).

## Requirements

- Add semantic Primary/Fallback role metadata to the registration model (exact
  mechanism — a `MessageHandlerDescription` field, a wrapping registration record, or
  another shape — is this task's design decision, grounded in what's least invasive to
  the existing `IMessageHandlerFactory`/`IMessageHandlerProvider`/`MessageHandlerRegistry`
  contracts). No numeric priority (D3).
- Resolution rules: one Primary → use Primary. No Primary + one Fallback → use Fallback.
  Two or more Primary → configuration error. Multiple competing Fallback for the same
  top-level route → configuration error. Prefer failing at startup/registration time
  where practical, per the input specification's stated preference.
- The convention aggregate-method route (task 04's executor via Level 1) is always
  Fallback. An explicit Event Sourced handler (task 05, Level 2) and an ordinary
  `ICommandHandler<TCommand>` (Level 3) are always Primary — two of the latter for the
  same command is therefore always a configuration error, never a silent preference.
- `AddEventSourcing(options => {...})` (or an additive overload preserving the existing
  `params Type[]` shape if that composition is cleaner) with a clearly named toggle
  (e.g. `options.CommandHandling.UseAggregateMethodsAsFallback()`), enabled by default
  (D4). Public terminology: "aggregate method convention/fallback," not an internal name
  like "generic handler."
- Fix `AddEventSourcing`'s registration to be idempotent (`TryAdd*`/`TryAddEnumerable`),
  matching `AddCommands`/`AddEvents`/`AddQueries`'s precedent.

## Constraints

- Do not weaken existing duplicate-handler protection for non-ES commands — a genuine
  two-Primary conflict must still fail exactly as `MoreThanOneHandlerFoundException`
  does today.
- Do not infer role from registration order — role must be explicit registration
  metadata (input specification's explicit requirement).
- Reuse `MoreThanOneHandlerFoundException`/`NoHandlerFoundException` (or clearly
  documented refinements of them) rather than inventing a parallel exception hierarchy
  for role conflicts, unless the existing exceptions genuinely cannot express a
  Primary-vs-Primary vs. Fallback-vs-Fallback distinction the input specification
  requires reporting.

## Interfaces and boundaries

- Consumes: task 04/05's two route kinds (convention executor path, explicit handler).
- Provides to task 08 (authorization): whichever route was actually selected, so
  `ValidatePermissionMiddleware` (task 08) can find the correct `Method`/permission
  source regardless of role.
- Provides to task 10/11 (Documents example): the public `AddEventSourcing(options =>
  {...})` surface and Primary/Fallback registration behavior the example demonstrates.

## Area-specific acceptance criteria

1. A command with only a Fallback (convention) handler resolves and executes it.
2. A command with one Primary (explicit ES handler or ordinary command handler) and the
   convention Fallback resolves to the Primary.
3. A command with two Primary candidates (e.g. an explicit ES handler and an ordinary
   `ICommandHandler<T>` for the same command) fails as a configuration error, ideally at
   registration/startup time.
4. Two competing Fallback candidates for the same top-level command route fail as a
   configuration error.
5. `options.CommandHandling.UseAggregateMethodsAsFallback()` disabled at registration
   time means a command with only a convention-eligible aggregate method has no
   registered handler (`NoHandlerFoundException`), while an explicit ES handler or
   ordinary command handler for a different command remains usable.
6. `AddEventSourcing()` called twice does not throw and does not duplicate registered
   services (idempotency test, matching `AddCommands`/`AddEvents`/`AddQueries`'s own
   idempotency tests).

## Dependencies

- `shared-es-execution-and-explicit-handler` (tasks 04-05) — role assignment needs both
  route kinds to exist.

## Out of scope

- Any change to `ValidatePermissionMiddleware`'s attribute-reading logic itself (area
  `authorization-integration`, task 08) — this area only ensures the correct route/
  `Method` is selected and available for that logic to use.
