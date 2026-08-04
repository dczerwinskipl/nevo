# Area: Usage guides

## Responsibility

Migrate `docs/guides/` to `docs/usage/` and create the 6 missing task-oriented guides
this change's discovery audit identified, absorbing consumer-facing usage content
displaced from package reference pages (area `package-reference`) and from
`extending-nevo.md`'s consumer-facing half (area `maintainer-documentation` took the
maintainer-facing half).

## Current state

`docs/guides/` holds `quick-start.md`, `installation.md`, `extending-nevo.md`,
`example-app-walkthrough.md`. Reader goals with no corresponding guide today: which
packages are needed for a given use case, configuring authorization end-to-end,
diagnosing common failures outside one specific example app, inbox/outbox end-to-end
usage, cross-service message dispatch independent of the example app, and adding a
command/event handler as a standalone topic (currently only inside quick-start.md and
extending-nevo.md).

## Requirements

- `docs/usage/quick-start.md` — migrated, process-language stripped, `installation.md`'s
  content folded into its prerequisites (or kept as `docs/usage/installation.md` if
  content doesn't fold cleanly — implementer's call, state which was chosen and why).
  Must end in a successful runnable result (brief's "Task-oriented guides" rule) — do
  not intentionally walk the reader through a failing setup.
- `docs/usage/choosing-packages.md` (NEW) — grounded in `docs/reference/packages/classification.md`
  and the package docs, answering "which packages do I need for X."
- `docs/usage/commands.md`, `docs/usage/events.md` (NEW) — split out of quick-start's
  and extending-nevo's consumer-facing content (adding your own command/event handler
  using existing extension points — not adding a new handler-type kind, which is
  maintainer-facing per area `maintainer-documentation`).
- `docs/usage/cross-service-messaging.md` (NEW) — generalized from
  `example-app-walkthrough.md` Scenario 4, independent of that specific example app.
- `docs/usage/inbox-outbox.md` (NEW) — task-oriented: enabling idempotent processing and
  transactional publish in a consumer's own handler, including the manual outbox DI
  wiring step called out as a gap in `NEvo.Messaging.EntityFramework.md:100-105`.
  Cross-links the maintainer `docs/development/inbox-outbox.md` and
  `failure-semantics.md` rather than restating their content.
- `docs/usage/authorization.md` (NEW) — the audit's top guide gap: configuring
  `[AllowPermission]` end-to-end given there's no DI registration helper.
- `docs/usage/troubleshooting.md` (NEW) — generalized from
  `example-app-walkthrough.md`'s embedded troubleshooting section; cross-links relevant
  `docs/project/known-issues.md` entries (e.g. what a 500 from a permission failure
  means) rather than restating them.
- `docs/usage/example-app-walkthrough.md` — migrated, content unchanged beyond
  process-language cleanup.

## Constraints

A usage guide begins with a concrete user goal, states required packages/prerequisites,
provides a complete working scenario, explains the result, identifies constraints and
failure modes, and links to deeper `docs/development/*` and
`docs/reference/packages/*` documentation — per the brief's "Task-oriented guides"
rules.

## Interfaces and boundaries

Depends on area `package-reference` (final package doc locations/content to link to)
and area `maintainer-documentation` (failure-semantics.md, inbox-outbox.md,
transport/persistence-development.md for cross-links). Feeds area
`navigation-and-ai-routing` (entry point links to every guide here).

## Area-specific acceptance criteria

- `docs/guides/` no longer exists; `docs/usage/` holds at least the 9 files listed
  above (quick-start, choosing-packages, commands, events, cross-service-messaging,
  inbox-outbox, authorization, troubleshooting, example-app-walkthrough), plus
  installation.md only if it wasn't folded into quick-start.md.
- `docs/usage/quick-start.md` ends in a stated successful, runnable result.
- Every new guide names its required packages and prerequisites explicitly.

## Dependencies

Depends on areas `foundation`, `maintainer-documentation`, `known-issues`,
`package-reference`.

## Out of scope

The consumer/maintainer entry-point pages and the AI routing layer (area
`navigation-and-ai-routing`).
