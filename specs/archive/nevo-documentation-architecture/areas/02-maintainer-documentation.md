# Area: Maintainer documentation

## Responsibility

Consolidate `docs/architecture/*` (9 files) and the subsystem-relevant parts of
`docs/development/*` into one `docs/development/` maintainer tree, filling the
missing-invariant gaps this change's discovery found and fixing the 5 newly-found
documentation inconsistencies (D4).

## Current state

`docs/architecture/` (overview, package-boundaries, messaging-pipeline,
processing-model, message-context, inbox-outbox, persistence, event-sourcing,
orchestration) and `docs/development/` (local-setup, coding-conventions, testing,
git-workflow, commit-conventions, pull-requests) are two separate directories today.
Several maintainer-relevant questions are unresolved or unconsolidated:
`docs/architecture/persistence.md`'s "Open questions — transaction ownership" section
(lines 43-61) lists 5 unanswered questions and states these are "currently determined
by the example application"; no doc states event-fan-out failure/partial-failure
semantics or whether middleware registration order is a guaranteed contract; the
`IMessageHandlerFactory` extension contract and the "forbidden extension approaches"
list are each scattered across package "Limitations" sections, never consolidated.
`docs/guides/extending-nevo.md` currently mixes consumer-facing content (adding your
own handler using existing extension points) with maintainer-facing content (adding a
new transport or persistence mechanism to NEvo itself).

## Requirements

- Migrate and merge `docs/architecture/overview.md` → `docs/development/architecture-overview.md`,
  `package-boundaries.md`, `messaging-pipeline.md`, `processing-model.md`,
  `message-context.md`, `inbox-outbox.md`, `event-sourcing.md`, `orchestration.md` into
  `docs/development/` (same filenames, new location) — content tightened per the
  "Maintainer documentation" rules (subsystem responsibility, control/data flow, stable
  guarantees, ordering, transaction ownership, failure semantics, extension points,
  forbidden approaches, required tests, unresolved decisions), not just moved verbatim.
- Elevate `persistence.md`'s open-questions section into `docs/development/transaction-model.md`
  — state explicitly what is known and what remains genuinely unresolved (do not invent
  an answer the code doesn't support).
- Create `docs/development/failure-semantics.md` — event fan-out partial-failure
  behavior, the middleware-ordering guarantee question, outbox partition-assignment
  semantics (currently "not yet formally specified" per `architecture/inbox-outbox.md:65-66`).
- Create `docs/development/extension-points.md` — the `IMessageHandlerFactory` contract
  a third-party handler-type author must implement, and a consolidated "forbidden
  extension approaches" list (currently scattered warnings in package Limitations
  sections, e.g. `NEvo.Orchestrating.md:209-215`, `NEvo.Messaging.Authorization.md:177-180`).
- Split `docs/guides/extending-nevo.md`: the maintainer-facing "add a transport" and
  "add a persistence mechanism" content moves to new
  `docs/development/transport-development.md` and `persistence-development.md`
  respectively; the consumer-facing "add a handler for my own command/event" content is
  handed off to area `usage-guides` (task `usage-commands-and-events`) rather than
  duplicated here.
- `docs/development/testing.md` → `docs/development/testing-strategy.md`, augmented
  with which tests are required when changing each subsystem covered above.
- Create `docs/development/contributing.md` — a thin entry point linking
  `coding-conventions.md`, `commit-conventions.md`, `git-workflow.md`, `local-setup.md`,
  `pull-requests.md` (these 5 files' content is unchanged).
- Fix, in the file that now owns the fact: the CQRS query-side claim, the
  orchestration-persistence claim, the maturity-vocabulary mismatch, the stale
  `NEvo.Web` "ASP.NET Core integration" line, and the `ICommand`/`Command`-record naming
  mismatch (D4).

## Constraints

Per the source-of-truth rule: each concept (transaction ownership, failure semantics,
extension points, etc.) ends up in exactly one file in this area; package reference
pages (area `package-reference`) link to these files rather than restating them.
`docs/development/*` describes current behavior only.

## Interfaces and boundaries

Consumed by: `package-reference` (links instead of duplicating), `usage-guides`
(troubleshooting.md and inbox-outbox.md cross-link failure-semantics.md and the
maintainer inbox-outbox.md), `navigation-and-ai-routing` (entry point and AI routing
point into this tree).

## Area-specific acceptance criteria

- `docs/architecture/` no longer exists; every file it held is either merged into
  `docs/development/` or its content is demonstrably absorbed elsewhere (name any such
  case explicitly — do not silently drop a file).
- `docs/development/transaction-model.md` states explicitly which of the 5 original
  open questions remain open after this change (elevating a question is not the same as
  answering it).
- All 5 D4 inconsistencies are resolved to one authoritative statement each.

## Dependencies

Depends on area `foundation` (maintainer-doc template). Feeds area `package-reference`
and area `usage-guides`.

## Out of scope

The known-issues document (area `known-issues`) — defects stay defects, they do not
become "unresolved design decisions" in these maintainer docs. Any package-doc content
(area `package-reference`).
