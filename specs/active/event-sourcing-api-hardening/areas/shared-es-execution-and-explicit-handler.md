# Area: Shared Event Sourcing execution and explicit handler

## Responsibility

Extract the shared load → authorize → decide → append → publish lifecycle used by both
the aggregate-method convention (Level 1) and the explicit Event Sourced handler (Level
2), with deterministic most-specific-state-method resolution and the full ordering
semantics the input specification requires.

## Current state

`DeciderCommandHandler.HandleAsync` (`Handling/DeciderCommandHandler.cs:14-34`) today
resolves an `IDecider` via `IDeciderRegistry.GetDecider`, calls
`repository.LoadAggregateAsync`, invokes `decider.DecideAsync`, then
`repository.AppendEventsAsync` with the loaded version (existing aggregate) or `0` (new
stream). It has no authorization hook at all — `grep` for `Authoriz` under
`src/NEvo.Ddd.EventSourcing` returns no matches. It is adapted into the messaging
pipeline via `DeciderCommandHandlerAdapter<TCommand,TAggregate,TId>`
(`Handling/DeciderCommandHandlerAdapter.cs:22-35`, one instance per
`DeciderDescription` via `ActivatorUtilities.CreateInstance`), surfaced as
`IMessageHandler`s by `DeciderCommandHandlerProvider`
(`Handling/DeciderCommandHandlerProvider.cs:12-31`).

State-method resolution (`AggregateDecider.GetDeciderDelegate`,
`Deciding/AggregateDecider.cs:25-35`; `AggregateEvolver.GetEvolverDelegate`,
`Evolving/AggregateEvolver.cs:41-55`) filters candidates by `Type.IsAssignableFrom` then
takes LanguageExt `.ToOption()`'s first match — no specificity ranking, no ambiguity
error (this is the exact gap D2 closes; task 01 characterizes this first-match behavior
as the pre-hardening baseline).

Synchronous dispatch re-enters `IMessageProcessor.ProcessMessageAsync` under the same
ambient `TransactionScope` opened by `TransactionScopeMessageProcessingMiddleware`
(`src/NEvo.Messaging/Handling/Middleware/TransactionScopeMessageProcessingMiddleware.cs:8-20`);
`InternalSyncProcessDispatchStrategy`/`InternalSyncProcessPublishStrategy` both simply
recurse into `ProcessMessageAsync` (`InternalSyncProcessDispatchStrategy.cs:8-9`). No
"flush" primitive exists anywhere in the repository.

## Requirements

- Extract a shared Event Sourced command executor (exact name owner-undecided, per the
  input specification) that owns: message/command validation happens upstream in the
  normal pipeline (not duplicated here); static/message-level authorization (task 08's
  concern, invoked from here); load and rehydrate; aggregate/resource-aware
  authorization (task 08's extension point, invoked from here after rehydration, before
  decision); execute decision; append using expected version (task 03's store/exception
  types); ensure the append is durable/visible before triggering synchronous downstream
  processing (D7 — no new flush primitive, just correct ordering against the existing
  pipeline); allow downstream synchronous handlers to make their own changes visible;
  leave final application transaction commit to the outer pipeline.
- Both Level 1 (convention) and Level 2 (explicit handler, task 05) route through this
  one executor — no duplicated load/replay/append/publish logic between them.
- Implement deterministic state-method resolution: exact runtime type preferred,
  otherwise nearest compatible base-state implementation, equally-specific ambiguous
  candidates fail as a configuration/runtime error (D2). Applies to both decider and
  evolver resolution.
- The explicit `IEventSourcedCommandHandler<TCommand, TAggregate, TId>` (or refined
  equivalent name) receives the rehydrated aggregate/current state and the command, may
  use injected dependencies for orchestration/I-O before the decision, and may delegate
  to the same decision-method discovery Level 1 uses rather than duplicating the
  transition (D1). It must not force repository plumbing back onto the user.

## Constraints

- Decision/evolver methods stay synchronous and free of I/O/DI resolution — do not add
  async convention decision methods; no evidence of a legitimate need for one was found
  in current code (`AggregateEvolver.Evolve`/`AggregateDecider` are both fully
  synchronous today).
- Do not build a purity-enforcement subsystem — this is an API/design rule enforced by
  the shape of the extension points, not a runtime analyzer.
- Concurrency mismatch surfaces through `Either<Exception, T>` using task 03's
  `AggregateConcurrencyException` — do not introduce a different result-type shape.

## Interfaces and boundaries

- Consumes: task 02's reorganized folders, task 03's `IEventStreamStore`/repository
  split and `AggregateConcurrencyException`.
- Provides to task 06 (registration): the two route kinds (convention/explicit) that
  become Fallback/Primary respectively.
- Provides to task 08 (authorization): the two ordered hook points (static/message-level
  before load; aggregate-aware after load, before decision).
- Provides to task 11 (Documents example): the public `IEventSourcedCommandHandler<...>`
  contract to implement.

## Area-specific acceptance criteria

1. A command handled purely through Level 1 and a command handled through an explicit
   Level 2 handler both go through the same executor code path — proven by a shared
   integration test exercising both and asserting identical load/append/publish
   ordering.
2. A command supported by two aggregate state types resolves to the most-specific
   runtime type; a test with two equally-specific candidates fails deterministically
   (not silently picking one).
3. The append happens before any synchronous domain-event handler triggered by the same
   command runs; a test in which that handler reloads the aggregate observes the newly
   appended state.
4. A concurrency conflict during append surfaces through the executor as
   `Either<AggregateConcurrencyException, _>.Left`, not swallowed or rethrown as a
   different type.
5. The explicit Level 2 handler can delegate to Level 1's own decision-method discovery
   without duplicating the aggregate's transition logic — proven by an example handler
   that does so.

## Dependencies

- `characterization-and-reorganization` (tasks 01-02).
- `persistence-boundary` (task 03) — needs the hardened store/repository contracts and
  the concurrency exception.

## Out of scope

- Handler registration role metadata / Primary-Fallback resolution rules (area
  `handler-registration-and-options`).
- Authorization implementation details beyond the two ordered hook points this executor
  exposes (area `authorization-integration`).
