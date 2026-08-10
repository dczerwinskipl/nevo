# Area: Documentation

## Responsibility

Update durable framework documentation to explain the hardened Event Sourcing mental
model, and correct stale content in `docs/development/messaging-pipeline.md` found
during discovery.

## Current state

`docs/development/event-sourcing.md` (`status: experimental`) documents the pre-hardening
abstractions (`IEventStore` with a `LoadProjectionAsync` member, no versioning
parameter) — stale against the actual current interfaces even before this change lands,
and will need a full rewrite reflecting the hardened design.

`docs/development/messaging-pipeline.md` was found, during discovery, to contain three
stale statements independent of this change: it names a message-level
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

Per the input specification's documentation scope, at minimum cover: the simple
Event Sourced aggregate mental model (command, aggregate state, decision method, domain
event, evolver/apply — framework owns infrastructure); the explicit Event Sourced
handler (when to move orchestration outside the aggregate while keeping framework-
managed load/replay/version/append); the full custom command handler (when the user
intentionally opts out); Primary/Fallback handler resolution rules and duplicate-handler
errors; registration (enabling/disabling the aggregate-method convention fallback);
authorization (operation permission on the message, optional handler-specific additional
requirement, aggregate/resource policy outside the domain object, domain invariant
remains inside the aggregate decision); persistence semantics (append/flush is not
necessarily final transaction commit); the HTTP Query endpoint (GET route/query binding,
`MapQueryEndpoint` usage); a link to the dedicated Documents example as the canonical
Event Sourcing use-case sample.

Also correct, in the same task, the three stale `messaging-pipeline.md` statements found
during discovery (listed above under "Current state") — small, targeted corrections, not
a rewrite of that document.

## Constraints

- Documentation describes current behavior after this change lands, not aspiration —
  per `references/artifact-policy.md` § "When architecture documentation must be
  updated."
- `docs/development/event-sourcing.md`'s `status` field moves from `experimental` only
  if the owner confirms the hardened design is stable enough to drop that status — if
  this task reaches that point, flag it as an explicit note rather than silently
  changing the field (status field changes affecting how future agents treat this
  package are a judgment call worth a one-line callout, not a full owner-gate stop).

## Interfaces and boundaries

- Consumes: the final shape of every other task in this change (this task is sequenced
  last for a reason — it documents what actually shipped, not what was planned).

## Area-specific acceptance criteria

1. `docs/development/event-sourcing.md` accurately describes the post-hardening
   `IEventStreamStore`/`IAggregateRepository` split, Primary/Fallback semantics,
   `AddEventSourcing(options => {...})`, and the three command-handling levels.
2. `docs/development/messaging-pipeline.md`'s three stale statements (identified above)
   are corrected.
3. `node tools/docs.mjs validate` passes.
4. The Documents example (task 11) is linked as the canonical Event Sourcing sample from
   at least one updated document.

## Dependencies

Every functional task in this change (03, 04, 05, 06, 07, 08, 09, 11) — this task
documents their shipped shape.

## Out of scope

- Any change to ADRs (none of this change's decisions rise to a new ADR — see
  `overview.md`; if a task's implementation reveals otherwise, that's a task-level flag,
  not something pre-decided here).
- Rewriting `messaging-pipeline.md` beyond the three stale statements identified.
