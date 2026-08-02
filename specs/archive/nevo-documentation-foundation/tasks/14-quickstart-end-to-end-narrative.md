---
id: nevo-documentation-foundation.quickstart-end-to-end-narrative
status: draft
change: nevo-documentation-foundation
context:
  required:
    - docs/guides/quick-start.md
    - docs/guides/example-app-walkthrough.md
    - specs/active/nevo-documentation-foundation/reviews/audit-examples-and-wireup.md
  optional:
    - docs/packages/NEvo.Messaging.md
    - docs/packages/NEvo.Messaging.Web.md
allowed_paths:
  - docs/guides/quick-start.md
  - docs/guides/example-app-walkthrough.md
  - specs/active/nevo-documentation-foundation/**
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
  - tools/**
---

# Task: Quick-start end-to-end narrative

## Goal

Connect `quick-start.md` and `example-app-walkthrough.md` into one coherent,
domain-named, end-to-end story — "HTTP request → command handler → published event →
independent second handler" — using only NEvo's real, already-shipped, already-documented
APIs. This closes the three `AUTO_FIX` findings (F1, F2, F8) from
`reviews/audit-examples-and-wireup.md`'s change-wide examples-and-wire-up audit.

## Dependencies

`quickstart-and-installation-guide`, `exampleapp-walkthrough-guide` (both already
`implemented` — this task revises their output, not their prerequisites).

## Implementation constraints

- Read (do not modify — `examples/**` is a forbidden path for edits, not for reading)
  `examples/ExampleApp/.../SayHelloCommandHandler.cs`, `MyEventHandlerA.cs`,
  `MyEventHandlerB.cs`, and `MessageHandlerRegistryExtensions.cs` to ground F1 and F2 in
  the real, already-running code — no new example project or `examples/**` change.
- **F8** — rewrite `quick-start.md` § "3. Dispatch it" to route the request through
  `NEvo.Messaging.Web`'s real `MapCommandEndpoint<TCommand>` (HTTP `POST` →
  `ICommandDispatcher.DispatchAsync`, per `src/NEvo.Messaging.Web/RoutesExtensions.cs:46-65`,
  already used by every real endpoint in `examples/ExampleApp`) instead of the current
  manual `IMessageProcessor`/`IMessageContextProvider` resolution inside `Program.cs`.
- **F2** — extend `quick-start.md` one step further: the handler publishes a domain
  event via `IEventPublisher`, a second, independent handler reacts via
  `IEventHandler<T>`, and the guide explicitly states this is the same shape as
  `examples/ExampleApp`'s `SayHelloCommandHandler` → `MyEvent` → `MyEventHandlerA`/`B`,
  cross-referencing `example-app-walkthrough.md` § Scenario 2 (once F1 documents it) so
  the reader recognizes a real running example, not an unrelated one-off. Use
  domain-meaningful naming consistent with the rest of the narrative (not `Ping`/`Foo`).
- **F1** — update `example-app-walkthrough.md` § Scenario 2 to document that
  `SayHelloCommandHandler` also publishes `MyEvent`, fanned out to `MyEventHandlerA` and
  `MyEventHandlerB` (both registered in `MessageHandlerRegistryExtensions.cs:13-14`) — the
  guide currently covers only the permission-check path.
- Do not introduce any claim, API, or code sample not already real and citable in
  `src/**`/`examples/**` — this task adds narrative connective tissue between existing,
  already-verified facts, not new illustrative content.

## Acceptance criteria

- `example-app-walkthrough.md` § Scenario 2 documents `SayHelloCommandHandler`'s
  `MyEvent` publish and both registered handlers (F1 resolved).
- `quick-start.md` § "3. Dispatch it" uses `MapCommandEndpoint<TCommand>`, not manual
  `IMessageProcessor` resolution (F8 resolved).
- `quick-start.md` extends to a full request → command → event → second-handler
  narrative that explicitly cross-references `example-app-walkthrough.md`'s Scenario 2
  as the same real, running shape (F2 resolved).
- Both guides still pass `node tools/docs.mjs validate` under the `guide` type.
- No `src/**`, `tests/**`, or `examples/**` file is created or modified.

## Verification

```
node tools/docs.mjs validate
node tools/docs.mjs check
node tools/specs.mjs validate
```

## Out of scope

- Any new `examples/**` project or `src/**` change — every API used here already exists.
- F3 (`extending-nevo.md` citation-rigor inconsistency) and F4–F7 (informational) from
  the same audit — not part of this task's scope.
