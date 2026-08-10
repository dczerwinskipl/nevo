---
id: development.transport-development
type: development
title: Adding a transport
status: current
read_when:
  - adding a new transport to NEvo itself
  - implementing IExternalMessageDispatchStrategy
summary: >
  How to add a new transport mechanism to NEvo itself, as distinct from a consumer
  using an existing one. Worked example: NEvo.Messaging.Web.
related:
  - development.messaging-pipeline
  - development.extension-points
---

# Adding a transport

## Subsystem responsibility

This document covers adding a new transport **to NEvo itself** (a new package that
plugs into the pipeline the way `NEvo.Messaging.Web` does) — not a consumer using an
existing transport, which is a usage-guide topic.

## Intended extension points

**Worked example:** `NEvo.Messaging.Web`
(`docs/reference/packages/NEvo.Messaging.Web.md`).

Outbound dispatch and inbound receipt are separate concerns:

1. **Outbound:** implement `IExternalMessageDispatchStrategy` (`DispatchAsync` for the
   message, plus `ShouldApply(IMessage)` to decide whether your transport handles a
   given message) — see `RestExternalMessageDispatchStrategy` in `NEvo.Messaging.Web`
   for the shape: resolve/build a `MessageEnvelopeDto` via `IMessageEnvelopeMapper`,
   then hand it to your transport client.
2. **Inbound:** map an endpoint (or equivalent entry point for your transport) that
   resolves `IMessageProcessor`/`ICommandDispatcher` from DI and calls
   `ProcessMessageAsync`/`DispatchAsync` — see `RoutesExtensions.MapMessagesEndpoints`/
   `MapCommandEndpoint` in `NEvo.Messaging.Web` for the ASP.NET Core shape.
3. Register your strategy following the DI shape in
   `docs/development/coding-conventions.md` § "DI registration shape" —
   `NEvo.Messaging.Web`'s `AddRestMessageDispatcher` is the reference.

## Required tests

`dotnet build` confirms your implementation satisfies the interface; run the relevant
package's own test project as a starting point for testing your extension, and add
characterization tests per `docs/development/testing-strategy.md` if you're modifying
existing behavior rather than adding new behavior alongside it.

## Known unresolved decisions

None specific to transport extension beyond what `docs/development/extension-points.md`
§ "Forbidden or unsafe extension approaches" already covers.
