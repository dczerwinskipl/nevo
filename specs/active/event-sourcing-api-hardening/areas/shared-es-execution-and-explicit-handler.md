# Area: Shared Event Sourcing execution and explicit handler

## Responsibility

Extract the shared load → authorize → decide → append → publish lifecycle used by both
the aggregate-method convention (Level 1) and the explicit Event Sourced handler (Level
2), with deterministic most-specific-state-method resolution and the full ordering
semantics the input specification requires.

**Scope note (2026-08-11, narrow reference-design refinement):** two guardrails added,
neither changing the area's core shape. First (D29): the executor maps
`Option<TAggregate>.None` to task 02's new `NoStream` expected-stream-state and loaded
`Option<TAggregate>.Some` to `Exact(loaded.Version)` — replacing the old bare-`0`
convention. Second (D30): the executor's own responsibility is lifecycle orchestration
only — it depends on/invokes a supplied decision mechanism (already `IDecider`/
`IEvolver` in current code); reflection/state-method discovery stays the aggregate-
method convention's own concern (`AggregateDecider`/`AggregateEvolver`), not something
intrinsic to the executor class. This area's most-specific-wins resolution work (D2)
still lands in this area/task, but as hardening to the convention's own discovery
logic, not as new executor responsibility.

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
recurse into `ProcessMessageAsync` (`InternalSyncProcessDispatchStrategy.cs:8-9`).
**Corrected 2026-08-10 (spec-refine, review issue 3):** no primitive is literally
*named* "flush," but `DbContext.SaveChangesAsync()` already **is** the repository's
established flush mechanism — `EntityFrameworkMessageInbox.RegisterProcessedAsync`/
`EntityFrameworkMessageOutbox.SaveMessageAsync`
(`src/NEvo.Messaging.EntityFramework/`) already call it inline, enlisting in the
ambient `TransactionScope` without committing it
(`docs/development/transaction-model.md` § "Transaction ownership," questions 1-2).
This area's executor does not need to invent a new primitive; it needs to order its
own append before the re-entrant synchronous dispatch shown above, satisfying the
provider-agnostic storage-contract guarantee recorded in `overview.md` § "Architectural
principles" → "Append/flush/commit" (D23) — a future `DbContext`-backed store's own
`SaveChangesAsync()` call is that provider's way of satisfying the guarantee, not
something the executor itself invokes.

## Requirements

- Extract a shared Event Sourced command executor (exact name owner-undecided, per the
  input specification) that owns: load and rehydrate; aggregate/resource-aware
  authorization (task 07's extension point — the executor's *only* authorization
  concern, invoked from here after rehydration, before decision, receiving the current
  state as `Option<TAggregate>`, D24-D25); invoke a *supplied* decision operation (D30 —
  see below, not reflection the executor performs itself); append using the correct
  expected stream state, mapping `Option<TAggregate>.None` → `NoStream` and loaded
  `Option<TAggregate>.Some` → `Exact(loaded.Version)` (D29, task 02's contract); ensure
  the append is durable/visible before triggering synchronous downstream processing
  (the storage-contract guarantee, D23 — see below); allow downstream synchronous
  handlers to make their own changes visible; leave final application transaction
  commit to the outer pipeline. **The executor does not perform message/command
  validation and does not invoke normal message-level or handler-level permission
  checks — both already ran upstream in the messaging pipeline before the executor's
  handler is ever invoked (D25). The executor never duplicates that behavior.**
- **The executor is convention-agnostic (D30) — reflection/state-method discovery is
  not its responsibility.** It depends on/invokes a supplied decision mechanism —
  already `IDecider`/`IDeciderRegistry`/`IEvolver` in current code
  (`DeciderCommandHandler.HandleAsync` already resolves `IDecider` and calls
  `decider.DecideAsync` rather than performing reflection inline) — and this area's own
  hardening work preserves that shape rather than folding reflection into the executor
  class itself. The most-specific-wins resolution algorithm below is hardening to
  `AggregateDecider`/`AggregateEvolver`'s own discovery logic (the aggregate-method
  convention's concern), not new responsibility added to the executor. No speculative
  decision-strategy/plugin hierarchy (`IDecisionStrategy`, `IMutableAggregateStrategy`,
  `IFunctionalDeciderStrategy`, or similar) is introduced — D30 explicitly rejects that
  option.
- Both Level 1 (convention) and Level 2 (explicit handler, task 04) route through this
  one executor — no duplicated load/replay/append/publish logic between them.
- Implement deterministic state-method resolution: exact runtime type preferred,
  otherwise nearest compatible base-state implementation, equally-specific ambiguous
  candidates fail as a configuration/runtime error (D2). Applies to both decider and
  evolver resolution. This hardens `AggregateDecider`/`AggregateEvolver` themselves
  (the convention's discovery components), consistent with D30.
- The explicit `IEventSourcedCommandHandler<TCommand, TAggregate, TId>` (or refined
  equivalent name) receives the current state as `Option<TAggregate>` — `Some` when an
  existing stream/aggregate was rehydrated, `None` on the creation path — and the
  command (D24; never a bare `TAggregate`, never `null`). It may use injected
  dependencies for orchestration/I-O before the decision, and may delegate to the same
  decision-method discovery Level 1 uses rather than duplicating the transition (D1),
  including Level 1's existing creation decision path for the `None` case. It must not
  force repository plumbing back onto the user.
- Nothing in the executor's own public shape may require the aggregate's next state to
  come from an instance method on an immutable state object (D17) — the executor's
  load/append/version/publish responsibilities are framed in terms of events and
  streams; Level 1/Level 2's own use of the OO-immutable convention is a consumer of
  the executor, not a constraint baked into it.

## Constraints

- Decision/evolver methods stay synchronous and free of I/O/DI resolution — do not add
  async convention decision methods; no evidence of a legitimate need for one was found
  in current code (`AggregateEvolver.Evolve`/`AggregateDecider` are both fully
  synchronous today).
- Do not build a purity-enforcement subsystem — this is an API/design rule enforced by
  the shape of the extension points, not a runtime analyzer.
- Concurrency mismatch surfaces through `Either<Exception, T>` using task 02's
  `AggregateConcurrencyException` — do not introduce a different result-type shape, and
  never describe this as "thrown" (D13 correction — it is always returned as `Either`'s
  `Left`).

## Interfaces and boundaries

- Consumes: task 01's fixed, characterized baseline (no folder reorganization precedes
  this area — D15) and task 02's `IEventStreamStore`/repository split and
  `AggregateConcurrencyException`.
- Provides to task 05 (registration): the two route kinds (convention/explicit) that
  become Fallback/Primary respectively.
- Provides to task 07 (authorization): the **one** aggregate-aware authorization hook
  point (after load, before decision, `Option<TAggregate>`-typed) — static/message-level
  permission checks are not a hook this executor exposes; they already ran upstream in
  the messaging pipeline before the executor is invoked (D25).
- Provides to task 10 (Documents example): the public `IEventSourcedCommandHandler<...>`
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
   `Either<Exception, _>.Left` containing an `AggregateConcurrencyException` instance —
   never thrown, never swallowed, never a different type (D13 correction).
5. The explicit Level 2 handler can delegate to Level 1's own decision-method discovery
   without duplicating the aggregate's transition logic — proven by an example handler
   that does so, for both the `Some` (existing aggregate) and `None` (creation) cases
   (D24).
6. Neither the executor's public entry point(s) nor its internal contracts require the
   aggregate's next state to come from an instance method on an immutable state object
   (D17).
7. The executor's own code never calls into `ValidatePermissionMiddleware`,
   `IDataScopeMessageValidator`, or any other normal-permission-check type — inspection,
   per D25.
8. The executor maps `Option<TAggregate>.None` to `NoStream` and loaded
   `Option<TAggregate>.Some` to `Exact(loaded.Version)` when appending — proven by a test
   exercising both the creation path and the mutation path and asserting the expected-
   stream-state value passed to the store in each case (D29).
9. The executor class itself contains no reflection/state-method-discovery logic — that
   code lives only in `AggregateDecider`/`AggregateEvolver` — and no
   `IDecisionStrategy`-style plugin/strategy hierarchy exists anywhere in this area's
   diff (inspection, per D30).

## Dependencies

- `characterization-and-baseline` (task 01).
- `persistence-boundary` (task 02) — needs the hardened store/repository contracts and
  the concurrency exception.

## Out of scope

- Handler registration role metadata / Primary-Fallback resolution rules (area
  `handler-registration-and-options`).
- Normal message-level/handler-level permission checks and their implementation
  (area `authorization-integration`, entirely in the messaging pipeline, D25) —
  this area exposes only the one aggregate-aware hook point.
- Any decision-strategy/plugin hierarchy (`IDecisionStrategy` or similar) intended to
  make the executor host multiple decision mechanisms — the executor depends on the
  existing `IDecider`/`IEvolver` shape only (D30).
- An `Any`/`IgnoreVersion` expected-stream-state case and automatic retry/rebase logic
  on concurrency conflict (D29) — a conflict always surfaces as `Either.Left`, never
  retried by the executor.
