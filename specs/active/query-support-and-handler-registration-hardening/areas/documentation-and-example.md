# Area: Documentation and example

## Responsibility

Document Query as a first-class, supported feature, and demonstrate it with a realistic
read-side example wired end-to-end in `examples/ExampleApp/`.

## Current state

- `docs/reference/packages/NEvo.Messaging.Cqrs.md` explicitly documents query-side
  support as absent (§ Limitations) and states no dedicated test project exists for the
  package.
- `docs/development/architecture-overview.md` states "query-side not implemented" in its
  module map and in a dedicated note under "Module map".
- `docs/development/testing-strategy.md`'s "Test projects" list and "Required tests per
  subsystem" table have no entry for `NEvo.Messaging.Cqrs` / Cqrs-layer coverage.
- `docs/usage/commands.md` and `docs/usage/events.md` exist as the task-oriented
  walkthroughs for Command/Event; there is no equivalent for Query.
- `examples/ExampleApp/NEvo.ExampleApp.ServiceA.Api/ExampleDomain/Documents/` contains a
  small event-sourced `Document` aggregate (`Create`/`Change`/`Approve` commands,
  matching events) that is a natural candidate to extend with a query — but those files
  currently declare a mismatched namespace (`NEvo.Ddd.EventSourcing.Tests.Mocks`) and are
  not linked into any test project; fixing that mismatch is unrelated pre-existing
  cleanup and is out of scope (see `overview.md`).

## Requirements

1. New `docs/usage/queries.md`, matching the shape of `docs/usage/commands.md`: define a
   Query, implement `IQueryHandler`, register via `AddQueries()`, dispatch via
   `IQueryDispatcher`, note the deterministic no-handler/multiple-handler failures.
2. Update `docs/reference/packages/NEvo.Messaging.Cqrs.md`: Purpose, When to use/not to
   use, Responsibilities, Public surface (add `Query<TResult>`/`IQueryHandler`/
   `IQueryDispatcher`), Configuration (`AddQueries()`), Limitations (remove the
   query-absence note; keep/adjust anything still accurate), Examples and tests (name the
   new `tests/NEvo.Messaging.Cqrs.Tests` project instead of "no dedicated project
   exists").
3. Update `docs/development/architecture-overview.md`'s module map and the "query-side
   not implemented" note to reflect Query support.
4. Update `docs/development/testing-strategy.md`: add `NEvo.Messaging.Cqrs.Tests` to
   "Test projects" and add/adjust a "Required tests per subsystem" row for CQRS
   command/query dispatch.
5. A realistic read-side example — prefer extending the existing `Document` aggregate
   with a `GetDocumentQuery -> DocumentDto`-shaped query over an artificial `PingQuery ->
   string` — wired to an actual HTTP endpoint in the example app, demonstrating
   `IQueryDispatcher` end-to-end.

## Constraints

- Do not fix the unrelated `Documents/*.cs` namespace mismatch as part of adding the
  example — reuse the aggregate's existing command/event types as-is, add only the new
  query/handler/DTO/endpoint.
- Documentation updates land in the same branch as the behavior they describe, per
  `references/artifact-policy.md` § "When architecture documentation must be updated".

## Interfaces and boundaries

Consumes the finished public surface from `query-cqrs-support` — this area does not
change `src/` behavior, only documents and demonstrates it.

## Area-specific acceptance criteria

1. `node tools/docs.mjs validate` passes with the updated/new docs.
2. The Query example is reachable via a real HTTP endpoint in `examples/ExampleApp/` and
   manually verified to return the expected `DocumentDto` (inspection).
3. No doc still states query-side support is absent or unimplemented (inspection).

## Dependencies

Depends on `query-cqrs-support` (task 05) being complete — this area documents and
demonstrates the finished feature, it does not design it.

## Out of scope

- Any new example application beyond extending the existing `Document` aggregate in
  `examples/ExampleApp/`.
- Fixing the pre-existing `Documents/*.cs` namespace mismatch.
