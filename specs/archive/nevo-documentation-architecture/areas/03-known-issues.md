# Area: Known issues

## Responsibility

Create the central known-issues document consolidating every confirmed defect currently
scattered across package "Limitations" sections and one example-app-scoped gap.

## Current state

At least 13 items are already documented, but only inside individual package docs, with
no central, scannable known-issues list: HTTP 500 on authorization failure
(`NEvo.Messaging.Authorization.md:108-116`, `NEvo.Messaging.Web.md:117-123`),
`AllowPermissionAttribute.PermissionName` not checked
(`NEvo.Messaging.Authorization.md:90-97,177-180`), the no-op `FakeEventStore`
(`NEvo.Ddd.EventSourcing.md:170-178`), missing orchestration-state persistence
(`NEvo.Orchestrating.md:191-215`, `NEvo.Orchestrating.EntityFramework.md:92-99`), the
misconfigured `OrchestratorStateTypeConfiguration`
(`NEvo.Orchestrating.EntityFramework.md:64-67,100-104`), incomplete outbox behavior
(`NEvo.Messaging.EntityFramework.md:100-113`), the GET/POST parameter inconsistency
(`NEvo.Web.md:120-123`), the commented-out validator-type check
(`NEvo.Messaging.Authorization.md:181-185`), the static cross-instance evolver map
(`NEvo.Ddd.EventSourcing.md:182-187`), `MigrationBackgroundService`'s unhandled-exception
host-down behavior (`NEvo.EntityFramework.md:87-97`), the discarded failed-response body
(`NEvo.Web.md:117-119`), and the example app's unauthenticated internal dispatch endpoint
(`guides/example-app-walkthrough.md:192-195`).

## Requirements

- `docs/project/known-issues.md`, one entry per item above, each stating: affected
  feature, current behavior, practical consequence, intended behavior (if known),
  severity/usage recommendation, source location, and related spec/task where
  applicable (e.g. the archived `nevo-documentation-foundation` task that first
  documented it).
- Distinguish intentional constraints from implementation gaps explicitly — e.g. the
  example app's hardcoded example-app roles
  (`guides/example-app-walkthrough.md:91-98`, `// hardcoded for testing`) is an
  intentional simplification, not a defect, and must not be listed as one.
- Cross-link each package reference page's remaining, shortened defect mentions (area
  `package-reference`) to this document instead of restating the full detail.

## Constraints

This is a documentation-accuracy task, not a code-fix task — no `src/**` change, and no
new defect is introduced or implied beyond what's already documented in the current
package docs.

## Interfaces and boundaries

Consumed by: `package-reference` (links to this doc instead of restating defect detail
in full), `usage-guides` task `usage-authorization-and-troubleshooting`
(troubleshooting.md cross-links relevant entries).

## Area-specific acceptance criteria

- Every one of the 13 items above (11 real defects + 1 example-app-scoped gap + the
  correctly-labeled 1 intentional simplification) appears in `known-issues.md` or is
  explicitly excluded with a one-line reason (the intentional-simplification case).
- `node tools/docs.mjs validate` passes with the `project` type in use.

## Dependencies

Depends on area `foundation` (the `project` type). Independent of area
`maintainer-documentation` — sources directly from the current `docs/packages/*` and
`docs/guides/example-app-walkthrough.md` content, which doesn't require the merge to
have happened first.

## Out of scope

Fixing any of the underlying defects (`src/**` is out of scope for the whole change).
The 5 D4 documentation inconsistencies — those are inaccuracies in the docs themselves,
not implementation defects, and are corrected in area `maintainer-documentation` instead
of listed here.
