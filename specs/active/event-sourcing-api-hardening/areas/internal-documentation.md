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
ordering; convention discovery internals and most-specific-wins resolution; Primary/
Fallback registration internals; the `IEventStreamStore`/`IAggregateRepository`
boundary; concurrency flow; authorization pipeline position; transaction/flush
assumptions (corrected per D7); and extension points/compatibility constraints for
future persistence providers and modeling styles (D17). Also correct the three stale
`messaging-pipeline.md` statements above.

## Constraints

- Documentation describes current behavior after this change lands, not aspiration.
- Correct the `status:` field precisely — the persistence layer may still legitimately
  be `experimental` (no real provider ships in this change) even though the API
  surface around it (command handling, registration, authorization) is now hardened;
  state this distinction rather than picking one blanket status.

## Interfaces and boundaries

- Consumes: every functional task's shipped shape (tasks 02-07, 09-10).
- Produces: `docs/development/event-sourcing.md`, corrected
  `docs/development/messaging-pipeline.md`.

## Area-specific acceptance criteria

See task 12's own acceptance criteria.

## Dependencies

Every functional task in this change (02-07, 09-10).

## Out of scope

- User-facing task guidance (`user-facing-documentation.md`).
- Rewriting `messaging-pipeline.md` beyond the three identified corrections.
- Any new ADR.
