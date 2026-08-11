---
review-of: task
change: event-sourcing-api-hardening
task: event-sourcing-registration-options
generated: 2026-08-12
verdict: pass
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
---

# Review: event-sourcing-api-hardening/event-sourcing-registration-options

No reliable previous-file baseline is available. Performing a fresh review of the
current task implementation.

`EventSourcingOptions` (new, flat, one `UseAggregateMethodFallback` bool defaulting to
`true`) plus an additive `AddEventSourcing(Action<EventSourcingOptions>, params
Type[])` overload. The existing `AddEventSourcing(params Type[])` now delegates to it
with default options — unchanged call sites, unchanged behavior. The toggle gates only
`DeciderCommandHandlerProvider`'s registration (the thing that makes
`MessageHandlerRegistry` auto-route to the aggregate-method convention); the
decider/evolver machinery an explicit Level 2 handler needs via
`IAggregateMethodDecider` stays registered regardless, so disabling the toggle doesn't
strand an explicit handler. `DeciderCommandHandlerProvider`'s own registration was
already `TryAddEnumerable` (fixed in an earlier pass of this change, not this task) —
confirmed idempotent for both overloads by test, not just inspection.

## Acceptance criteria

- [x] All 5 acceptance criteria covered — `services.AddEventSourcing(options =>
  options.UseAggregateMethodFallback = false)` withholds the convention route
  (`ServiceCollectionExtensionsOptionsTests.cs`); the old overload's call sites/behavior
  unchanged; fallback-disabled leaves an explicit handler usable
  (`AddEventSourcing_ConventionFallbackDisabled_ExplicitHandlerForADifferentCommand_RemainsUsable`);
  both overloads idempotent, independently and combined
  (`ServiceCollectionExtensionsIdempotencyTests.cs`); `AggregateExtractorConfiguration
  .AggregateTypes` populated through both overloads.

## Scope

- [x] Scope: compliant — every changed path is under `src/NEvo.Ddd.EventSourcing/**` or
  `tests/NEvo.Ddd.EventSourcing.Tests/**`, both in `allowed_paths`. No forbidden path
  touched.

## Verification

- `dotnet build` — passed (whole solution)
- `dotnet test tests/NEvo.Ddd.EventSourcing.Tests` — passed, 59/59 at the time this
  task was implemented (60/60 after task 07's later addition — re-run, still green)

## Findings

None.
