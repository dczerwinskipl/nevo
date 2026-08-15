# Area: Internal documentation

## Responsibility

Rewrite `docs/development/event-sourcing.md` for maintainers/contributors — the
implementation architecture the user-facing guide (`user-facing-documentation.md`)
deliberately does not cover — and correct the three stale statements in
`docs/development/messaging-pipeline.md` found during the original discovery pass.

**Scope note (2026-08-10, spec-refine):** split out of the original single
"documentation" area/task per external review's demand for a first-class user-facing
deliverable — this area now owns only the maintainer-facing half.

## Current state

`docs/development/event-sourcing.md` (`status: experimental`) documents the
pre-hardening abstractions (`IEventStore` with a `LoadProjectionAsync` member, no
versioning parameter) — already stale against the current interfaces before this change
lands, and needs a full rewrite reflecting the hardened design.

`docs/development/messaging-pipeline.md` contains three stale statements found during
discovery, independent of this change's own scope: it names a message-level
`AuthorizationMiddleware` and handler-level `AuthorizationHandlerMiddleware` as if two
distinct classes existed — no class named either exists; the real classes are
`UserContextMiddleware<TId,TRoleDataScope>` (message-level) and
`ValidatePermissionMiddleware<TId>` (handler-level only). It states `IMessageProcessor`
is "defined in `src/NEvo.Messaging/Processing/`" — the actual location is
`src/NEvo.Messaging/Handling/IMessageProcessor.cs`. It still references
"`MessageHandlerAdapterBase` subclasses" — that type no longer exists anywhere in
`src/` after the archived query-support change replaced it with one shared
`MessageHandlerAdapter`.

## Requirements

Cover, for a maintainer audience: the Event Sourced command executor's lifecycle and
ordering; convention discovery internals and most-specific-wins resolution; **decision-
method parameter injection internals** — the `IDecisionMethodParameterResolver` seam,
DI-backed per-invocation resolution, and why it stays inside the convention's own
discovery path rather than the shared executor (D30, D34); Primary/
Fallback registration internals; the `IEventStreamStore`/`IAggregateRepository`
boundary; concurrency flow (`AggregateConcurrencyException` returned via `Either`,
never thrown, D13); the authorization ownership split — normal message/handler checks
entirely in `NEvo.Messaging.Authorization`'s pipeline, the executor invoking only the
aggregate-aware hook, with no `NEvo.Ddd.EventSourcing` → `NEvo.Messaging.Authorization`
dependency (D25-D26); **the required-contextual-dependency invariant** (D44): a required
contextual decision-method dependency must be successfully resolved *and validated*
during DI resolution/activation, before the decision method is invoked — a dependency
that resolves as a type but only reports unavailability once the decision method starts
running is an invocation/application failure, not a parameter-resolution failure;
**the current-user/authorization boundary** — `ICurrentUser<TId, TUser>`
lives in `NEvo.Messaging.Authorization`, adapts `UserContext<TId, TUser>` internally, and
is resolved into aggregate decision methods purely by DI `Type`, never by a compile-time
reference from `NEvo.Ddd.EventSourcing` (D35, D43); its required user is obtained and
validated during `CurrentUser<TId, TUser>`'s own construction, not lazily from the `User`
getter (D44); **typed authorization-failure/HTTP-
mapping boundary** — `PermissionDeniedException` (`NEvo.Messaging.Authorization`) is
recognized in `NEvo.Messaging.Web` via its `UnauthorizedAccessException` base type, with
no project reference added in either direction (D36); the explicit `Option<TAggregate>`
Some/None semantics shared by the Level 2 handler and the aggregate-aware hook (D24);
the append/flush/commit storage-contract guarantee (D23, corrected from the earlier
EF-specific framing); the three-layer persistence-metadata distinction — domain event,
runtime message context, future persisted representation — and why this version does
not freeze the final store SPI (D20-D22); extension points/compatibility constraints for
future persistence providers and modeling styles (D17); and the final query/Either
ergonomics helper, `RequireSome` (`NEvo.Core`), replacing `EitherExtensions.MapAsync`
(D37). Also correct the three stale `messaging-pipeline.md` statements above.

## Constraints

- Documentation describes current behavior after this change lands, not aspiration.
- Correct the `status:` field precisely — the persistence layer may still legitimately
  be `experimental` (no real provider ships in this change) even though the API
  surface around it (command handling, registration, authorization) is now hardened;
  state this distinction rather than picking one blanket status.

## Interfaces and boundaries

- Consumes: every functional task's shipped shape (tasks 02-07, 09-10, 13-16).
- Produces: `docs/development/event-sourcing.md`, corrected
  `docs/development/messaging-pipeline.md`.

## Area-specific acceptance criteria

See task 12's own acceptance criteria.

## Dependencies

Every functional task in this change (02-07, 09-10, 13-16).

## Out of scope

- User-facing task guidance (`user-facing-documentation.md`).
- Rewriting `messaging-pipeline.md` beyond the three identified corrections.
- Any new ADR.
