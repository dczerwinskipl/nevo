---
id: query-support-and-handler-registration-hardening.documentation-and-example
status: draft
change: query-support-and-handler-registration-hardening
semantic_references:
  decisions: [D5, D6]
context:
  required:
    - specs/active/query-support-and-handler-registration-hardening/areas/documentation-and-example.md
    - specs/active/query-support-and-handler-registration-hardening/owner-decisions.md
    - docs/usage/commands.md
    - docs/reference/packages/NEvo.Messaging.Cqrs.md
    - docs/reference/packages/NEvo.Messaging.md
    - docs/development/architecture-overview.md
    - docs/development/testing-strategy.md
  optional:
    - examples/ExampleApp/NEvo.ExampleApp.ServiceA.Api/ExampleDomain/Documents/Document.cs
    - examples/ExampleApp/NEvo.ExampleApp.ServiceA.Api/ExampleDomain/Documents/DocumentCommands.cs
    - examples/ExampleApp/NEvo.ExampleApp.ServiceA.Api/Routes.cs
allowed_paths:
  - docs/usage/queries.md
  - docs/usage/commands.md
  - docs/usage/events.md
  - docs/reference/packages/NEvo.Messaging.Cqrs.md
  - docs/reference/packages/NEvo.Messaging.md
  - docs/development/architecture-overview.md
  - docs/development/testing-strategy.md
  - examples/ExampleApp/**
forbidden_paths:
  - src/NEvo.Messaging/**
  - src/NEvo.Messaging.Cqrs/Commands/**
  - src/NEvo.Messaging.Cqrs/Queries/**
  - tests/**
---

# Task: Documentation and example

## Goal

Document Query as a supported, first-class feature and demonstrate it end-to-end in
`examples/ExampleApp/` with a realistic read-side query, closing out the change.

## Dependencies

- `query-dispatch-and-registration` (task 05) — the finished public surface this task
  documents and demonstrates.

## Implementation constraints

- New `docs/usage/queries.md`, same shape as `docs/usage/commands.md` (Goal/
  Prerequisites/Steps/Constraints/Verification/Next steps): define a `Query<TResult>`,
  implement `IQueryHandler<TQuery, TResult>`, register via `AddQueries()`, dispatch via
  `IQueryDispatcher`, and state the deterministic no-handler/multiple-handler failure
  modes.
- Update `docs/reference/packages/NEvo.Messaging.Cqrs.md`: extend Purpose/When to
  use/Responsibilities/Public surface/Configuration to include Query; remove the
  query-absence statement from Limitations (replace with any genuinely remaining
  limitation, or remove the bullet if none); update "Examples and tests" to name
  `tests/NEvo.Messaging.Cqrs.Tests` instead of stating no dedicated project exists.
- Update `docs/development/architecture-overview.md`'s module map row for
  `NEvo.Messaging.Cqrs` and the "query-side not implemented" note under "Module map" to
  reflect Query support.
- Update `docs/development/testing-strategy.md`: add `NEvo.Messaging.Cqrs.Tests` to "Test
  projects", and add or adjust a "Required tests per subsystem" row covering CQRS
  command/query dispatch, pointing at `tests/NEvo.Messaging.Cqrs.Tests`.
- **Breaking-change note (D6, required).** `docs/reference/packages/NEvo.Messaging.md`'s
  public-surface documentation must note that `MessageHandlerAdapterBase<TMessageGroup>`,
  `CommandHandlerAdapter` (`NEvo.Messaging.Cqrs`), and `EventHandlerAdapter` were public
  types removed by this change, replaced by the new public `MessageHandlerAdapter` — a
  breaking change for any direct reference to the three removed types (not for consumers
  using the documented `ICommandHandler<T>`/`IEventHandler<T>`/`IMessageHandlerFactory`
  extension surface, which is unaffected). Do not describe `MessageHandlerAdapter` as a
  new extension point — it is not one (see `areas/shared-handler-invocation.md` §
  "Interfaces and boundaries").
- Example: extend the existing `Document` aggregate
  (`examples/ExampleApp/NEvo.ExampleApp.ServiceA.Api/ExampleDomain/Documents/`) with a
  `GetDocumentQuery -> DocumentDto`-shaped query and handler, wired to a real HTTP GET
  endpoint alongside the existing `CreateDocument` route in `Routes.cs`. Reuse the
  aggregate's existing command/event types as-is — do not fix the unrelated namespace
  mismatch noted in `overview.md` § Out of scope.

## Acceptance criteria

1. `node tools/docs.mjs validate` passes (automated).
2. No document in `docs/` still states query-side support is absent or unimplemented
   (inspection).
3. `docs/development/testing-strategy.md` lists `NEvo.Messaging.Cqrs.Tests` (inspection).
4. `docs/reference/packages/NEvo.Messaging.md` documents the removal of
   `MessageHandlerAdapterBase<TMessageGroup>`/`CommandHandlerAdapter`/
   `EventHandlerAdapter` and the addition of the public `MessageHandlerAdapter` as a
   breaking change (inspection, D6).
5. The `GetDocumentQuery` endpoint is reachable in the running example app and returns
   the expected `DocumentDto` for a previously created document (inspection — manual run
   of `examples/ExampleApp/`).

## Verification

```
node tools/docs.mjs validate
dotnet build
```

Manual: run `examples/ExampleApp/NEvo.ExampleApp.ServiceA.Api`, create a document via the
existing `CreateDocument` endpoint, then call the new `GetDocumentQuery` endpoint and
confirm the returned `DocumentDto` matches.

## Documentation impact

This task's entire scope is documentation (see Implementation constraints above).

## Out of scope

- Fixing the pre-existing `Documents/*.cs` namespace mismatch
  (`NEvo.Ddd.EventSourcing.Tests.Mocks`).
- Any new example application beyond extending the existing `Document` aggregate.
- Any further `src/` behavior change — this task is docs/example only.
