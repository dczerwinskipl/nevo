---
id: development.extension-points
type: development
title: Extension points
status: current
read_when:
  - adding a new handler-type kind (not just a new handler)
  - implementing a custom IMessageHandlerFactory
  - evaluating whether an extension approach is safe
summary: >
  The IMessageHandlerFactory contract a third-party handler-type author must implement,
  and a consolidated list of extension approaches that look plausible but are unsafe or
  unsupported today.
related:
  - development.messaging-pipeline
  - development.processing-model
---

# Extension points

## Intended extension points

### `IMessageHandlerFactory` — adding a new handler-type kind

Defined in `src/NEvo.Messaging/Handling/IMessageHandlerFactory.cs`:

```csharp
public interface IMessageHandlerFactory
{
    public Type ForInterface { get; }
    IMessageHandler Create(MessageHandlerDescription messageHandlerDescription);
    IEnumerable<MessageHandlerDescription> GetMessageHandlerDescriptions(Type handlerType, Type handlerInterface);
}
```

This is the contract for adding a **new kind** of handler interface to NEvo (the way
`NEvo.Messaging.Cqrs` adds `ICommandHandler<TMessage>` on top of the generic
`IMessageHandler` pipeline) — distinct from a consumer simply writing a handler for an
existing kind (`ICommandHandler<T>`/`IEventHandler<T>`), which is a usage-guide topic
(see `docs/usage/commands.md`/`docs/usage/events.md`), not this document's concern.

- `ForInterface` declares which handler interface type this factory adapts (e.g.
  `ICommandHandler<>`).
- `GetMessageHandlerDescriptions` is called during reflection-based startup discovery to
  find every method on a candidate type that should be treated as a handler for
  `handlerInterface`, returning one `MessageHandlerDescription` per match.
- `Create` builds the `IMessageHandler` adapter instance from a `MessageHandlerDescription`
  — the object the messaging pipeline actually invokes via `IMessageHandler.HandleAsync`.

Discovery and registration: `MessageHandlerExtractor`
(`src/NEvo.Messaging/Handling/MessageHandlerExtractor.cs`) takes `IEnumerable<IMessageHandlerFactory>`
from DI and indexes them by `ForInterface`. Registering a new handler-type kind means
implementing `IMessageHandlerFactory` and registering it in DI alongside NEvo's built-in
factories (e.g. `CommandHandlerAdapterFactory`, registered by `NEvo.Messaging.Cqrs`'s
`AddCommands()`) — there is no separate discovery mechanism to configure beyond normal DI
registration.

### New processing strategies

See `docs/development/processing-model.md` § "Intended extension points" — implement
`IMessageProcessingStrategy` and add it to `IMessageProcessingStrategyFactory`. Strategy
registration order matters (first matching `ShouldApply` wins).

## Forbidden or unsafe extension approaches

- **Do not rely on `PersistentStepExecutor` (`NEvo.Orchestrating`) for real state
  persistence today.** No `IOrchestratorStateRepository` implementation exists anywhere
  in this repository — not in `NEvo.Orchestrating`, not in
  `NEvo.Orchestrating.EntityFramework` (which provides only an EF entity shape and table
  configuration, no working repository). Supplying `PersistentStepExecutor` without
  writing your own `IOrchestratorStateRepository` implementation will not persist
  anything.
- **Do not assume `AllowPermissionAttribute.PermissionName` is enforced.**
  `ValidatePermissionMiddleware<TId>` (`NEvo.Messaging.Authorization`) never compares
  `PermissionName` against the current user's permissions — matching is defined entirely
  by whatever `IDataScopeMessageValidator<TDataScope, TMessage>` you supply. Treat
  `PermissionName` as documentation/metadata unless your own validator explicitly checks
  `permission.Name`.
- **Do not add a new project reference or external package without a specification and
  owner approval.** Both are explicit owner-approval gates (see
  `docs/development/package-boundaries.md` § "Changing a dependency" and § "External
  dependency ownership", and `AGENTS.md`).
- **Do not modify transaction, session, or `DbContext` lifetime behavior** without a
  specification and owner approval — see `docs/development/transaction-model.md`.
- **Do not register your own message-processing middleware assuming a fixed pipeline
  order is guaranteed.** Ordering is an artifact of DI registration call order, not a
  framework-enforced contract — see `docs/development/failure-semantics.md` § "Is
  middleware registration order a guaranteed contract?" before relying on where your
  middleware runs relative to NEvo's own.

## Required tests

`dotnet build` confirms an `IMessageHandlerFactory`/`IMessageProcessingStrategy`
implementation satisfies its interface. Beyond that, add characterization tests per
`docs/development/testing-strategy.md` before changing existing extension-point
behavior — do not change behavior and write tests simultaneously.
