---
id: architecture.message-context
type: architecture
title: Message context
status: current
scope:
  - messaging
  - context
  - correlation
read_when:
  - modifying context propagation
  - adding context features
  - working with correlation or causation IDs
summary: >
  Describes IMessageContext, its propagation via AsyncLocal, header management,
  and the feature storage mechanism.
related:
  - architecture.messaging-pipeline
---

# Message context

## Purpose

`IMessageContext` carries cross-cutting information through message processing without
requiring every handler to declare it as a parameter.

## Interface

Defined in `src/NEvo.Messaging/Context/`:

```csharp
interface IMessageContext
{
    MessageContextHeaders Headers { get; }
    IServiceProvider ServiceProvider { get; }
    Option<string> CorrelationId => Headers.CorrelationId;
    Option<string> CausationId => Headers.CausationId;
    T GetFeature<T>() where T : new();
    void SetFeature<T>(T value) where T : new();
}
```

`MessageContextHeaders` is a `Dictionary<string, string>` wrapper with typed accessors.

## Propagation

`IMessageContextAccessor` uses `AsyncLocal<IMessageContext>` for thread-safe async propagation:

```csharp
interface IMessageContextAccessor
{
    IMessageContext? MessageContext { get; set; }
}
```

This means the context is automatically available to all async continuations on the same
logical call chain without explicit passing.

`IMessageContextProvider` creates new context instances for incoming messages.

## Built-in context population

The following middleware populate context automatically (see messaging-pipeline.md):

| Middleware | What it sets |
|---|---|
| `CorrelationIdMessageProcessingMiddleware` | `Headers.CorrelationId` — generated if absent |
| `CausationIdMessageProcessingMiddleware` | `Headers.CausationId` — set from incoming message |
| `UserContextMiddleware<TId, TDataScope>` | User identity and data scope as context features |

## Feature storage

`GetFeature<T>()` / `SetFeature<T>(T)` provide typed ambient storage keyed by type.
This is used for user identity, authorization results, and other cross-cutting data
that must travel through the pipeline without changing handler signatures.
