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
      D32 (superseding D3's original interpretation) requires the redundant
      Role: HandlerRole.Primary assignment removed from this same factory, now that
      Role defaults to Primary — the task's own Implementation Constraints text names
      this exact file and change, but the file sits outside this task's declared
      allowed_paths (src/NEvo.Messaging.Cqrs/** is not listed; only
      src/NEvo.Messaging/Handling/** and src/NEvo.Ddd.EventSourcing/** are). Same
      class of gap as the original F1 finding this exception renews (a context-packet
      omission, not a deliberate exclusion) — one-line change, removing the now-
      redundant named argument.
    decision: accepted
    confirmed_by: owner
    confirmed_at: 2026-08-11
    task_fingerprint: 18941bf853c5d0b3c73a96ad68c61bfce41f9c80d93ed07ca0c22dad98d39633
---

# Review: event-sourcing-api-hardening/primary-fallback-handler-roles

Third re-review (2026-08-11, D32 post-implementation correction pass). Baseline: this
file's prior content (`pass`, F1 exception recorded against the pre-D32 task
fingerprint `978adff5...`). Per the review-policy re-review rule, that exception's
recorded `task_fingerprint` no longer matches the task's current content (task 05's
spec text changed under D32), so it was re-validated rather than assumed still valid —
same file, same underlying reason (a context-packet omission, not a deliberate
exclusion), so it is renewed against the current fingerprint rather than re-litigated
as a new finding.

This pass corrects task 05's landed implementation per owner-directed spec refinement
D32 (superseding D3's original nullable/opt-in interpretation): `HandlerRole` becomes
non-nullable, `MessageHandlerDescription.Role` becomes a normal `init` property
defaulting to `HandlerRole.Primary` (not a new positional constructor parameter, so
the pre-existing six-parameter positional constructor keeps compiling unchanged), and
`MessageHandlerRegistry.SelectMessageHandler` drops the untagged/mixed-tag/tagged
branching in favor of the direct Primary/Fallback algorithm the spec now states.

- **`MessageHandlerDescription`** (`src/NEvo.Messaging/Handling/IMessageHandler.cs`):
  `HandlerRole? Role = null` (seventh positional parameter) replaced with
  `HandlerRole Role { get; init; } = HandlerRole.Primary` (a normal property on the
  record body). The old six-parameter positional constructor
  (`Key, HandlerType, MessageType, InterfaceType, ReturnType, Method`) is unchanged and
  still compiles for every existing call site — proven by a new
  `MessageHandlerDescriptionTests.cs` (`Constructor_WithoutMentioningRole_DefaultsToPrimary`,
  `ObjectInitializer_CanOverrideRoleToFallback`), not merely asserted.
- **`MessageHandlerRegistry.SelectMessageHandler`**: the "all untagged" / "mixed
  tagged/untagged" / "fully tagged" branches are removed. The algorithm is now: ≤1
  handler → use it; >1 Primary → `MoreThanOneHandlerFoundException`; exactly 1 Primary
  → use it; 0 Primary + 1 Fallback → use it; 0 Primary + >1 Fallback →
  `MoreThanOneHandlerFoundException`. No registration-order tiebreaker, matching D32.
- **Factories**: `CommandHandlerAdapterFactory` and
  `EventSourcedCommandHandlerAdapterFactory` no longer restate
  `Role: HandlerRole.Primary` — both get `Primary` from the property default.
  `DeciderCommandHandlerProvider` still explicitly sets `Role = HandlerRole.Fallback`
  (via an object initializer now, since `Role` is no longer positional) — the one
  intentional-fallback site, unchanged in effect.
- **Tests**: `MessageHandlerRegistryTests.cs`'s "mixed tagged/untagged" test
  (`GetMessageHandler_ReturnsError_WhenARoleTaggedHandlerIsMixedWithAnUntaggedOne`) no
  longer describes a real distinct state under D32 — repurposed to
  `GetMessageHandler_ReturnsError_WhenAnExplicitPrimaryIsMixedWithADefaultPrimary`,
  proving the same two-Primary conflict now happens because both are Primary (one
  explicit, one defaulted), not because of role-tag mixing. Every other
  `Role: HandlerRole.X` named-argument call site converted to an object initializer
  (`{ Role = HandlerRole.X }`), since `Role` is no longer positional.
  `EventSourcedCommandHandlerDiscoveryTests.cs` and
  `CommandHandlerAdapterFactoryTests.cs` were not changed — both already asserted
  `.Role.Should().Be(HandlerRole.Primary)` by reading the produced description, which
  now proves the *default* takes effect rather than an explicit assignment.

`dotnet build` succeeds (0 errors). `dotnet test tests/NEvo.Messaging.Tests` passes
79/79 (77 + 2 new `MessageHandlerDescriptionTests` cases; the mixed-tag test was
repurposed in place, not added or removed). `dotnet test
tests/NEvo.Messaging.Cqrs.Tests` passes 34/34 (unchanged — Query resolution/
idempotency untouched, `CommandHandlerAdapterFactoryTests`'s existing
`Role.Should().Be(HandlerRole.Primary)` assertion now proves the default rather than
an explicit assignment). `dotnet test tests/NEvo.Ddd.EventSourcing.Tests` passes 43/43
(unchanged — `EventSourcedCommandHandlerDiscoveryTests`'s existing Primary/Fallback
assertions prove the same behavior through the real registry, now via defaults for
Primary and one explicit `Fallback` for the convention route).

## Verdict (this pass)

`pass` — D32's implementation constraints are fully satisfied: `HandlerRole` is
non-nullable and defaults to `Primary`; the old positional constructor is preserved;
`MessageHandlerRegistry` implements the direct algorithm with no untagged/tagged
branching; only `DeciderCommandHandlerProvider` sets `Fallback` explicitly; no other
factory restates `Primary`. Acceptance criteria 1-6 (unchanged behavior) continue to
pass via the same test methods (now exercising the new code path); criteria 7-8 (D32's
new criteria — old constructor preserved, factories default to Primary without
restating it) are proven by the new/updated tests above.

- [x] Acceptance criteria: 8/8
- [x] Scope: resolved
  - 1 owner-approved exception renewed (`src/NEvo.Messaging.Cqrs/Commands/CommandHandlerAdapterFactory.cs`, F1, re-validated against the current task fingerprint)
- [x] Findings: none unresolved

---

Second re-review (2026-08-11, implementation-correction pass). Baseline: this file's
prior content (`pass`, F4 resolved below). Owner code review found one further
correctness bug and requested a documentation-hygiene pass:

- **F5 (resolved)**: `DeciderCommandHandlerProvider.GetMessageHandlers()` grouped only by
  `CommandType`, but `AggregateDecider.GetDeciderDescriptions()` reports one description
  per concrete state type that declares a decision method for a command — e.g.
  `EditableDocument.Change` and `ReviewableDocument.Change` both exist for
  `ChangeDocument`. That produced two competing Fallback candidates for what is really
  one convention route, so the registry rejected the command as an unresolvable
  two-Fallback conflict before runtime state ever got a chance to pick the applicable
  method — silent until a command actually had more than one state-specific decider
  (undetected by any prior test). Fixed: group by `(CommandType, AggregateType, IdType)`
  before creating an adapter — one adapter per route, which still delegates
  state-specific selection to the decider registry at execution time. New tests in
  `EventSourcedCommandHandlerDiscoveryTests.cs` prove, through the real
  `IMessageHandlerRegistry`: `ChangeDocument` resolves to exactly one Fallback route, and
  a full dispatch (create → an event that evolves the aggregate into
  `ReviewableDocument` → `ChangeDocument`) selects the most-specific decider end to end.
  Also added a real-registration test proving an ordinary `ICommandHandler<T>` and an
  explicit handler for the same command remain a two-Primary conflict (previously proven
  only with hand-built `MessageHandlerDescription`s, not real factory-driven
  registration).
- **Investigated, left unchanged (owner: non-blocking)**: whether Primary/Fallback
  conflicts could be validated at `MessageHandlerRegistry` construction instead of at
  `GetMessageHandler()` resolution time. The registry already collects every description
  into `_handlers` in its constructor, so eager validation is mechanically straightforward
  — but it changes *when* a conflict surfaces: today, a conflicting pair for a message
  type nobody ever dispatches stays silent; validating eagerly would make any such latent
  conflict fail at first `IMessageHandlerRegistry` resolution, for every message kind this
  shared registry serves (Command, Query, Event), not just Event Sourcing's. That is a
  real behavior-timing change with a blast radius outside this task's own scope, so it was
  left as lazy/on-resolution, matching the instruction to prefer no scope expansion over a
  broader behavior change.
- **Documentation hygiene**: production XML docs/comments across `HandlerRole.cs` and
  `MessageHandlerRegistry.cs` no longer cite decision IDs (`D3`) or "pre-D3" — they
  describe the durable contract and compatibility behavior directly.

`dotnet test tests/NEvo.Ddd.EventSourcing.Tests` passes 43/43 after this pass (38 + 5:
one-Fallback-route, most-specific-through-real-dispatch, two-Primary-conflict-via-real-
registration, and two new `AllowAllAggregateAuthorization` tests — direct behavior plus
resolving as `AddEventSourcing`'s default when no command-specific policy is registered).

---

First re-review (2026-08-11). Baseline: this file's prior content (`pass`). Owner code
review found one blocking gap this task's own text had already named but the
implementation never built:

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
