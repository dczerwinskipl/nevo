# Area: Registration idempotency hardening

## Responsibility

Make `AddCommands()`, `AddEvents()`, and the new `AddQueries()` safe to call more than
once, without changing what a single call registers.

## Current state

- `AddCommands()` (`src/NEvo.Messaging.Cqrs/Commands/ServiceCollectionExtensions.cs`) and
  `AddEvents()` (`src/NEvo.Messaging/Events/ServiceCollectionExtensions.cs`) both use
  plain `AddSingleton`/`AddScoped` for every service they register. A repeated call to
  either risks a duplicate-key exception in `MessageHandlerExtractor`'s
  `ToDictionary(f => f.ForInterface)` (via the duplicate `IMessageHandlerFactory`
  registration) or a silently duplicated `IMessageProcessingStrategy`.
- `AddMessages()` (`src/NEvo.Messaging/ServiceCollectionExtensions.cs`) already uses
  `TryAddSingleton`/`TryAddScoped` for its own core services — it is the pattern to
  follow, not a file this area needs to change.
- Composing distinct `AddX` calls together (`AddMessages()+AddCommands()+AddEvents()`)
  does **not** itself duplicate shared infrastructure today — each registers a disjoint
  set of service types. The defect is specifically about repeating the *same* call.
- No test exists proving `AddCommands()`'s or `AddEvents()`'s current single-call
  registration shape.

## Requirements

1. `AddCommands()` and `AddEvents()` move to `TryAddSingleton`/`TryAddScoped`/
   `TryAddEnumerable` (as appropriate per service) so a second call is a no-op, not a
   crash or a duplicate registration.
2. The new `AddQueries()` (added in the `query-cqrs-support` area) follows the same
   idempotent shape from the start.
3. Characterization tests (from `shared-handler-invocation` area, task 01) continue to
   prove single-call behavior is unchanged.
4. New tests prove: a second call to `AddCommands()`/`AddEvents()`/`AddQueries()` does not
   throw and does not change resolvable service behavior; `AddMessages()+AddCommands()+AddEvents()+AddQueries()`
   composed together register no duplicate infrastructure.

## Constraints

- `TryAddEnumerable` (not plain `TryAdd`) where a service is legitimately registered as
  one of several implementations of the same interface — e.g. `IMessageProcessingStrategy`,
  where Command and Event each contribute their own strategy instance(s)
  (`CommandProcessingStrategy`; `ParallelEventProcessingStrategy` and
  `SequentialEventProcessingStrategy`) and all must survive registration; using plain
  `TryAdd` there would silently drop every registration after the first. **Query is not
  part of this interface** — `QueryProcessingStrategy` implements the separate
  `IMessageProcessingStrategyWithResult` interface (single-instance-per-app, not
  multi-registration), and its idempotent registration is added directly in
  `AddQueries()` (task 05), not retrofitted here. Do not register `QueryProcessingStrategy`
  as an `IMessageProcessingStrategy`.
- Do not change what a *single* call to any of the three methods registers — this is an
  idempotency fix, not a registration-surface change.

## Interfaces and boundaries

Exposes: `AddCommands()`, `AddEvents()`, `AddQueries()` — same public signatures as
today, `Microsoft.Extensions.DependencyInjection` namespace, no new parameters.

## Area-specific acceptance criteria

1. Calling `AddCommands()` twice does not throw (automated).
2. Calling `AddEvents()` twice does not throw (automated).
3. Calling `AddQueries()` twice does not throw (automated).
4. `AddMessages()+AddCommands()+AddEvents()+AddQueries()` composed together resolve
   exactly one instance of each singleton/scoped service that is meant to be singular,
   and the full set of `IMessageProcessingStrategy` implementations contributed by
   Command and Event (`CommandProcessingStrategy`, `ParallelEventProcessingStrategy`,
   `SequentialEventProcessingStrategy`) are all still resolvable — Query's own
   `IMessageProcessingStrategyWithResult` registration is verified separately in task 05
   (automated).
5. Every existing characterization test (task 01) still passes (automated).

## Dependencies

Depends on the `shared-handler-invocation` area's characterization tests (task 01) as the
regression safety net. Independent of that area's adapter refactor (task 02) — no file
overlap.

## Out of scope

- `AddMessages()`'s own `AddMessageProcessingMiddleware`/`AddMessageProcessingHandlerMiddleware`
  double-registration-of-config-wrapper risk — pre-existing, not required by Query, noted
  in `overview.md` § Out of scope as a candidate follow-up.
- Any new composing method (`AddMessages`-style sugar over Commands+Events+Queries) — D3
  rejected this.
