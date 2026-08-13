# Area: User-facing documentation

## Responsibility

Deliver `docs/usage/event-sourcing.md` as a first-class, comprehensive consumer guide —
a developer using NEvo must be able to configure, model, handle commands, authorize,
persist, and read/query with Event Sourcing without reading framework source.

**Scope note (2026-08-10, spec-refine):** this area is new — external review found the
original specification's documentation scope too internals-focused and left user-facing
documentation as an implicit, unscoped "update docs" note rather than a concrete
deliverable. This area (and its one task, 11) exists specifically to fix that; the
internal/maintainer documentation is a separate area (`internal-documentation.md`), kept
separate because it serves a different audience and, per this repository's own
convention (`docs/usage/` vs. `docs/development/`), always has.

## Current state

`docs/usage/` follows a flat one-file-per-topic convention (`commands.md`, `events.md`,
`authorization.md`, `inbox-outbox.md`, etc.), `type: guide` front matter
(`id`/`type`/`title`/`status`/`summary` required per `tools/docs/service.mjs`'s
`REQUIRED_FIELDS.guide`), indexed from `docs/usage/README.md`'s guide table. No Event
Sourcing guide exists there today — `docs/usage/example-app-walkthrough.md` mentions
event sourcing only as part of its ExampleApp tour, and `docs/usage/queries.md`
documents the current hand-wired `MapGet` pattern this change's task 08 replaces with
`MapQueryEndpoint`.

## Requirements

Cover, in one comprehensive guide following the existing flat-file convention (not a
new subdirectory structure): the Event Sourcing mental model; configuration
(`AddEventSourcing(options => {...})`); modeling aggregates (the current OO-immutable
convention, explicitly framed as the supported default per D17, not the core's
permanent definition); all three command-handling levels with explicit "when to use
each" guidance; **decision-method parameter injection** (task 13) — how and when a
decision method may declare additional, framework-resolved parameters beyond the
command and every declared parameter being required and resolved/validated before the
decision method runs (D44), and `ICurrentUser<TId, TUser>` (task 14) as the concrete,
identity-only example;
Primary/Fallback handler registration and fallback semantics; authorization
(message-level, handler-specific additive, aggregate-aware, **and the 401/403/500 HTTP
semantics from task 15** — unauthenticated → 401 via the existing ASP.NET path,
authenticated-but-denied → 403 via the typed `PermissionDeniedException`, anything else →
500); persistence and concurrency (Event Store/repository split,
`AggregateConcurrencyException` via `Either`, append/flush-vs-commit per the corrected D7
facts); the Query/read side (`MapQueryEndpoint`, GET binding per D18, the intermediate
read-path framing, **the final `RequireSome`-based query-handler shape from task 16**,
and a future-projections direction-only note); and a link to the Documents example
(reflecting its final `ApprovedBy` behavior, task 14) as the canonical walkthrough.

## Constraints

- Follow the existing `docs/usage/*.md` flat-file convention — do not introduce a new
  `docs/usage/event-sourcing/` subdirectory structure; this repository has no precedent
  for multi-file topic guides and the input review explicitly allows deviating from its
  own suggested directory-shaped naming when repository convention suggests otherwise.
- Do not document unimplemented capabilities (mutable aggregates, static/functional
  deciders, persisted projections) as available — a short, clearly labeled "future
  direction" note is sufficient for each.
- Never write speculative "how to use projections" content before a projection API
  exists.

## Interfaces and boundaries

- Consumes: every functional task's shipped shape (tasks 02-07, 09-10, 13-16) and the
  Documents example (tasks 09-10, updated by 14-15) as the canonical walkthrough.
- Produces: `docs/usage/event-sourcing.md`, plus targeted updates to
  `docs/usage/README.md`, `docs/usage/queries.md`, `docs/usage/choosing-packages.md`,
  `docs/usage/example-app-walkthrough.md`.

## Area-specific acceptance criteria

See task 11's own acceptance criteria — in particular, the explicit list of "required
reader questions" a reviewer must be able to answer from the guide alone, and the
"no speculative capability documentation" check.

## Dependencies

Every functional task in this change (02-07, 09-10, 13-16).

## Out of scope

- Internal/maintainer architecture documentation (`internal-documentation.md`).
- Any speculative documentation of unimplemented capabilities.
