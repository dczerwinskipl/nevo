---
review-of: task
change: event-sourcing-api-hardening
task: message-level-and-aggregate-authorization
generated: 2026-08-12
verdict: pass
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
---

# Review: event-sourcing-api-hardening/message-level-and-aggregate-authorization

No reliable previous-file baseline is available. Performing a fresh review of the
current task implementation.

**Part (b) (the aggregate-aware hook) was already fully implemented under this
change's earlier work on the shared executor** — `IAggregateAuthorization<TCommand,
TAggregate,TId>`, invoked by `EventSourcedCommandExecutor` after rehydration/before the
decision, `Option<TAggregate>`-typed, no `NEvo.Ddd.EventSourcing` →
`NEvo.Messaging.Authorization` project reference (confirmed: `NEvo.Ddd.EventSourcing
.csproj` references only `NEvo.Messaging.Cqrs`/`NEvo.Messaging`). This task's own
contribution to part (b) is one added test proving a denial actually prevents
append/decision on both the create and mutate paths — the executor already received
`Some`/`None` correctly (proven earlier), but nothing previously proved a `Left` from
the hook stopped the pipeline rather than merely being observed.

**Part (a)** — the genuinely new work: `AllowPermissionAttribute` widened to
`AttributeTargets.Method | AttributeTargets.Class` (extending the existing attribute,
per the task's own stated preference, rather than a distinct type).
`ValidatePermissionMiddleware` now reads message-level attributes from
`message.GetType()` in addition to the existing handler-level read from
`HandlerDescription.Method`, and requires both sets independently (AND) — an empty set
still imposes no restriction, preserving exact pre-existing behavior when no
message-level attribute exists. This closes the confirmed-live gap: a Fallback-routed
command (`Method == null`) now still enforces its message-level requirement. New
`tests/NEvo.Messaging.Authorization.Tests` project (none existed before) covers: message-
level-only denial/allow, AND composition in both directions (message-only vs.
handler-only), both-satisfied allow, and the handler-only regression case (message-level
set empty, behaving exactly as before message-level attributes existed).

## Acceptance criteria

- [x] All 7 acceptance criteria covered.
  1. Fallback route + message-level requirement denies a user lacking it —
     `ExecuteAsync_MessageLevelPermissionRequired_NoHandlerMethod_UserLacksPermission_Denies`
     (`Method: null` simulates the Fallback route exactly).
  2. Handler-specific requirement enforced in addition (AND) —
     `ExecuteAsync_MessageAndHandlerPermissionsRequired_UserHasOnly*_DeniesOnThe*LevelRequirement`
     (both directions).
  3. Aggregate-aware hook receives `Some`/`None` correctly (pre-existing coverage) and a
     denial prevents append in either case — new
     `ExecuteAsync_AuthorizationHookDenies_PreventsAppendAndDecision_OnBothCreateAndMutatePaths`.
  4. Permission resolution for the Fallback route doesn't depend on `Method` — same
     test as AC1.
  5. Pre-existing handler-level enforcement unchanged —
     `ExecuteAsync_OnlyHandlerLevelPermissionRequired_UserLacksIt_Denies`/`_UserHasIt_Allows`.
  6. `NEvo.Ddd.EventSourcing.csproj` has no `NEvo.Messaging.Authorization`
     `ProjectReference` — confirmed by direct read of the csproj.
  7. No cross-calls between the executor and part (a)'s pipeline, or vice versa —
     confirmed by design; neither file references the other's logic.

## Scope

- [x] Scope: compliant — `src/NEvo.Messaging.Authorization/**`,
  `src/NEvo.Ddd.EventSourcing/**`, the new `tests/NEvo.Messaging.Authorization.Tests/**`
  project, `tests/NEvo.Ddd.EventSourcing.Tests/**`, and `NEvo.sln` are all declared
  `allowed_paths`. No forbidden path touched — `tests/NEvo.Web.Authorization.Tests`
  untouched, no `NEvo.Messaging.Web` reference added.

## Verification

- `dotnet build` — passed (whole solution)
- `dotnet test tests/NEvo.Messaging.Authorization.Tests` — passed, 8/8 (new project)
- `dotnet test tests/NEvo.Ddd.EventSourcing.Tests` — passed, 60/60

## Findings

None.
