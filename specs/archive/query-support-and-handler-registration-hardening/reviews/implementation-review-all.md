---
review-of: implementation-all
change: query-support-and-handler-registration-hardening
generated: 2026-08-09
verdict: pass
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
tasks_eligible_for_verification:
  - command-event-adapter-characterization
  - shared-handler-invocation-adapter
  - registration-idempotency-hardening
  - query-abstractions-and-discovery
  - query-dispatch-and-registration
  - documentation-and-example
tasks_must_remain_unchanged: []
---

# Aggregate implementation review: query-support-and-handler-registration-hardening

Independent re-review of all six tasks after the explicit-interface handler-resolution
fix landed. Baselines: the six individual task review files in `reviews/`. All prior
`pass` verdicts are confirmed; no previously-resolved findings are re-raised.

## Overall verdict

**pass** — all six tasks pass their acceptance criteria. All tests pass (150/150 across
six test assemblies). `dotnet build` reports 0 errors. `node tools/docs.mjs validate`
reports 61 documents, no errors. `node tools/specs.mjs validate` reports 7 changes, no
errors.

---

## Per-task results

### T01 · command-event-adapter-characterization — `pass`

- AC1 ✓ `tests/NEvo.Messaging.Cqrs.Tests` exists, references in `nevo.sln`, builds.
- AC2 ✓ `CommandHandlerAdapterTests.HandleAsync_CallsCommandHandler_AndReturnsSuccess`.
- AC3 ✓ `CommandProcessingStrategyTests.ProcessMessageAsync_ReturnsLeft_WhenNoHandlerFound` / `…WhenMoreThanOneHandlerFound`.
- AC4 ✓ `HandleAsync_ReturnsException_WhenHandlerThrows` asserts exact instance identity (`.BeSameAs`).
- AC5 ✓ `HandleAsync_ReturnsExactExceptionInstance_WhenHandlerThrowsSynchronouslyBeforeReturningTask` uses `Mock.Throws(exception)` (not `ThrowsAsync`) and asserts `.BeSameAs` — the previously-missing case now present.
- AC6 ✓ `CommandDispatcherTests` covers both context creation and reuse paths.
- AC7 ✓ `CommandProcessingStrategyTests` covers `ShouldApply` (true for `Command`, false for `Event`) and `ProcessMessageAsync`.
- AC8 ✓ `CommandHandlerAdapterFactoryTests` covers `ForInterface`, `Create`, `GetMessageHandlerDescriptions`, and explicit-interface dispatch.
- Scope: compliant (only `tests/NEvo.Messaging.Cqrs.Tests/**`).

### T02 · shared-handler-invocation-adapter — `pass`

- AC1 ✓ `MessageHandlerAdapterBase<TMessageGroup>`, `CommandHandlerAdapter`, `EventHandlerAdapter` absent from `src/` (confirmed by `grep_search`).
- AC2 ✓ All T01 characterization tests pass unchanged.
- AC3 ✓ All `EventHandlerAdapter*Tests` pass (part of 72 `NEvo.Messaging.Tests` tests).
- AC4 ✓ `MessageHandlerAdapter` in `NEvo.Messaging/Handling/` is `public`; no `InternalsVisibleTo` used.
- AC5 ✓ `TargetInvocationException` caught, unwrapped to `InnerException` (falling back to `exc` if null) before returning as `Left`.
- AC6 ✓ Handler resolved via `ActivatorUtilities.CreateInstance`; method invoked via `HandlerDescription.Method.Invoke`.
- AC7 ✓ `EventHandlerAdapterFactoryTests.GetMessageHandlerDescriptions_And_Dispatch_WorkWithExplicitInterfaceImplementation` + `CommandHandlerAdapterFactoryTests` equivalent — both factory tests exercise explicit-interface handlers.
- `InterfaceMethodResolver.Resolve` used by all three factories; `InterfaceMap` index lookup prevents `TargetMethods.First()`-by-name failure for explicitly-implemented methods.
- Scope: compliant.

### T03 · registration-idempotency-hardening — `pass`

- AC1 ✓ `ServiceCollectionExtensionsTests.AddCommands_CalledTwice_DoesNotThrow`.
- AC2 ✓ `AddEvents_CalledTwice_DoesNotThrow`.
- AC3 ✓ `AddCommands_CalledTwice_RegistersSingleHandlerFactoryAndStrategy`.
- AC4 ✓ `AddEvents_CalledTwice_KeepsBothStrategiesRegisteredExactlyOnce`.
- AC5 ✓ `AddMessages_AddCommands_AddEvents_Composed_RegistersEveryExpectedService` asserts every service appears exactly once.
- AC6 ✓ Implicitly confirmed — composed test exercises the full registration path.
- `AddCommands()`: `TryAddEnumerable` for `IMessageHandlerFactory`/`IMessageProcessingStrategy`; `TryAddScoped` for `ICommandDispatcher`/`IMessageDispatchStrategyFactory<Command>`.
- `AddEvents()`: same pattern; both `Parallel` and `Sequential` strategies remain after double call.
- Scope: compliant.

### T04 · query-abstractions-and-discovery — `pass`

- AC1 ✓ `Query<TResult> : Message<TResult>` compiles; abstract record with default + explicit `Id`/`CreatedAt` constructors.
- AC2 ✓ `IQueryHandler<TQuery, TResult> where TQuery : Query<TResult>` compiles with constraint.
- AC3 ✓ `QueryHandlerAdapterFactoryTests.GetMessageHandlerDescriptions_ReflectsActualResultType_ForStringResult` (`ReturnType == typeof(string)`) and `…ForIntResult` (`ReturnType == typeof(int)`).
- AC4 ✓ `MessageHandlerExtractorQuerySupportTests.GetMessageHandlers_DiscoversCommandEventAndQueryHandlers_WithNoExtractorChange` — registers all three factory kinds; `MessageHandlerExtractor` required zero source changes.
- AC5 ✓ `QueryHandlerAdapterFactory.Create(...)` returns `new MessageHandlerAdapter(...)` — no new adapter type.
- `QueryHandlerAdapterFactory` uses `InterfaceMethodResolver.Resolve` (same as Command/Event), so explicit-interface handlers work correctly; confirmed by `QueryHandlerAdapterFactoryTests.GetMessageHandlerDescriptions_And_Dispatch_WorkWithExplicitInterfaceImplementation`.
- `Folder Include="Queries\"` placeholder removed from `.csproj`.
- Scope: compliant.

### T05 · query-dispatch-and-registration — `pass`

- AC1 ✓ `QueryDispatchIntegrationTests.DispatchAsync_ResolvesHandlerFromDI_AndReturnsTypedResult`.
- AC2 ✓ DI resolution verified via a mock `IGreeter` scoped dependency.
- AC3 ✓ `DispatchAsync_NoHandlerRegistered_ReturnsNoHandlerFoundException`.
- AC4 ✓ `DispatchAsync_MultipleHandlersRegistered_ReturnsMoreThanOneHandlerFoundException`.
- AC5 ✓ `DispatchAsync_TwoDifferentResultTypes_BothDispatchCorrectly_ThroughOneSharedStrategyInstance` — one `QueryProcessingStrategy` instance serves `string` and `int` results.
- AC6 ✓ `AddQueries_CalledTwice_RegistersEachServiceExactlyOnce`.
- AC7 ✓ `ComposedRegistration_CommandEventAndQueryDispatch_AllWorkIndependently`.
- AC8 ✓ `CommandAndQueryDispatch_ExecuteMessageAndHandlerMiddleware_InTheSameRelativeOrder` — both produce `["message-start","handler-start","handler-end","message-end"]`.
- AC9 ✓ `DispatchAsync_PropagatesCancellationToken_ToTheHandler`.
- AC10 ✓ `AddQueriesAlone_WithoutAddCommands_IsSufficientToDispatchAQuery`.
- `MessageProcessor.ProcessMessageAsync<TResult>` fixed (owner-approved scope exception F1): unwraps `Either<Exception, TResult>` to `object` via `.Map(value => (object)value!)` before the middleware boundary, then maps back. No double-boxing remains.
- Scope: compliant (1 accepted F1 exception, owner confirmed 2026-08-09).

### T06 · documentation-and-example — `pass`

- AC1 ✓ `node tools/docs.mjs validate` — 61 documents, no errors.
- AC2 ✓ No doc still states query-side is absent/unimplemented; `classification.md` corrected (accepted F1 scope exception, owner confirmed 2026-08-09).
- AC3 ✓ `docs/development/testing-strategy.md` lists `NEvo.Messaging.Cqrs.Tests` in its "Test projects" section.
- AC4 ✓ `docs/reference/packages/NEvo.Messaging.md` notes removal of `MessageHandlerAdapterBase`/`CommandHandlerAdapter`/`EventHandlerAdapter` and addition of `MessageHandlerAdapter` as a breaking change.
- AC5 ✓ by inspection: `GetDocumentQuery`/`GetDocumentQueryHandler`/`DocumentDto` added; `Routes.cs` wires `GET /api/document/{documentId}` to `IQueryDispatcher`; `AddQueries()` and handler registration in `Program.cs`. `InMemoryDocumentEventStore` is an intentionally documented workaround (comment header and inline `// WORKAROUND` notice), pending PR #10's real Event Sourcing work — not a new pattern. A full runtime verification requires the Aspire AppHost with a real SQL Server (pre-existing environmental constraint unrelated to this task).
- `docs/usage/queries.md` new guide: covers `Query<TResult>`, `IQueryHandler<TQuery,TResult>`, `IQueryDispatcher.DispatchAsync`, discovery, failure modes, and cross-reference to commands/events.
- Scope: compliant (1 accepted F1 exception for `classification.md`).

---

## Cross-task integration findings

**No blocking cross-task findings.** Observations:

1. **Shared adapter contract** — `MessageHandlerAdapter` is constructed by all three
   factories (`CommandHandlerAdapterFactory`, `EventHandlerAdapterFactory`,
   `QueryHandlerAdapterFactory`). The `MessageHandlerDescription.Method` and `ReturnType`
   fields are populated consistently across all three; `MessageHandlerAdapter`'s generic
   `InvokeHandlerAsync<TResult>` casts correctly using `ReturnType` for any handler kind.

2. **`InterfaceMethodResolver` coverage** — all three factories call
   `InterfaceMethodResolver.Resolve`, so explicit-interface implementations are handled
   correctly everywhere. Tested: `CommandHandlerAdapterFactoryTests`,
   `EventHandlerAdapterFactoryTests`, and `QueryHandlerAdapterFactoryTests` each include
   an explicit-interface dispatch test.

3. **Middleware order symmetry** — `CommandAndQueryDispatch_ExecuteMessageAndHandlerMiddleware_InTheSameRelativeOrder`
   confirms both message-level and handler-level middleware fire in identical relative
   order for Commands and Queries. Events use the same middleware infrastructure;
   no asymmetry introduced.

4. **DI idempotency across all three kinds** — `AddMessages()+AddCommands()+AddEvents()+AddQueries()`
   composed together register each service exactly once; Query does not require Command
   support (`AddQueriesAlone` test).

5. **`MessageProcessor.ProcessMessageAsync<TResult>` fix (F1, task 05)** — the
   unwrap-before-boxing fix is self-consistent: the non-generic `ProcessMessageAsync`
   (for Commands/Events) was already correct; only the generic overload needed the fix.
   The `QueryProcessingStrategy.HandleAsync<TResult>` cast `(TResult)obj` at the
   strategy boundary is safe because `MessageHandlerAdapter.InvokeHandlerAsync<TResult>`
   casts `value => (object)value!` under the same `TResult` type parameter.

6. **`InMemoryDocumentEventStore` (ExampleApp workaround)** — correctly documented as a
   temporary workaround in both the class header comment and `DocumentQueries.cs`. The
   ExampleApp Program.cs registers it after `AddEventSourcing()`, replacing the
   `FakeEventStore`. This is out of scope for any task's acceptance criteria; no task
   requires a genuine Event Sourcing implementation.

7. **`MessageHandlerExtractor` unchanged** — confirmed. Zero source changes to
   `MessageHandlerExtractor`; `QueryHandlerAdapterFactory.ForInterface = typeof(IQueryHandler<,>)`
   is correctly picked up by the `handlerInterface.GetGenericTypeDefinition()` lookup in
   `GetMessageHandlers()`.

8. **No `IMessageProcessingStrategyWithResult` registration conflict** — `QueryProcessingStrategy`
   is registered via `TryAddEnumerable` for `IMessageProcessingStrategyWithResult`;
   `MessageProcessingStrategyFactory.CreateForMessageWithResult` resolves the first
   matching strategy. Since `QueryProcessingStrategy.ShouldApply<TResult>` checks
   `message is Query<TResult>`, and no other `IMessageProcessingStrategyWithResult` is
   registered, the strategy is unambiguously selected for all Query types.

---

## Verification summary

| Check | Result |
|---|---|
| `dotnet build nevo.sln` | ✓ 0 errors, 2 pre-existing warnings |
| `dotnet test nevo.sln` | ✓ 150/150 passed (0 failures, 0 skipped) |
| `node tools/docs.mjs validate` | ✓ 61 documents, no errors |
| `node tools/specs.mjs validate` | ✓ 7 changes, no errors |

Test assembly breakdown: `NEvo.Core.Tests` (16), `NEvo.Web.Authorization.Tests` (13),
`NEvo.Messaging.Tests` (72), `NEvo.Orchestrating.Tests` (5),
`NEvo.Messaging.Cqrs.Tests` (34), `NEvo.Ddd.EventSourcing.Tests` (10).

---

## Unresolved findings

None.

---

## Owner gate

All six tasks are eligible for `verified`. The change has no remaining unresolved
findings and all verification checks pass.

**Choose one:**

1. **Mark all six tasks `verified`** (bulk transition via `node tools/specs.mjs verify-all query-support-and-handler-registration-hardening` or equivalent).
2. **Mark all six tasks `implemented`** (self-verified, no status promotion).
3. **Leave statuses unchanged**.

Awaiting your explicit choice before any status transition is run.
