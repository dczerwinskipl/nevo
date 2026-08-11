---
review-of: task
change: event-sourcing-api-hardening
task: primary-fallback-handler-roles
generated: 2026-08-11
verdict: pass
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
scope_exceptions:
  - path: src/NEvo.Messaging.Cqrs/Commands/CommandHandlerAdapterFactory.cs
    finding_id: F1
    reason: >
      D3 requires every ordinary ICommandHandler<T> registration to carry
      Role: Primary (so a genuine two-Primary conflict, e.g. an explicit ES handler vs.
      an ordinary command handler, fails deterministically) — the task's own
      Implementation Constraints text names this exact file and change ("Command
      HandlerAdapterFactory ... mark their descriptions Primary"), but the file sits
      outside this task's declared allowed_paths (src/NEvo.Messaging.Cqrs/** is not
      listed; only src/NEvo.Messaging/Handling/** and src/NEvo.Ddd.EventSourcing/** are).
      Same class of gap as task 02's InMemoryDocumentEventStore exception this
      session — a context-packet omission, not a deliberate exclusion. One-line change:
      added Role: HandlerRole.Primary to the constructed MessageHandlerDescription.
    decision: accepted
    confirmed_by: owner
    confirmed_at: 2026-08-11
    task_fingerprint: 978adff57fa22852716e883510fdfc534c64a47619fd5c861fbff40eaa0ec0dc
---

# Review: event-sourcing-api-hardening/primary-fallback-handler-roles

Re-review (2026-08-11). Baseline: this file's prior content (`pass`). Owner code review
found one blocking gap this task's own text had already named but the implementation
never built:

- **F4 (resolved, was BLOCKER)**: Level 2 (`IEventSourcedCommandHandler<,,>`/
  `EventSourcedCommandHandlerAdapter`, task 04) was never actually discoverable as a
  message handler. `MessageHandlerExtractor` only recognizes a generic handler interface
  when some registered `IMessageHandlerFactory.ForInterface` matches it —
  `CommandHandlerAdapterFactory` only handles `ICommandHandler<>`, and
  `DeciderCommandHandlerProvider` only produces the convention Fallback. No factory
  existed for `IEventSourcedCommandHandler<,,>`, even though this task's own
  Implementation Constraints text explicitly names "task 04's new explicit-handler
  factory" as something that should exist and carry `Role: Primary`. Every prior Level 2
  test constructed `EventSourcedCommandHandlerAdapter` and registered
  `IEventSourcedCommandHandler<,,>` by hand — proving the adapter/executor work, never
  the real discovery → registry → dispatch path.

  Fixed: added `EventSourcedCommandHandlerAdapterFactory` (`Handling/`), mirroring
  `CommandHandlerAdapterFactory`'s shape — `ForInterface =>
  typeof(IEventSourcedCommandHandler<,,>)`, every produced description tagged
  `Role.Primary`, registered via `AddEventSourcing` as `IMessageHandlerFactory`
  (`TryAddEnumerable`, matching `AddCommands`'s own idempotent registration precedent). A
  concrete Level 2 handler becomes discoverable by adding its type to
  `MessageHandlerExtractorConfiguration.Handlers` — the exact same mechanism every other
  handler kind in this codebase already uses (`AddServiceADomain`/`AddExampleDomain` in
  the example apps), no new configuration surface introduced. New test file
  `EventSourcedCommandHandlerDiscoveryTests.cs` builds a real `ServiceCollection`
  (`AddMessages()` + `AddEventSourcing()` + the handler registration), resolves
  `IMessageHandlerRegistry` for real, and proves: a command with a registered Level 2
  handler resolves to it as `Primary` (not the convention `Fallback`); a command with
  only a convention decider still resolves to `Fallback`; and a full dispatch through the
  real registry (`CreateDocument` via Fallback, then `ApproveDocument` via the resolved
  Level 2 handler) actually invokes the injected orchestration dependency and appends the
  correct event.

`dotnet test tests/NEvo.Ddd.EventSourcing.Tests` passes 38/38 after the fix.

**Not fixed (owner: non-blocking, MEDIUM):** Primary/Fallback conflicts still surface at
`GetMessageHandler()` resolution time, not at `MessageHandlerRegistry` construction/
startup — the spec's stated preference was "fail at startup/registration time where
practical." Left as a follow-up; not addressed in this pass.

## Verdict

`pass` — `HandlerRole` (`Primary`/`Fallback`, no numeric priority, D3) added;
`MessageHandlerDescription` gains an optional `Role` field (default `null`, so any
existing untagged registration is unaffected in shape).
`MessageHandlerRegistry.SelectMessageHandler` now applies role rules only when
`handlers.Count > 1` **and** at least one candidate carries a Role tag — a role-tagged
handler mixed with an untagged one for the same message type is treated as a conflict
(D3 defines no rule for that combination); one Primary wins; no-Primary-one-Fallback
uses the Fallback; two-in-the-same-role is `MoreThanOneHandlerFoundException`, same
exception type/shape non-role conflicts already used, per this task's own
"reuse existing exceptions" constraint. `DeciderCommandHandlerProvider` (Level 1,
convention) now tags `Fallback`; `CommandHandlerAdapterFactory` (Level 3, ordinary
`ICommandHandler<T>`) now tags `Primary` (scope exception above).
`AddEventSourcing`'s registrations (`IMessageHandlerProvider`, `IDecider`,
`IAggregateDeciderProvider`, `IEvolver`) switched from plain `Add*` to
`TryAdd*`/`TryAddEnumerable`, fixing a real duplicate-registration bug on repeated calls
(matching `AddCommands`/`AddEvents`/`AddQueries`'s existing idempotency precedent).
Regression coverage: `NEvo.Messaging.Cqrs.Tests` (34/34, unchanged — Query resolution/
idempotency untouched) and the untagged-conflict tests already in
`MessageHandlerRegistryTests` (unchanged, still passing) prove role logic never
activates without a Role tag. `dotnet build NEvo.sln` succeeds (0 errors);
`dotnet test tests/NEvo.Messaging.Tests` passes 77/77 (72 + 5 new); `dotnet test
tests/NEvo.Messaging.Cqrs.Tests` passes 34/34 (33 + 1 new Role assertion);
`dotnet test tests/NEvo.Ddd.EventSourcing.Tests` passes 33/33 (31 + 2 new idempotency
tests).

- [x] Acceptance criteria: 7/7 (task file) — area AC7's Query/Event/idempotency proof
      requirement satisfied by the unchanged `NEvo.Messaging.Cqrs.Tests`/
      `NEvo.Messaging.Tests` suites passing as-is, not by inspection alone
- [x] Scope: accepted exception (1 entry above — one file outside the declared
      allowed_paths, owner-approved mid-implementation; no other file outside
      `src/NEvo.Messaging/Handling/**`, `src/NEvo.Ddd.EventSourcing/**`,
      `tests/NEvo.Messaging.Tests/**`, `tests/NEvo.Messaging.Cqrs.Tests/**`,
      `tests/NEvo.Ddd.EventSourcing.Tests/**` touched)
- [x] Findings: none unresolved
