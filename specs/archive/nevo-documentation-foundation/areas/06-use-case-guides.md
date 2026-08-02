# Area: Use-case guides

## Responsibility

Provide installation, minimal-setup, and end-to-end walkthrough documentation grounded
in `examples/ExampleApp` (D4 excludes `examples/Gdpr` entirely).

## Current state

`docs/development/local-setup.md` covers prerequisites, build, and test commands, and
says "See `examples/ExampleApp/` for service-specific setup" — but no such per-service
setup doc exists anywhere under `examples/ExampleApp/` (no `README.md` there). There is
no quick-start or installation guide anywhere in the repo.

## Requirements

- `docs/guides/quick-start.md` and `docs/guides/installation.md` — the minimal working
  setup for a new consumer, built from what `docs/development/local-setup.md` and the
  corrected package docs already establish (do not duplicate content — cross-link).
- `docs/guides/example-app-walkthrough.md` — end-to-end walkthrough of
  `examples/ExampleApp`'s 5 projects (`Identity.Api`, `ServiceA.Api`, `ServiceB.Api`,
  `Orchestration.AppHost`, `Orchestration.ServiceDefaults`), covering: common scenarios,
  edge cases, troubleshooting, and expected runtime behavior, grounded in the actual
  `Program.cs`/composition-root code and the `Document`/`ServiceBCommand` domain code
  already identified during discovery.
- If any run/setup step described cannot be verified from the repository alone (e.g. SQL
  Server connection details, Identity server seeding), state it as an open question rather
  than inventing plausible-sounding steps.
- One connected, domain-named "HTTP request → command handler → published event →
  independent second handler" narrative spanning `quick-start.md` and
  `example-app-walkthrough.md`, using only real, already-shipped, already-documented
  APIs (task `quickstart-end-to-end-narrative`, added per
  `reviews/audit-examples-and-wireup.md` F1/F2/F8).

## Constraints

Grounded only in `examples/ExampleApp` — no reference to `examples/Gdpr` (D4).

## Interfaces and boundaries

Consumes: package docs from areas 03-05 (cross-links "which package does what" back to
`docs/packages/`). Produces: the guides area 08's navigation hub links to.

## Area-specific acceptance criteria

- All 3 guides pass `node tools/docs.mjs validate` under the `guide` type.
- The walkthrough guide names every one of the 5 `examples/ExampleApp` projects at least
  once and cites the specific files inspected for each claim.
- No claim about `examples/Gdpr` appears anywhere in these guides.
- `quick-start.md` and `example-app-walkthrough.md` tell one connected end-to-end story
  rather than three disconnected fragments (per the audit's F1/F2/F8).

## Dependencies

`quick-start.md`/`installation.md` depend on `04-core-and-messaging-docs`. The
walkthrough guide depends on `05-remaining-package-docs` (needs the full package set to
cross-link accurately). `quickstart-end-to-end-narrative` depends on both guides already
existing.

## Out of scope

Extension/contribution guides (area 07).
